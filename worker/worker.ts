/**
 * worker.ts — Cloudflare Workers adapter.
 *
 * Deploy path only; local dev and the kiosk PC use node-server.ts. Both call
 * the same handleRequest, so behaviour cannot drift between them.
 *
 *   wrangler secret put SOLAREDGE_API_KEY
 *   wrangler deploy
 *
 * Caveat worth knowing before choosing this target: the response caches live
 * in isolate memory. Cloudflare may run several isolates, so each warms its own
 * — correct, just slightly more upstream calls than the single Node process.
 * Move them to a Durable Object or KV if that ever matters against the API
 * budget, which is charged per minute.
 */

import { handleRequest } from './src/handler.js';
import type { WorkerEnv } from './src/config.js';

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
