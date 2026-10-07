import { expect, test } from '@playwright/test';

// Scenario list: new streamed text follows the bottom of a long conversation;
// a shopper scrolling upward keeps their place while more text arrives;
// the fixture never calls the live agent.
test('streamed answer follows the bottom until the shopper scrolls away', async ({ page }) => {
  type FixtureWindow = Window & { emitChat?: (event: unknown) => void; closeChat?: () => void };
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(raw, location.href).pathname !== '/api/chat') return originalFetch(input, init);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (window as FixtureWindow).emitChat = (event) =>
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          (window as FixtureWindow).closeChat = () => controller.close();
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'x-vercel-ai-ui-message-stream': 'v1',
          },
        }),
      );
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying concierge' });
  await panel
    .getByRole('textbox', { name: 'Message the Concierge' })
    .fill('Tell me about necklaces');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await page.evaluate(() => {
    const emit = (window as FixtureWindow).emitChat;
    emit?.({ type: 'start', messageId: 'assistant-scroll' });
    emit?.({ type: 'text-start', id: 'text-scroll' });
    emit?.({
      type: 'text-delta',
      id: 'text-scroll',
      delta: Array.from({ length: 80 }, (_, index) => `Line ${index}: a useful thought.\n`).join(
        '',
      ),
    });
  });
  const transcript = panel.locator('.concierge-messages');
  await expect(panel.locator('.connected-assistant-message')).toContainText('Line 79');
  await expect
    .poll(() =>
      transcript.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight),
    )
    .toBeLessThan(4);

  await transcript.evaluate((node) => (node.scrollTop = 0));
  await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBe(0);
  await page.evaluate(() => {
    (window as FixtureWindow).emitChat?.({
      type: 'text-delta',
      id: 'text-scroll',
      delta: 'Another thought after you scrolled up.',
    });
  });
  await expect(panel.locator('.connected-assistant-message')).toContainText(
    'Another thought after you scrolled up.',
  );
  expect(await transcript.evaluate((node) => node.scrollTop)).toBe(0);
  await page.evaluate(() => (window as FixtureWindow).closeChat?.());
});
