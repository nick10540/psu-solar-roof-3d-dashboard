/**
 * worker.ts — Cloudflare Workers adapter.
 *
 * Deploy path only; local dev and the kiosk PC use node-server.ts. Both call
 * the same handleRequest, so behaviour cannot drift between them.
 *
 *   wrangler secret put SOLAREDGE_CLIENT_ID
 *   wrangler secret put SOLAREDGE_CLIENT_SECRET
 *   wrangler deploy
 *
 * Caveat worth knowing before choosing this target: the token cache and the
 * overview cache live in isolate memory. Cloudflare may run several isolates,
 * so each one warms its own token — correct, just slightly more upstream calls
 * than the single Node process. Move both caches to a Durable Object or KV if
 * that ever matters against the API budget.
 */

import { handleRequest } from './src/handler.js';
import type { WorkerEnv } from './src/config.js';

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
