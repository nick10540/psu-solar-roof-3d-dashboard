/**
 * node-server.ts — Node adapter for the SolarEdge backend.
 *
 * This is what runs on the kiosk PC next to the dashboard and during local
 * development: `npm run worker`. It is a thin translation layer — every
 * decision lives in src/handler.ts, which the Cloudflare adapter shares.
 *
 * Requires Node 18+ for global fetch / Request / Response.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRequest } from './src/handler.js';
import { authorizedSiteIds, setRefreshTokenPersister, setStoredRefreshToken } from './src/tokenStore.js';
import { seedRefreshTokensFromEnv } from './src/config.js';
import type { WorkerEnv } from './src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where a rotated refresh token is kept.
 *
 * SolarEdge hands back a NEW refresh token on each refresh and retires the old
 * one. Without this file, restarting the process on Monday morning would
 * authenticate with Friday's dead token and the dashboard would come up empty
 * with no obvious cause.
 *
 * Overridable because in Docker the code is a bundled single file and the
 * token has to land on a mounted volume, not next to the binary where a
 * rebuild would wipe it.
 */
const TOKEN_STORE_FILE =
  process.env.SOLAREDGE_TOKEN_STORE?.trim() || resolve(HERE, '.token-store.json');

/**
 * Load worker/.dev.vars into a plain object.
 *
 * Deliberately NOT `process.env`: the same file name works for `wrangler dev`,
 * and keeping the values out of the ambient environment means a child process
 * or a stray `console.log(process.env)` cannot leak the client secret.
 */
function loadDevVars(): Record<string, string> {
  const candidates = [resolve(HERE, '.dev.vars'), resolve(HERE, '.env')];
  const vars: Record<string, string> = {};

  for (const file of candidates) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip one layer of matching quotes; a secret containing '+' or '=' is
      // otherwise fine unquoted because only the FIRST '=' splits the line.
      if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (!(key in vars)) vars[key] = value;
    }
  }

  // Real environment variables win, so a systemd unit or Docker secret can
  // override the file without editing it.
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.startsWith('SOLAREDGE_')) vars[key] = value;
  }
  if (process.env.ALLOWED_ORIGINS) vars.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
  if (process.env.PORT) vars.PORT = process.env.PORT;

  return vars;
}

const env = loadDevVars() as unknown as WorkerEnv;
const PORT = Number(env.PORT || 8787);

// --- Refresh-token durability -------------------------------------------------

type TokenStoreFile = Record<string, { refreshToken: string; updatedAt: string }>;

function readTokenStore(): TokenStoreFile {
  try {
    return JSON.parse(readFileSync(TOKEN_STORE_FILE, 'utf8')) as TokenStoreFile;
  } catch {
    return {};
  }
}

setRefreshTokenPersister((siteId, refreshToken) => {
  const store = readTokenStore();
  const key = String(siteId);

  // An empty token means "revoked" — drop the entry rather than storing a
  // blank that would later look like a real, broken grant.
  if (!refreshToken) delete store[key];
  else store[key] = { refreshToken, updatedAt: new Date().toISOString() };

  writeFileSync(TOKEN_STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  console.log(
    refreshToken
      ? `Rotated refresh token persisted for site ${siteId}`
      : `Cleared stored refresh token for site ${siteId}`
  );
});

// Seed order matters: env first, then the on-disk store overwrites it. Tokens
// rotate on every use, so the file is always the newer of the two.
{
  for (const [siteId, token] of seedRefreshTokensFromEnv(env)) {
    setStoredRefreshToken(siteId, token);
  }
  for (const [key, entry] of Object.entries(readTokenStore())) {
    const siteId = Number(key);
    if (Number.isFinite(siteId) && entry?.refreshToken) {
      setStoredRefreshToken(siteId, entry.refreshToken);
    }
  }
}

function toFetchRequest(req: IncomingMessage): Request {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url || '/', `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  // GET/HEAD only on this backend, so no body plumbing is needed.
  return new Request(url.toString(), { method: req.method || 'GET', headers });
}

async function writeFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
}

const server = createServer((req, res) => {
  const started = Date.now();

  handleRequest(toFetchRequest(req), env)
    .then(async (response) => {
      await writeFetchResponse(res, response);
      console.log(`${req.method} ${req.url} -> ${response.status} (${Date.now() - started}ms)`);
    })
    .catch((err) => {
      // A throw that escapes the handler is a bug here, not an upstream
      // failure — log it in full but never echo internals to the client.
      console.error('Unhandled backend error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'internal_error' }));
    });
});

server.listen(PORT, () => {
  const apiKey = (env.SOLAREDGE_API_KEY || '').trim();
  const usingApiKey = !!apiKey;
  const configured = usingApiKey || !!(env.SOLAREDGE_CLIENT_ID && env.SOLAREDGE_CLIENT_SECRET);
  const connected = authorizedSiteIds();
  const wanted = (env.SOLAREDGE_SITE_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);
  const pending = usingApiKey ? [] : wanted.filter((id) => !connected.includes(id));

  console.log(`SolarEdge backend listening on http://localhost:${PORT}`);
  console.log(`  auth mode   : ${usingApiKey ? 'Fleet API Key (X-API-Key)' : 'OAuth consent (per site)'}`);
  console.log(`  credentials : ${configured ? 'loaded' : 'MISSING — see worker/.dev.vars.example'}`);
  console.log(`  sites       : ${wanted.join(', ') || '(registry default)'}`);
  if (!usingApiKey) {
    console.log(`  connected   : ${connected.length ? connected.join(', ') : 'none'}`);
  }
  console.log(`  health      : http://localhost:${PORT}/api/solaredge/health`);

  if (pending.length) {
    console.log('');
    console.log(`  ${pending.length} site(s) not authorized yet: ${pending.join(', ')}`);
    console.log('  A SolarEdge grant covers ONE site, so each needs its own trip:');
    console.log(`    https://connect.solaredge.com/authorize?client_id=${(env.SOLAREDGE_CLIENT_ID || '').trim()}`);
    console.log('');
    console.log('  If SolarEdge answers "associated to multiple SolarEdge sites", the');
    console.log('  consent flow cannot be used with that account at all. Generate a');
    console.log('  Fleet API Key instead and set SOLAREDGE_API_KEY — it covers every');
    console.log('  site with no consent step.');
  }
});

const shutdown = (signal: string) => () => {
  console.log(`\n${signal} received, closing backend.`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
