import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { z } from 'zod';
import { RequestTelemetry, productionTelemetryLogger, type TelemetryLogger } from './telemetry.js';
import { runEvidenceRoute } from './concierge/evidenceRoute.js';
import { runExactProductRefreshRoute } from './concierge/exactProductRefreshRoute.js';
import {
  createCatalogVocabulary,
  type CatalogVocabularyCache,
} from './concierge/catalogVocabulary.js';

export const INDICES = [
  'prod_catalog',
  'prod_catalog_featured',
  'prod_catalog_newest',
  'prod_catalog_top_rated',
  'prod_catalog_price_asc',
  'prod_catalog_price_desc',
] as const;
export const SEARCHABLE_FACETS = [
  'Catalog_Brand',
  'Catalog_ConsumerProductCategories',
  'Catalog_ConsumerProductCategoryDisplayNames',
  'Catalog_ConsumerProductCategoryHierarchyDisplayNames',
  'Catalog_PrimaryGemstoneAndPearlColorGroups',
  'Catalog_ProductType',
  'hierarchialCategories.lvl0',
  'hierarchialCategories.lvl1',
] as const;
const short = z.string().max(4096);
const strings = z.array(short).max(150);
const filterList = z.array(z.union([short, strings])).max(100);
const paramsSchema = z
  .object({
    query: short.optional(),
    page: z.number().int().min(0).max(999).optional(),
    hitsPerPage: z.number().int().min(0).max(100).optional(),
    facets: z.union([short, strings]).optional(),
    filters: short.optional(),
    facetFilters: filterList.optional(),
    numericFilters: filterList.optional(),
    tagFilters: z.union([short, filterList]).optional(),
    maxValuesPerFacet: z.number().int().min(1).max(100).optional(),
    attributesToRetrieve: strings.optional(),
    attributesToHighlight: strings.optional(),
    attributesToSnippet: strings.optional(),
    highlightPreTag: z.string().max(100).optional(),
    highlightPostTag: z.string().max(100).optional(),
    distinct: z.union([z.boolean(), z.number().int().min(0).max(4)]).optional(),
    facetingAfterDistinct: z.boolean().optional(),
    analytics: z.boolean().optional(),
    clickAnalytics: z.boolean().optional(),
    enableABTest: z.boolean().optional(),
    getRankingInfo: z.boolean().optional(),
    responseFields: strings.optional(),
    ruleContexts: strings.optional(),
    optionalFilters: filterList.optional(),
    sumOrFiltersScores: z.boolean().optional(),
  })
  .strict();
const indexSchema = z.enum(INDICES);
const searchSchema = z
  .object({
    requests: z
      .array(z.object({ indexName: indexSchema, params: paramsSchema.default({}) }).strict())
      .min(1)
      .max(30),
  })
  .strict();
const facetSchema = z
  .object({
    indexName: indexSchema,
    facetName: z.enum(SEARCHABLE_FACETS),
    facetQuery: z.string().max(256),
    params: paramsSchema.default({}),
  })
  .strict();
const contextSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    z.string().refine((value) => value.trim().length > 0),
  )
  .superRefine((value, ctx) => {
    const entries = Object.entries(value);
    if (entries.length > 32 || entries.some(([, item]) => Buffer.byteLength(item) > 1024))
      ctx.addIssue({ code: 'custom', message: 'Context exceeds application field limits' });
  });
const partSchema = z.object({ type: z.string().min(1).max(150) }).passthrough();
const messageSchema = z
  .object({
    id: z.string().min(1).max(150),
    role: z.enum(['user', 'assistant']),
    parts: z.array(partSchema).max(250),
    metadata: z.object({ turnContext: contextSchema.optional() }).passthrough().optional(),
  })
  .strict();
const chatSchema = z
  .object({
    id: z.string().min(1).max(150),
    messages: z.array(messageSchema).min(1).max(200),
    messageId: z.string().max(150).optional(),
    trigger: z.enum(['submit-message', 'regenerate-message']).optional(),
  })
  .strict();
export type ApiOptions = {
  appId: string;
  apiKey: string;
  fetch?: typeof fetch;
  allowedHosts?: string[];
  developmentAgentId?: string;
  productionAgentId?: string;
  environment?: 'development' | 'production';
  telemetryLogger?: TelemetryLogger;
  /** Injected in tests; built from appId/apiKey when absent. */
  vocabulary?: CatalogVocabularyCache;
};
const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
function reply(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('MEDIA');
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('LARGE');
    return JSON.parse(text) as unknown;
  }
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('LARGE');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
}
function safeParams(params: z.infer<typeof paramsSchema>) {
  return { ...params, analytics: false, clickAnalytics: false, enableABTest: false };
}

export function createApiHandler(options: ApiOptions) {
  if (!/^[A-Za-z0-9]+$/.test(options.appId) || !options.apiKey)
    throw new Error('Valid server-side Algolia configuration is required');
  const upstream = options.fetch ?? fetch;
  // Live catalog vocabulary: derived read-only from the index, TTL-refreshed.
  // One cache per handler (the Vercel entry memoizes the handler, so one per
  // lambda instance). Test injections replace it entirely.
  const vocabulary =
    options.vocabulary ??
    createCatalogVocabulary({ appId: options.appId, apiKey: options.apiKey, fetch: upstream });
  const environment =
    options.environment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const validIdentity = (value: unknown): value is string =>
    typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
  const conciergeId =
    environment === 'production' ? options.productionAgentId : options.developmentAgentId;
  const cloudHosts = new Set(options.allowedHosts ?? []);
  for (const host of cloudHosts)
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)) throw new Error('Invalid deployment host');
  const origins = new Set([...allowedOrigins, ...[...cloudHosts].map((host) => `https://${host}`)]);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const telemetry = new RequestTelemetry(req.headers['x-jtv-request-id']);
    const abort = new AbortController();
    let clientDisconnected = false;
    let stream = false;
    req.on('aborted', () => {
      clientDisconnected = true;
      abort.abort();
    });
    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        abort.abort();
      }
    });
    const timeout = setTimeout(() => abort.abort(), 180_000);
    timeout.unref();
    // Hoisted so the catch block can log even when the try block exited early.
    let upstreamTarget = 'unknown';
    const describeUpstreamError = (error: unknown) => {
      const seen = new Set<unknown>();
      const chain: string[] = [];
      for (let cause: unknown = error; cause && !seen.has(cause); cause = (cause as Error)?.cause) {
        seen.add(cause);
        const err = cause as Error & { code?: string };
        chain.push(
          `${err.name ?? 'Error'}${err.code ? `:${err.code}` : ''}: ${String(err.message ?? '').slice(0, 160)}`,
        );
      }
      return chain.join(' <- ');
    };
    try {
      const host = req.headers.host ?? '';
      if (
        (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) && !cloudHosts.has(host)) ||
        (req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        reply(res, 403, { error: 'Origin not allowed' });
        return;
      }
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.search) {
        reply(res, 400, { error: 'Query parameters are not supported' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        reply(res, 200, { ok: true, mode: 'live', environment });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog-vocabulary') {
        try {
          const snapshot = await vocabulary.get();
          reply(res, 200, {
            builtAt: snapshot.builtAt,
            values: snapshot.values,
          });
        } catch (error) {
          reply(res, 503, {
            error: 'Catalogue vocabulary unavailable',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/agent-evidence') {
        const result = await runEvidenceRoute(await body(req), {
          appId: options.appId,
          searchOnlyApiKey: options.apiKey,
          fetch: upstream,
          signal: abort.signal,
          vocabulary,
        });
        reply(res, 200, result);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/agent-product-refresh') {
        const result = await runExactProductRefreshRoute(await body(req), {
          appId: options.appId,
          searchOnlyApiKey: options.apiKey,
          fetch: upstream,
          signal: abort.signal,
        });
        reply(res, 200, result);
        return;
      }
      let path: string;
      let payload: unknown;
      let method = 'POST';
      if (req.method === 'POST' && url.pathname === '/api/search') {
        const input = searchSchema.parse(await body(req));
        payload = {
          requests: input.requests.map((item) => ({
            indexName: item.indexName,
            params: new URLSearchParams(
              Object.entries(safeParams(item.params)).map(([key, value]) => [
                key,
                typeof value === 'string' ? value : JSON.stringify(value),
              ]),
            ).toString(),
          })),
        };
        path = '/1/indexes/*/queries';
      } else if (req.method === 'POST' && url.pathname === '/api/facets') {
        const input = facetSchema.parse(await body(req));
        payload = { ...safeParams(input.params), facetQuery: input.facetQuery, maxFacetHits: 100 };
        path = `/1/indexes/${input.indexName}/facets/${encodeURIComponent(input.facetName)}/query`;
      } else if (req.method === 'GET' && url.pathname.startsWith('/api/products/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/products/'.length));
        if (!/^[A-Za-z0-9_.-]{1,150}$/.test(id)) {
          reply(res, 400, { error: 'Invalid product identity' });
          return;
        }
        path = `/1/indexes/prod_catalog/${encodeURIComponent(id)}`;
        method = 'GET';
      } else if (req.method === 'POST' && url.pathname === '/api/chat') {
        if (!validIdentity(conciergeId)) {
          reply(res, 503, { error: 'Concierge is not configured' });
          return;
        }
        payload = chatSchema.parse(await body(req));
        path = `/agent-studio/1/agents/${conciergeId}/completions?stream=true&compatibilityMode=ai-sdk-5`;
        stream = true;
      } else {
        reply(res, 404, { error: 'Route not found' });
        return;
      }
      // One retry when the upstream connection itself fails before any response.
      // Safe at this point: no headers have reached the browser, so the retry is
      // invisible to the client and cannot double-process a shopper action. The
      // failure is always logged so transient network errors stop being silent.
      const upstreamUrl = `https://${options.appId}.algolia.net${path}`;
      upstreamTarget = path;
      const callUpstream = () =>
        upstream(upstreamUrl, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-algolia-application-id': options.appId,
            'x-algolia-api-key': options.apiKey,
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: abort.signal,
          redirect: 'error',
        });
      const response = await telemetry.measure('upstream_headers', async () => {
        try {
          return await callUpstream();
        } catch (error) {
          if (!stream || abort.signal.aborted) throw error;
          console.error('jtv_upstream_retry', {
            path: upstreamTarget,
            requestId: telemetry.requestId,
            error: describeUpstreamError(error),
          });
          return await callUpstream();
        }
      });
      if (!response.ok) {
        await response.body?.cancel();
        reply(res, [400, 401, 403, 404, 429].includes(response.status) ? response.status : 502, {
          error: stream ? 'Agent request failed' : 'Catalogue request failed',
          upstreamStatus: response.status,
        });
        return;
      }
      if (stream) {
        if (!response.body) throw new Error('EMPTY');
        res.writeHead(200, {
          'content-type': response.headers.get('content-type') ?? 'text/event-stream',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
          'x-vercel-ai-ui-message-stream': 'v1',
          'server-timing': telemetry.timing(),
          'x-request-id': telemetry.requestId,
        });
        for await (const chunk of Readable.fromWeb(response.body as any, {
          signal: abort.signal,
        })) {
          if (res.destroyed) break;
          if (!res.write(chunk)) await once(res, 'drain', { signal: abort.signal });
        }
        if (!res.destroyed) res.end();
      } else reply(res, 200, await response.json());
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed && !res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({ type: 'error', errorText: 'Agent response interrupted' })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
        } else res.destroy();
        return;
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof URIError)
        reply(res, 400, { error: 'Invalid request' });
      else if (error instanceof Error && error.message === 'LARGE')
        reply(res, 413, { error: 'Request too large' });
      else if (error instanceof Error && error.message === 'MEDIA')
        reply(res, 415, { error: 'Expected application/json' });
      else {
      const firstErrorCode = (error: unknown): string | undefined => {
        for (let cause: unknown = error; cause instanceof Error; cause = cause.cause)
          if ((cause as NodeJS.ErrnoException).code) return (cause as NodeJS.ErrnoException).code;
        return undefined;
      };
      console.error('jtv_upstream_failure', {
          path: upstreamTarget,
          requestId: telemetry.requestId,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  code: firstErrorCode(error),
                  chain: describeUpstreamError(error),
                }
              : String(error),
        });
        if (!res.destroyed) reply(res, 502, { error: 'Upstream connection failed' });
      }
    } finally {
      clearTimeout(timeout);
      const logger =
        options.telemetryLogger ??
        (process.env.NODE_ENV === 'production' ? productionTelemetryLogger : undefined);
      try {
        logger?.({
          ...telemetry.snapshot(undefined, res.writableEnded ? 'request_end' : 'incomplete'),
          event: 'jtv_request',
          statusCode: res.statusCode,
          aborted: abort.signal.aborted,
          completed: res.writableEnded,
        });
      } catch {
        /* Telemetry must never change request behavior. */
      }
    }
  };
}
export function createApiServer(options: ApiOptions) {
  return createServer(createApiHandler(options));
}
