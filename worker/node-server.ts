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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRequest } from './src/handler.js';
import type { WorkerEnv } from './src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Load worker/.dev.vars into a plain object.
 *
 * Deliberately NOT `process.env`: the same file name works for `wrangler dev`,
 * and keeping the values out of the ambient environment means a child process
 * or a stray `console.log(process.env)` cannot leak the API key.
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
  const key = (env.SOLAREDGE_API_KEY || '').trim();

  console.log(`SolarEdge backend listening on http://localhost:${PORT}`);
  console.log(`  api key     : ${key ? `loaded (${key.slice(0, 6)}…)` : 'MISSING — see worker/.dev.vars.example'}`);
  console.log(`  sites       : ${env.SOLAREDGE_SITE_IDS || '(registry default)'}`);
  console.log(`  health      : http://localhost:${PORT}/api/solaredge/health`);

  if (!key) {
    console.log('');
    console.log('  Generate a Fleet API Key in the SolarEdge Developer Platform');
    console.log('  ("My Fleet Access") and set SOLAREDGE_API_KEY in worker/.dev.vars.');
  }
});

const shutdown = (signal: string) => () => {
  console.log(`\n${signal} received, closing backend.`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
