import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from '../server/api';
const servers: ReturnType<typeof createApiServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});
async function setup() {
  const upstream = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ results: [] }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const server = createApiServer({
    appId: 'TEST123',
    apiKey: 'secret',
    developmentAgentId: 'development-agent',
    productionAgentId: 'production-agent',
    environment: 'development',
    fetch: upstream,
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    upstream,
    request: (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}
describe('protected local API', () => {
  it('forwards read-only search with analytics forcibly disabled', async () => {
    const { request, upstream } = await setup();
    expect(
      (
        await request('/api/search', {
          requests: [
            {
              indexName: 'prod_catalog',
              params: { query: 'rings', hitsPerPage: 24, analytics: true },
            },
          ],
        })
      ).status,
    ).toBe(200);
    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(
      Object.fromEntries(new URLSearchParams(JSON.parse(init.body as string).requests[0].params)),
    ).toMatchObject({ analytics: 'false', clickAnalytics: 'false', enableABTest: 'false' });
  });
  it('rejects foreign indices, override parameters and oversized pages', async () => {
    const { request, upstream } = await setup();
    for (const requestItem of [
      { indexName: 'other', params: {} },
      { indexName: 'prod_catalog', params: { apiKey: 'bad' } },
      { indexName: 'prod_catalog', params: { hitsPerPage: 101 } },
    ])
      expect((await request('/api/search', { requests: [requestItem] })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects foreign origins and unsupported methods', async () => {
    const { request, upstream } = await setup();
    expect(
      (await request('/api/search', { requests: [] }, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await request('/api/search')).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('uses exact escaped object identity and masks upstream failures', async () => {
    const { request, upstream } = await setup();
    upstream.mockResolvedValueOnce(new Response('private upstream detail', { status: 403 }));
    const response = await request('/api/products/MFP256C');
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private');
    expect(String(upstream.mock.calls[0]?.[0])).toContain('/1/indexes/prod_catalog/MFP256C');
  });
  it('allows only configured searchable facets', async () => {
    const { request, upstream } = await setup();
    expect(
      (
        await request('/api/facets', {
          indexName: 'prod_catalog',
          facetName: 'Catalog_BrandNavigationName',
          facetQuery: 'a',
        })
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(
      (
        await request('/api/facets', {
          indexName: 'prod_catalog',
          facetName: 'Catalog_Brand',
          facetQuery: 'a',
        })
      ).status,
    ).toBe(200);
  });
  it('rejects chat overrides and oversized or non-string context', async () => {
    const { request, upstream } = await setup();
    const base = {
      id: 'conversation-1',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'ring' }] }],
    };
    expect((await request('/api/chat', { ...base, model: 'other' })).status).toBe(400);
    for (const turnContext of [
      { a: 1 },
      { a: 'é'.repeat(600) },
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [String(i), 'x'])),
    ])
      expect(
        (
          await request('/api/chat', {
            ...base,
            messages: [{ ...base.messages[0], metadata: { turnContext } }],
          })
        ).status,
      ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('forwards valid multi-key turn context even when its total exceeds 4 KB', async () => {
    const { request, upstream } = await setup();
    const turnContext = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [`shoppingState${index}`, 'x'.repeat(800)]),
    );
    expect(Buffer.byteLength(JSON.stringify(turnContext))).toBeGreaterThan(4096);
    const response = await request('/api/chat', {
      id: 'conversation-long-brief',
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'text', text: 'Compare my saved pieces' }],
          metadata: { turnContext },
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
  it('streams approved chat without changing data or configured agent', async () => {
    const { request, upstream } = await setup();
    upstream.mockResolvedValueOnce(
      new Response('data: {"type":"start"}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      }),
    );
    const response = await request('/api/chat', {
      id: 'conversation-1',
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ type: 'text', text: 'this ring' }],
          metadata: { turnContext: { selectedProduct: 'MFP256C' } },
        },
      ],
    });
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    expect(await response.text()).toContain('[DONE]');
    expect(String(upstream.mock.calls[0]?.[0])).toContain(
      '/agent-studio/1/agents/development-agent/completions?stream=true&compatibilityMode=ai-sdk-5',
    );
  });
  it('rejects foreign Hosts, path traversal and control characters without calling upstream', async () => {
    const { request, upstream, url } = await setup();
    const status = await new Promise<number | undefined>((resolve) => {
      const req = httpRequest(
        url + '/api/health',
        { headers: { host: 'evil.example:5174' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    expect(status).toBe(403);
    expect((await request('/api/products/%2Fother')).status).toBe(400);
    expect((await request('/api/products/%00')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('rejects unknown content types and oversized batch payloads', async () => {
    const { request, upstream } = await setup();
    expect((await request('/api/search', {}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(
      (
        await request('/api/search', {
          requests: Array.from({ length: 31 }, () => ({ indexName: 'prod_catalog', params: {} })),
        })
      ).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('encodes multi-select and numeric arrays in the REST query contract', async () => {
    const { request, upstream } = await setup();
    await request('/api/search', {
      requests: [
        {
          indexName: 'prod_catalog',
          params: {
            facetFilters: [['Catalog_Brand:A', 'Catalog_Brand:B']],
            numericFilters: ['Pricing_ActivePrice>=50'],
            facets: ['Catalog_Brand'],
          },
        },
      ],
    });
    const init = upstream.mock.calls[0][1]!;
    const parsed = new URLSearchParams(JSON.parse(init.body as string).requests[0].params);
    expect(JSON.parse(parsed.get('facetFilters')!)).toEqual([
      ['Catalog_Brand:A', 'Catalog_Brand:B'],
    ]);
    expect(JSON.parse(parsed.get('numericFilters')!)).toEqual(['Pricing_ActivePrice>=50']);
  });
  it('cancels upstream streaming when the browser disconnects', async () => {
    const { request, upstream } = await setup();
    let signal: AbortSignal | undefined;
    upstream.mockImplementationOnce(async (_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const response = await request('/api/chat', {
      id: 'cancel-test',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'ring' }] }],
    });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it('accepts the secondary disjunctive-facet request sent by InstantSearch', async () => {
    const { request, upstream } = await setup();
    const response = await request('/api/search', {
      requests: [
        {
          indexName: 'prod_catalog',
          params: {
            facets: 'Pricing_PriceRange',
            hitsPerPage: 0,
            facetFilters: [['Catalog_ConsumerProductCategoryDisplayNames:Rings']],
          },
        },
      ],
    });
    expect(response.status).toBe(200);
    const init = upstream.mock.calls[0][1]!;
    const parsed = new URLSearchParams(JSON.parse(init.body as string).requests[0].params);
    expect(parsed.get('facets')).toBe('Pricing_PriceRange');
  });
  it('rejects invalid context keys and empty values before contacting the agent', async () => {
    const { request, upstream } = await setup();
    for (const turnContext of [
      { 'bad key': 'value' },
      { 'bad:key': 'value' },
      { '💍': 'value' },
      { good: '' },
      { good: ' \t\n' },
    ]) {
      const response = await request('/api/chat', {
        id: 'invalid-context',
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'ring' }],
            metadata: { turnContext },
          },
        ],
      });
      expect(response.status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reports catalogue-only configuration and rejects chat without an agent identity', async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    const server = createApiServer({
      appId: 'TEST123',
      apiKey: 'secret',
      fetch: upstream,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const request = (path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const health = await request('/api/health');
    const healthPayload = await health.json();
    expect(healthPayload).toMatchObject({
      environment: 'development',
    });
    expect(healthPayload).not.toHaveProperty('developmentConfigured');
    expect(healthPayload).not.toHaveProperty('conciergeConfigured');
    const response = await request('/api/chat', {
      id: 'unconfigured',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'ring' }] }],
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Concierge is not configured' });
    expect(upstream).not.toHaveBeenCalled();
    expect((await request('/api/brief', {})).status).toBe(404);
  });

  it('routes production chat with its production agent identity alone', async () => {
    const upstream = vi.fn(
      async (_input: string | URL | Request) =>
        new Response('data: done\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    );
    const server = createApiServer({
      appId: 'TEST123',
      apiKey: 'secret',
      productionAgentId: 'published-agent',
      environment: 'production',
      fetch: upstream,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await health.json()).toMatchObject({
      environment: 'production',
    });
    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'conversation-1',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      }),
    });
    expect(response.status).toBe(200);
    expect(String(upstream.mock.calls[0]?.[0])).toContain('/agents/published-agent/completions');
  });
});
