import { expect, test } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiServer } from '../../server/api.js';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';

// Scenario list: (1) a real browser receives an SSE text delta while its
// response is held open, (2) the shopper sees that delta before the final
// event, (3) final completion leaves one reply and no premature product cards,
// (4) an incomplete/error stream never commits provisional text. A real
// guardrail rejection has a different upstream contract and is not simulated.

const encoder = new TextEncoder();
const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function fixture(mode: 'complete' | 'broken' | 'guardrail' = 'complete') {
  const apiPort = await freePort();
  const webPort = await freePort();
  let release!: () => void;
  let firstDelta!: () => void;
  const finalGate = new Promise<void>((resolve) => (release = resolve));
  const deltaSent = new Promise<void>((resolve) => (firstDelta = resolve));
  const times: {
    deltaSent?: number;
    finalSent?: number;
    brokenAt?: number;
    apiResponseClosedAt?: number;
    apiResponseWritableEnded?: boolean;
    apiResponseErrorAt?: number;
  } = {};
  let upstreamCalls = 0;
  const api = createApiServer({
    appId: 'FixtureApp',
    apiKey: 'fixture-only',
    environment: 'development',
    developmentAgentId: 'fixture-agent',
    fetch: async (input) => {
      if (!String(input).includes('/agent-studio/')) {
        const empty = {
          hits: [],
          nbHits: 0,
          page: 0,
          nbPages: 0,
          hitsPerPage: 20,
          processingTimeMS: 0,
          query: '',
          params: '',
          facets: {},
        };
        return new Response(JSON.stringify({ ...empty, results: [empty] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      upstreamCalls++;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(event({ type: 'start', messageId: 'assistant-progress' }));
          controller.enqueue(event({ type: 'text-start', id: 'text-progress' }));
          controller.enqueue(
            event({ type: 'text-delta', id: 'text-progress', delta: 'A first thought for you.' }),
          );
          times.deltaSent = Date.now();
          firstDelta();
          await finalGate;
          if (mode === 'broken') {
            times.brokenAt = Date.now();
            controller.error(new Error('Fixture stream stopped before final validation'));
            return;
          }
          if (mode === 'guardrail') {
            controller.enqueue(
              event({
                type: 'data-guardrail-violation',
                data: {
                  category: 'fixture-output-policy',
                  guardrailType: 'output',
                  fallbackResponse: 'Please rephrase your request.',
                },
              }),
            );
            controller.enqueue(event({ type: 'finish' }));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          controller.enqueue(
            event({ type: 'text-delta', id: 'text-progress', delta: ' Here is the rest.' }),
          );
          controller.enqueue(event({ type: 'text-end', id: 'text-progress' }));
          controller.enqueue(event({ type: 'finish' }));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          times.finalSent = Date.now();
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      });
    },
  });
  api.on('request', (request, response) => {
    if (request.url !== '/api/chat') return;
    response.on('close', () => {
      times.apiResponseClosedAt = Date.now();
      times.apiResponseWritableEnded = response.writableEnded;
    });
    response.on('error', () => {
      times.apiResponseErrorAt = Date.now();
    });
  });
  await new Promise<void>((resolve) => api.listen(apiPort, '127.0.0.1', resolve));
  const vite = await createViteServer({
    configFile: false,
    root: process.cwd(),
    plugins: [react()],
    server: {
      host: 'localhost',
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          configure(proxy) {
            proxy.on('proxyReq', (request) => request.setHeader('origin', 'http://localhost:5173'));
          },
        },
      },
    },
  });
  await vite.listen();
  return {
    url: `http://localhost:${webPort}`,
    release,
    deltaSent,
    times,
    get upstreamCalls() {
      return upstreamCalls;
    },
    close: async () => {
      release();
      await vite.close();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    },
  };
}

test('assistant text reaches the shopper before the final SSE event', async ({ browser }) => {
  test.setTimeout(90_000);
  const service = await fixture();
  const context = await browser.newContext();
  const page = await context.newPage();
  const output = await mkdtemp(path.join(tmpdir(), 'jtv-stream-progress-'));
  const network: Array<{ status: number; contentType: string; receivedAt: number }> = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const chatRequests = new Set<string>();
  let browserReceivedBytes = 0;
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request.url.includes('/api/chat')) chatRequests.add(requestId);
  });
  cdp.on('Network.dataReceived', ({ requestId, dataLength }) => {
    if (chatRequests.has(requestId)) browserReceivedBytes += dataLength;
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/chat')) {
      network.push({
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        receivedAt: Date.now(),
      });
    }
  });
  try {
    await page.goto(service.url);
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    await panel.getByRole('textbox', { name: 'Message the Concierge' }).fill('Help me choose.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await service.deltaSent;
    await expect.poll(() => network.length).toBe(1);
    await expect.poll(() => browserReceivedBytes).toBeGreaterThan(0);
    // Give the browser a bounded chance to paint the delivered delta while
    // the fixture deliberately withholds text-end, finish and [DONE].
    await page.waitForTimeout(700);
    const heldAt = Date.now();
    const assistant = panel.locator('.connected-assistant-message');
    const whileHeld = {
      assistantText: await assistant.allTextContents(),
      productCards: await panel.locator('.pw-product').count(),
      notices: await panel.locator('.connected-system-notice').allTextContents(),
      composerDisabled: await panel
        .getByRole('textbox', { name: 'Message the Concierge' })
        .isDisabled(),
      finalSent: service.times.finalSent ?? null,
    };
    await page.screenshot({ path: path.join(output, 'while-stream-held.png'), fullPage: true });
    service.release();
    await expect(assistant).toContainText('A first thought for you. Here is the rest.');
    const afterFinal = {
      assistantText: await assistant.allTextContents(),
      productCards: await panel.locator('.pw-product').count(),
      notices: await panel.locator('.connected-system-notice').allTextContents(),
    };
    await page.screenshot({ path: path.join(output, 'after-final.png'), fullPage: true });
    await writeFile(
      path.join(output, 'evidence.json'),
      JSON.stringify(
        {
          fixtureTimes: service.times,
          heldAt,
          network,
          browserReceivedBytes,
          whileHeld,
          afterFinal,
        },
        null,
        2,
      ),
    );
    console.log(`STREAM_PROGRESS_EVIDENCE=${output}`);
    expect(service.upstreamCalls).toBe(1);
    expect(network[0].status).toBe(200);
    expect(network[0].contentType).toContain('text/event-stream');
    expect(service.times.deltaSent).toBeLessThan(heldAt);
    expect(whileHeld.finalSent).toBeNull();
    expect(whileHeld.productCards).toBe(0);
    expect(whileHeld.notices).toEqual([]);
    expect(whileHeld.assistantText.join(' ')).toContain('A first thought for you.');
    expect(afterFinal.assistantText.join(' ')).toContain(
      'A first thought for you. Here is the rest.',
    );
  } finally {
    service.release();
    await context.close();
    await service.close();
  }
});

test('an incomplete SSE reply does not commit its provisional text', async ({ browser }) => {
  test.setTimeout(90_000);
  const service = await fixture('broken');
  const context = await browser.newContext();
  const page = await context.newPage();
  const output = await mkdtemp(path.join(tmpdir(), 'jtv-stream-incomplete-'));
  const browserFailure: Array<{ at: number; failure: string | null }> = [];
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/chat')) {
      browserFailure.push({ at: Date.now(), failure: request.failure()?.errorText ?? null });
    }
  });
  try {
    await page.goto(service.url);
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    await panel.getByRole('textbox', { name: 'Message the Concierge' }).fill('Help me choose.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await service.deltaSent;
    await page.waitForTimeout(700);
    const whileHeld = await panel.locator('.connected-assistant-message').allTextContents();
    await page.screenshot({ path: path.join(output, 'while-stream-held.png'), fullPage: true });
    service.release();
    const releasedAt = Date.now();
    const observations: Array<{
      at: number;
      status: string | null;
      notices: string[];
      composerDisabled: boolean;
    }> = [];
    while (Date.now() - releasedAt < 10_000) {
      await page.waitForTimeout(500);
      observations.push({
        at: Date.now(),
        status: (await panel.locator('.connected-status').allTextContents())[0] ?? null,
        notices: await panel.locator('.connected-system-notice').allTextContents(),
        composerDisabled: await panel
          .getByRole('textbox', { name: 'Message the Concierge' })
          .isDisabled(),
      });
    }
    const afterBreak = {
      assistantText: await panel.locator('.connected-assistant-message').allTextContents(),
      notices: await panel.locator('.connected-system-notice').allTextContents(),
      productCards: await panel.locator('.pw-product').count(),
      composerDisabled: await panel
        .getByRole('textbox', { name: 'Message the Concierge' })
        .isDisabled(),
    };
    await page.screenshot({ path: path.join(output, 'after-stream-break.png'), fullPage: true });
    await writeFile(
      path.join(output, 'evidence.json'),
      JSON.stringify(
        {
          fixtureTimes: service.times,
          releasedAt,
          browserFailure,
          whileHeld,
          observations,
          afterBreak,
        },
        null,
        2,
      ),
    );
    console.log(`STREAM_INCOMPLETE_EVIDENCE=${output}`);
    expect(whileHeld.join(' ')).toContain('A first thought for you.');
    expect(afterBreak.assistantText.join(' ')).not.toContain('A first thought for you.');
    expect(afterBreak.productCards).toBe(0);
    expect(afterBreak.notices).not.toEqual([]);
    expect(afterBreak.composerDisabled).toBe(false);
  } finally {
    service.release();
    await context.close();
    await service.close();
  }
});

test('a late guardrail event replaces visible provisional text with its fallback', async ({
  browser,
}) => {
  const service = await fixture('guardrail');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(service.url);
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    await panel.getByRole('textbox', { name: 'Message the Concierge' }).fill('Help me choose.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await service.deltaSent;
    const assistant = panel.locator('.connected-assistant-message');
    await expect(assistant).toContainText('A first thought for you.');
    service.release();
    await expect(assistant).toContainText('Please rephrase your request.');
    await expect(assistant).not.toContainText('A first thought for you.');
    await expect(panel.locator('.pw-product')).toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeEnabled();
  } finally {
    service.release();
    await context.close();
    await service.close();
  }
});
