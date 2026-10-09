import { expect, test } from '@playwright/test';

// Scenario list: a three-column educational table stays readable in the chat
// pane; long cell text wraps at words; narrow screens scroll the table rather
// than splitting a heading into individual letters. All agent calls are stubbed.
test('educational Markdown table remains readable in the conversation pane', async ({
  page,
}, testInfo) => {
  const answer = [
    'The simple version',
    '',
    '| Term | What it means | Is it a genuine pearl? |',
    '| --- | --- | --- |',
    '| Natural pearl | Forms without farming intervention. | Yes |',
    '| Cultured pearl | Grown with human assistance in a farmed mollusk. | Yes |',
    '| Lab pearl | This phrase can be used inconsistently; check the listing. | Check the description |',
    '| Imitation or simulant pearl | Made to resemble a pearl. | No |',
    '',
    'Both natural and cultured pearls are genuine pearls.',
  ].join('\n');
  const events = [
    { type: 'start', messageId: 'assistant-table' },
    { type: 'text-start', id: 'table-text' },
    { type: 'text-delta', id: 'table-text', delta: answer },
    { type: 'text-end', id: 'table-text' },
    { type: 'finish' },
  ];
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
      body:
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying concierge' });
  await panel.getByRole('textbox', { name: 'Message the Concierge' }).fill('Explain pearl terms');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  const table = panel.locator('.connected-assistant-message table');
  const glossary = panel.locator('.connected-table-glossary');
  const narrow = (page.viewportSize()?.width ?? 0) <= 1100;
  if (narrow) {
    await expect(table).toBeHidden();
    await expect(glossary).toBeVisible();
    await expect(glossary.locator('.connected-table-entry')).toHaveCount(4);
    await expect(glossary).toContainText('Check the description');
  } else {
    await expect(table).toBeVisible();
    await expect(glossary).toBeHidden();
  }
  const geometry = await table.evaluate((element) => {
    const pane = element.closest('.conversation-column')!;
    const heading = element.querySelector('th:last-child')!;
    return {
      paneWidth: pane.getBoundingClientRect().width,
      tableWidth: element.getBoundingClientRect().width,
      glossaryWidth: pane.querySelector('.connected-table-glossary')?.getBoundingClientRect().width ?? 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      headingWidth: heading.getBoundingClientRect().width,
      headingWordBreak: getComputedStyle(heading).wordBreak,
      headingOverflowWrap: getComputedStyle(heading).overflowWrap,
    };
  });
  if (narrow) {
    expect(geometry.glossaryWidth).toBeLessThanOrEqual(geometry.paneWidth);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(
      await glossary.locator('.connected-table-entry').first().evaluate((element) => ({
        border: getComputedStyle(element).borderTopWidth,
        background: getComputedStyle(element).backgroundColor,
      })),
    ).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)' });
  } else {
    expect(geometry.tableWidth).toBeLessThanOrEqual(geometry.paneWidth);
    expect(geometry.headingWidth).toBeGreaterThanOrEqual(55);
    expect(geometry.headingWordBreak).toBe('normal');
    expect(geometry.headingOverflowWrap).toBe('normal');
  }
  await panel.screenshot({ path: testInfo.outputPath('educational-table.png') });
  if (!narrow) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(table).toBeHidden();
    await expect(glossary).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath('educational-table-tablet.png') });
  }
});
