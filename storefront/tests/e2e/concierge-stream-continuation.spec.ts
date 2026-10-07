import { expect, test } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiServer } from '../../server/api.js';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';

type Mode = 'complete' | 'broken';
type ChatReceipt = { round: number; messageIds: string[]; body: string };

const line = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const encoder = new TextEncoder();

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function fixture(mode: Mode) {
  const apiPort = await freePort();
  const webPort = await freePort();
  const chats: ChatReceipt[] = [];
  const serverTelemetry: unknown[] = [];
  let round = 0;
  const api = createApiServer({
    appId: 'FixtureApp',
    apiKey: 'fixture-only',
    environment: 'development',
    developmentAgentId: 'fixture-agent',
    telemetryLogger: (entry) => serverTelemetry.push(entry),
    fetch: async (input, init) => {
      const url = String(input);
      if (!url.includes('/agent-studio/')) {
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
      round++;
      const body = String(init?.body ?? '');
      const parsed = JSON.parse(body) as { messages?: Array<{ id: string }> };
      chats.push({ round, body, messageIds: (parsed.messages ?? []).map((m) => m.id) });
      const events =
        round === 1
          ? [
              { type: 'start', messageId: 'assistant-fixture' },
              {
                type: 'tool-input-available',
                toolName: 'update_shopping_state',
                toolCallId: 'call-fixture-state',
                input: {
                  operations: [
                    {
                      action: 'add',
                      factIds: [],
                      fact: {
                        field: 'recipient',
                        value: { kind: 'text', text: 'Dad' },
                        scope: { kind: 'mission', key: null },
                        strength: 'context',
                        certainty: 'explicit',
                      },
                      sourceQuote: 'Dad',
                    },
                  ],
                },
              },
              { type: 'finish' },
            ]
          : [
              { type: 'start', messageId: 'assistant-fixture' },
              { type: 'text-start', id: 'text-fixture' },
              { type: 'text-delta', id: 'text-fixture', delta: 'Tell me what Dad enjoys wearing.' },
              ...(mode === 'complete'
                ? [{ type: 'text-end', id: 'text-fixture' }, { type: 'finish' }]
                : []),
            ];
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(line(event)));
          if (mode === 'broken' && round === 2) {
            await new Promise((resolve) => setTimeout(resolve, 30));
            controller.error(new Error('Deliberate fixture stream break'));
          } else {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      });
    },
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
            proxy.on('proxyReq', (request) => {
              // The real API accepts the fixed 5173 development Origin only.
              // Keep that policy intact while testing on private ports.
              request.setHeader('origin', 'http://localhost:5173');
            });
          },
        },
      },
    },
  });
  await vite.listen();
  return {
    baseURL: `http://localhost:${webPort}`,
    apiURL: `http://127.0.0.1:${apiPort}`,
    chats,
    serverTelemetry,
    close: async () => {
      await vite.close();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    },
  };
}

test.describe('real browser and API proxy stream continuation, no paid upstream', () => {
  test.describe.configure({ mode: 'serial' });
  for (const mode of ['complete', 'broken'] as const) {
    test(`classifies a ${mode} second SSE stream by UI and network completion`, async ({
      browser,
    }) => {
      test.setTimeout(90_000);
      const service = await fixture(mode);
      const context = await browser.newContext();
      const page = await context.newPage();
      const output = await mkdtemp(path.join(tmpdir(), `jtv-stream-${mode}-`));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      const ids = new Map<
        string,
        { url: string; status?: number; finished?: boolean; failure?: string }
      >();
      cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
        if (request.url.includes('/api/chat')) ids.set(requestId, { url: request.url });
      });
      cdp.on('Network.responseReceived', ({ requestId, response }) => {
        const item = ids.get(requestId);
        if (item) item.status = response.status;
      });
      cdp.on('Network.loadingFinished', ({ requestId }) => {
        const item = ids.get(requestId);
        if (item) item.finished = true;
      });
      cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
        const item = ids.get(requestId);
        if (item) item.failure = errorText;
      });
      const browserCalls: Array<{
        status: number | null;
        body: string | null;
        failure: string | null;
      }> = [];
      const pending: Promise<void>[] = [];
      page.on('response', (response) => {
        if (!response.url().includes('/api/chat')) return;
        pending.push(
          (async () => {
            let body: string | null = null;
            let failure: string | null = null;
            try {
              body = await response.text();
            } catch (error) {
              failure = String(error);
            }
            browserCalls.push({ status: response.status(), body, failure });
          })(),
        );
      });
      try {
        await page.goto(service.baseURL);
        await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
        const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
        const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
        await input.fill('Dad needs a gift.');
        await panel.getByRole('button', { name: 'Send', exact: true }).click();
        await expect.poll(() => service.chats.length).toBe(2);
        if (mode === 'complete') await expect(input).toBeEnabled({ timeout: 25_000 });
        else await page.waitForTimeout(1_500);
        const captureSettled = await Promise.race([
          Promise.all(pending).then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
        ]);
        const inputDisabled = await input.isDisabled();
        const visibleReply = await panel.locator('.connected-assistant-message').allTextContents();
        const notices = await panel.locator('.connected-system-notice').allTextContents();
        const storage = await page.evaluate(() => ({ ...sessionStorage }));
        const network = [...ids.values()];
        const completedKey = Object.keys(storage).find((key) =>
          key.startsWith('jtv-concierge-completed-'),
        );
        const completed = completedKey ? JSON.parse(storage[completedKey]) : null;
        // Bypass Vite for a control read through the same Node handler. This
        // third fixture round is not a shopper turn and makes no paid request.
        const direct = await context.request.post(`${service.apiURL}/api/chat`, {
          headers: { origin: 'http://localhost:5173' },
          data: JSON.parse(service.chats[1].body),
        });
        const directControl = { status: direct.status(), body: await direct.text() };
        const evidence = {
          mode,
          chats: service.chats,
          browserCalls,
          network,
          serverTelemetry: service.serverTelemetry,
          visibleReply,
          notices,
          completed,
          directControl,
          inputDisabled,
          captureSettled,
          storage,
        };
        await page.screenshot({ path: path.join(output, 'final.png'), fullPage: true });
        await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
        console.log(`STREAM_FIXTURE_${mode.toUpperCase()}=${output}`);
        expect(service.chats).toHaveLength(3);
        expect(service.chats[0].messageIds).toHaveLength(1);
        expect(service.chats[1].messageIds).toContain('assistant-fixture');
        expect(network).toHaveLength(2);
        expect(network.every((item) => item.status === 200)).toBe(true);
        expect(directControl.status).toBe(200);
        expect(directControl.body).toContain('data: [DONE]');
        if (mode === 'complete') {
          expect(network[0].finished).toBe(true);
          expect(network[1].finished || network[1].failure === 'net::ERR_ABORTED').toBeTruthy();
          expect(browserCalls[0].body).toContain('data: [DONE]');
          expect(
            browserCalls[1].body?.includes('data: [DONE]') || browserCalls[1].failure,
          ).toBeTruthy();
          expect(completed?.assistantMessageIds).toContain('assistant-fixture');
          expect(visibleReply.join(' ')).toContain('Tell me what Dad enjoys wearing.');
          expect(notices).toEqual([]);
          expect(inputDisabled).toBe(false);
        } else {
          expect(network[1].finished || network[1].failure === 'net::ERR_ABORTED').toBeTruthy();
          expect(completed?.assistantMessageIds ?? []).not.toContain('assistant-fixture');
          expect(visibleReply.join(' ')).not.toContain('Tell me what Dad enjoys wearing.');
          expect(notices).not.toEqual([]);
          expect(inputDisabled).toBe(false);
        }
      } finally {
        await context.close();
        await service.close();
      }
    });
  }
});
