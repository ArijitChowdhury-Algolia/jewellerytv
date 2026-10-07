import { expect, test } from '@playwright/test';

/*
Scenario list:
- Desktop window moves with keyboard, resizes, maximizes and restores its prior bounds.
- The conversation pane has no horizontal divider directly below the blue header.
- Mobile keeps the Concierge full-screen and hides desktop move/resize controls.
*/
test.beforeEach(async ({ page }) => {
  await page.route('**/api/search', async (route) => {
    const body = route.request().postDataJSON() as {
      requests?: Array<{ params?: { query?: string } }>;
    };
    const results = (body.requests ?? []).map((request) => ({
      hits: [],
      nbHits: 0,
      nbPages: 0,
      page: 0,
      hitsPerPage: 24,
      processingTimeMS: 0,
      query: request.params?.query ?? '',
      exhaustiveNbHits: true,
      facets: {},
      facets_stats: {},
      renderingContent: {},
    }));
    await route.fulfill({ json: { results } });
  });
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 500, json: { error: 'Chat is disabled in window UI tests' } }),
  );
});

async function openConcierge(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /open jewelry concierge/i }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel).toBeVisible();
  return panel;
}

test('desktop window moves and resizes by pointer and keyboard, then restores from maximize', async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, 'Desktop-only window controls');
  const panel = await openConcierge(page);
  await expect(page.getByRole('textbox', { name: 'Message the Concierge' })).toHaveAttribute(
    'placeholder',
    'Shall we find something delighting?',
  );
  const header = panel.locator('.concierge-header');
  await expect(header.getByRole('button', { name: 'Start a new conversation' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Close Concierge' })).toBeVisible();
  await expect(header.getByRole('button', { name: /resize concierge window/i })).toHaveCount(0);
  await expect(header.getByRole('button', { name: /maximize concierge window/i })).toHaveCount(1);
  await expect(header.getByRole('button', { name: 'Close Concierge' })).toHaveText('');
  const initial = await panel.boundingBox();
  expect(initial).not.toBeNull();
  expect(
    await panel
      .locator('.concierge-header')
      .evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('none');

  const move = panel.getByRole('button', { name: /move concierge window/i });
  await move.focus();
  await move.press('ArrowDown');
  await expect.poll(async () => (await panel.boundingBox())?.y).toBe((initial?.y ?? 0) + 24);

  const movedByKeyboard = await panel.boundingBox();
  const headerBox = await panel.locator('.concierge-header').boundingBox();
  expect(headerBox).not.toBeNull();
  const dragStart = { x: (headerBox?.x ?? 0) + 80, y: (headerBox?.y ?? 0) + 20 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x - 24, dragStart.y + 20);
  await page.mouse.up();
  const movedByPointer = await panel.boundingBox();
  expect(movedByPointer?.x).toBe(Math.max(16, (movedByKeyboard?.x ?? 0) - 24));
  expect(movedByPointer?.y).toBe((movedByKeyboard?.y ?? 0) + 20);

  const resize = panel.getByRole('button', { name: /resize concierge window/i });
  await expect(resize).toHaveCSS('cursor', 'nwse-resize');
  const resizeBox = await resize.boundingBox();
  expect(resizeBox).not.toBeNull();
  const resizeStart = { x: (resizeBox?.x ?? 0) + 20, y: (resizeBox?.y ?? 0) + 20 };
  await page.mouse.move(resizeStart.x, resizeStart.y);
  await page.mouse.down();
  await page.mouse.move(resizeStart.x - 20, resizeStart.y - 20);
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())?.width)
    .toBe((movedByPointer?.width ?? 0) - 20);

  const resizedByPointer = await panel.boundingBox();
  await resize.focus();
  await resize.press('ArrowLeft');
  await expect
    .poll(async () => (await panel.boundingBox())?.width)
    .toBe((resizedByPointer?.width ?? 0) - 24);

  const resized = await panel.boundingBox();
  await panel.getByRole('button', { name: 'Maximize Concierge window' }).click();
  await expect(panel.getByRole('button', { name: 'Restore Concierge window' })).toBeVisible();
  await expect.poll(async () => await panel.boundingBox()).toMatchObject({ x: 0, y: 0 });
  expect(await panel.boundingBox()).toMatchObject({
    width: page.viewportSize()?.width,
    height: page.viewportSize()?.height,
  });

  await panel.getByRole('button', { name: 'Restore Concierge window' }).click();
  await expect(panel.getByRole('button', { name: 'Maximize Concierge window' })).toBeVisible();
  await expect.poll(async () => await panel.boundingBox()).toEqual(resized);

  const headerBorder = await panel
    .locator('.concierge-header')
    .evaluate((element) => getComputedStyle(element).borderBottomWidth);
  expect(headerBorder).toBe('0px');
  const preferencesBorder = await panel
    .locator('.conversation-brief')
    .evaluate((element) => getComputedStyle(element).borderBottomWidth);
  expect(preferencesBorder).toBe('0px');
});

test('mobile keeps the Concierge full-screen without desktop window controls', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, 'Mobile-only responsive behavior');
  const panel = await openConcierge(page);
  await expect(page.getByRole('textbox', { name: 'Message the Concierge' })).toHaveAttribute(
    'placeholder',
    'Shall we find something delighting?',
  );
  expect(
    await panel
      .locator('.concierge-header')
      .evaluate((element) => getComputedStyle(element).touchAction),
  ).toBe('auto');
  await expect
    .poll(async () => await panel.boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width: 375,
      height: 812,
    });
  await expect(panel.getByRole('button', { name: /resize concierge window/i })).toBeHidden();
  await expect(panel.getByRole('button', { name: /maximize concierge window/i })).toBeHidden();
  await expect(panel.getByRole('button', { name: /move concierge window/i })).toBeHidden();
  await expect(panel.locator('.connected-prompt-hint')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 812 });
  await expect(panel.locator('.connected-prompt-hint')).toHaveText(
    'Shall we find something delighting?',
  );
  await expect(panel.locator('.connected-prompt-hint')).toBeVisible();
  await panel.getByRole('button', { name: 'Close Concierge' }).click();
  await expect(panel).toBeHidden();
});
