import { expect, test } from '@playwright/test';
import { createServer } from 'node:net';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiServer } from '../../server/api.js';

const encoder = new TextEncoder();
const line = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const assistantId = 'assistant-captured-duplicate';
const firstText = 'I’ve noted her everyday studs and will keep the unknown ring size in mind.';
const finalText = 'A blue necklace could avoid guessing her ring size.';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function fixture() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const requests: string[] = [];
  let round = 0;
  const api = createApiServer({
    appId: 'FixtureApp',
    apiKey: 'fixture-only',
    environment: 'development',
    developmentAgentId: 'fixture-agent',
    fetch: async (input, init) => {
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
      requests.push(String(init?.body ?? ''));
      round += 1;
      const events =
        round === 1
          ? [
              { type: 'start', messageId: assistantId },
              { type: 'text-start', id: 'pre-tool-text' },
              { type: 'text-delta', id: 'pre-tool-text', delta: firstText },
              { type: 'text-end', id: 'pre-tool-text' },
              {
                type: 'tool-input-available',
                toolName: 'update_shopping_state',
                toolCallId: 'call-state',
                input: {
                  operations: [
                    {
                      action: 'add',
                      factIds: [],
                      fact: {
                        field: 'recipient',
                        value: { kind: 'text', text: 'wife' },
                        scope: { kind: 'recipient', key: 'wife' },
                        strength: 'context',
                        certainty: 'explicit',
                      },
                      sourceQuote: 'my wife',
                    },
                  ],
                },
              },
              { type: 'finish' },
            ]
          : [
              { type: 'start', messageId: assistantId },
              { type: 'text-start', id: 'post-tool-text' },
              { type: 'text-delta', id: 'post-tool-text', delta: finalText },
              { type: 'text-end', id: 'post-tool-text' },
              { type: 'finish' },
            ];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) controller.enqueue(encoder.encode(line(event)));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
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
            proxy.on('proxyReq', (request) => request.setHeader('origin', 'http://localhost:5173'));
          },
        },
      },
    },
  });
  await vite.listen();
  return {
    url: `http://localhost:${webPort}`,
    requests,
    close: async () => {
      await vite.close();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    },
  };
}

test('preserves text before and after a tool call as separate parts in one assistant rail', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const service = await fixture();
  try {
    await page.goto(service.url);
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
    await input.fill('I want a tenth-anniversary gift for my wife.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(input).toBeEnabled({ timeout: 20_000 });
    await expect.poll(() => service.requests.length).toBe(2);
    const rails = panel.locator('.connected-assistant-message');
    const textParts = panel.locator('.connected-assistant-text-part');
    await expect(rails).toHaveCount(1);
    await expect(textParts).toHaveCount(2);
    await expect(textParts.nth(0)).toHaveText(firstText);
    await expect(textParts.nth(1)).toHaveText(finalText);
    await expect(panel.locator('.pw-product')).toHaveCount(0);
    const completed = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((item) =>
        item.startsWith('jtv-concierge-completed-'),
      );
      return key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
    });
    expect(completed?.assistantMessageIds).toContain(assistantId);
  } finally {
    await service.close();
  }
});
