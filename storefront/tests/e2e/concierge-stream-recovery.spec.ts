import { expect, test } from '@playwright/test';
import { createServer } from 'node:net';
import { createApiServer } from '../../server/api.js';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';

// Scenarios: a valid delayed stream must keep exact chunks and finish; a
// broken upstream and server timeout must terminate direct and proxied SSE
// with an error chunk and [DONE], while the browser discards provisional text
// and unlocks; intentional browser cancellation must not fabricate an error.

const encoder = new TextEncoder();
const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
const chatBody = {
  id: 'stream-recovery-test',
  messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Help me choose.' }] }],
};

async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

async function service(mode: 'broken' | 'delayed', web = false) {
  const apiPort = await freePort();
  const webPort = web ? await freePort() : null;
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  let upstreamSignal: AbortSignal | undefined;
  const api = createApiServer({
    appId: 'FixtureApp',
    apiKey: 'fixture-only',
    developmentAgentId: 'fixture-agent',
    environment: 'development',
    fetch: async (input, init) => {
      if (!String(input).includes('/agent-studio/')) {
        const empty = { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 20 };
        return new Response(JSON.stringify({ ...empty, results: [empty] }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      upstreamSignal = init?.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(event({ type: 'start', messageId: 'assistant-1' }));
          controller.enqueue(event({ type: 'text-start', id: 'text-1' }));
          controller.enqueue(
            event({ type: 'text-delta', id: 'text-1', delta: 'Provisional words.' }),
          );
          markStarted();
          await gate;
          if (mode === 'broken') {
            controller.error(new Error('private upstream detail'));
            return;
          }
          controller.enqueue(event({ type: 'text-end', id: 'text-1' }));
          controller.enqueue(event({ type: 'finish' }));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  await new Promise<void>((resolve) => api.listen(apiPort, '127.0.0.1', resolve));
  const vite = web
    ? await createViteServer({
        configFile: false,
        root: process.cwd(),
        plugins: [react()],
        server: {
          host: 'localhost',
          port: webPort!,
          strictPort: true,
          proxy: {
            '/api': {
              target: `http://127.0.0.1:${apiPort}`,
              configure(proxy) {
                proxy.on('proxyReq', (request) =>
                  request.setHeader('origin', 'http://localhost:5173'),
                );
              },
            },
          },
        },
      })
    : null;
  await vite?.listen();
  return {
    apiUrl: `http://127.0.0.1:${apiPort}`,
    webUrl: webPort === null ? null : `http://localhost:${webPort}`,
    release,
    started,
    get upstreamSignal() {
      return upstreamSignal;
    },
    async close() {
      release();
      await vite?.close();
      await new Promise<void>((resolve) => api.close(() => resolve()));
    },
  };
}

function chat(url: string, signal?: AbortSignal) {
  return fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
    signal,
  });
}

test('forwards a valid delayed SSE stream without changing chunks', async () => {
  test.setTimeout(30_000);
  const fixture = await service('delayed');
  try {
    const response = await chat(fixture.apiUrl);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let received = '';
    while (!received.includes('Provisional words.')) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
      received += new TextDecoder().decode(chunk.value);
    }
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    fixture.release();
    let rest = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toContain('"type":"finish"');
    expect(rest).toContain('data: [DONE]');
    expect(rest).not.toContain('"type":"error"');
    expect(received + rest).toBe(
      [
        event({ type: 'start', messageId: 'assistant-1' }),
        event({ type: 'text-start', id: 'text-1' }),
        event({ type: 'text-delta', id: 'text-1', delta: 'Provisional words.' }),
        event({ type: 'text-end', id: 'text-1' }),
        event({ type: 'finish' }),
        encoder.encode('data: [DONE]\n\n'),
      ]
        .map((chunk) => new TextDecoder().decode(chunk))
        .join(''),
    );
  } finally {
    await fixture.close();
  }
});

test('terminates a broken direct stream with an SDK error and [DONE]', async () => {
  test.setTimeout(20_000);
  const fixture = await service('broken');
  try {
    const response = await chat(fixture.apiUrl);
    await fixture.started;
    fixture.release();
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SSE did not end')), 4_000),
      ),
    ]);
    expect(text).toContain('"type":"error"');
    expect(text).toContain('data: [DONE]');
    expect(text).not.toContain('private upstream detail');
    expect(text).not.toContain('"type":"finish"');
  } finally {
    await fixture.close();
  }
});

test('terminates a timed-out stream while the browser remains connected', async () => {
  test.setTimeout(20_000);
  const fixture = await service('delayed');
  const originalSetTimeout = globalThis.setTimeout;
  let fireServerTimeout: (() => void) | undefined;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (timeout === 180_000 && typeof handler === 'function') {
      fireServerTimeout = () => handler(...args);
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;
  try {
    const response = await chat(fixture.apiUrl);
    globalThis.setTimeout = originalSetTimeout;
    expect(response.status).toBe(200);
    expect(fireServerTimeout).toBeDefined();
    fireServerTimeout!();
    const text = await Promise.race([
      response.text(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SSE did not end')), 4_000),
      ),
    ]);
    expect(text).toContain('"type":"error"');
    expect(text).toContain('data: [DONE]');
    expect(text).not.toContain('"type":"finish"');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    fixture.release();
    await fixture.close();
  }
});

test('proxied browser recovers from a broken stream without committing provisional text', async ({
  browser,
}, testInfo) => {
  test.setTimeout(40_000);
  const fixture = await service('broken', true);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(fixture.webUrl!);
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
    await input.fill('Help me choose.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await fixture.started;
    fixture.release();
    await expect(input).toBeEnabled({ timeout: 5_000 });
    await expect(panel.locator('.connected-system-notice')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('recovered.png'), fullPage: true });
    const proxiedResponse = await chat(fixture.webUrl!);
    expect(proxiedResponse.status).toBe(200);
    const proxiedText = await proxiedResponse.text();
    expect(proxiedText).toContain('"type":"error"');
    expect(proxiedText).toContain('data: [DONE]');
    expect(await panel.locator('.connected-assistant-message').allTextContents()).not.toContain(
      'Provisional words.',
    );
    expect(await panel.locator('.pw-product').count()).toBe(0);
  } finally {
    fixture.release();
    await context.close();
    await fixture.close();
  }
});

test('browser cancellation aborts upstream without a fabricated error event', async () => {
  test.setTimeout(20_000);
  const fixture = await service('delayed');
  try {
    const controller = new AbortController();
    const response = await chat(fixture.apiUrl, controller.signal);
    await fixture.started;
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await expect.poll(() => fixture.upstreamSignal?.aborted).toBe(true);
  } finally {
    fixture.release();
    await fixture.close();
  }
});
