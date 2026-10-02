import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiHandler } from '../server/api.js';
import { normalizeVercelRequestURL } from '../server/vercel-routing.js';
import { loadConfig } from '../server/config.js';
let handler: ReturnType<typeof createApiHandler> | undefined;
/** Adapt the same bounded API to Vercel without opening a listening socket. */
export default async function vercelApi(req: IncomingMessage, res: ServerResponse) {
  try {
    handler ??= createApiHandler({
      ...loadConfig(),
      allowedHosts: [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL,
        ...(process.env.APP_ALLOWED_HOSTS || '').split(',')].filter((host): host is string => !!host),
    });
    req.url = normalizeVercelRequestURL(req.url || "/");
    await handler(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Demo API configuration unavailable' }));
  }
}
