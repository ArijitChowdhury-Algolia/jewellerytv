import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A saved prior F2 mission exercises workspace actions without an Agent Studio call.
// It is a UI fixture only and cannot pass the connected Father story.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = process.env.JTV_FATHER_FIXTURE_SESSION ?? '';
const outDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `fathers-day-full-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

test('saved Father state supports real Save, Compare and Combination controls', async ({
  browser,
}) => {
  test.skip(!fixturePath, 'Pass a saved F2-session.json as JTV_FATHER_FIXTURE_SESSION.');
  const resolved = path.resolve(fixturePath);
  if (
    !resolved.startsWith(path.join(repoRoot, '.checkpoint', 'runs') + path.sep) ||
    path.basename(resolved) !== 'F2-session.json'
  )
    throw new Error('Fixture must be a preserved F2-session.json under .checkpoint/runs.');
  const saved = JSON.parse(fs.readFileSync(resolved, 'utf8')) as Record<string, string>;
  fs.mkdirSync(outDir, { recursive: true });
  const context = await browser.newContext();
  await context.addInitScript((entries) => {
    try {
      for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value);
    } catch {
      /* about:blank can deny storage */
    }
  }, saved);
  const page = await context.newPage();
  let chatCalls = 0;
  await page.route('**/api/chat', async (route) => {
    chatCalls += 1;
    await route.abort();
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    const nav = panel.getByRole('navigation', { name: 'Product views' });
    const discover = panel.locator('.pw-discover .pw-product');
    await expect(discover.first()).toBeVisible();
    const id = await discover.first().getAttribute('data-product-id');
    expect(id).toBeTruthy();
    await discover.first().getByRole('button', { name: 'Save', exact: true }).click();
    await nav.getByRole('button', { name: /^Saved/ }).click();
    const savedCard = panel.locator(`.pw-saved .pw-product[data-product-id="${id}"]`);
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button', { name: 'Compare', exact: true }).click();
    await nav.getByRole('button', { name: /^Compare/ }).click();
    await expect(
      panel.locator(`.pw-comparison .pw-compare-product[data-product-id="${id}"]`),
    ).toBeVisible();
    await nav.getByRole('button', { name: /^Saved/ }).click();
    await savedCard.getByRole('button', { name: 'Add to combination' }).click();
    await nav.getByRole('button', { name: /^Combination/ }).click();
    const combined = panel.locator(`.pw-comparison .pw-compare-product[data-product-id="${id}"]`);
    await expect(combined).toBeVisible();
    await panel
      .getByRole('region', { name: 'Shopping choices' })
      .screenshot({ path: path.join(outDir, 'fixture-combination.png') });
    await combined.getByRole('button', { name: 'Remove from combination' }).click();
    await expect(panel.locator('.pw-comparison .pw-compare-product')).toHaveCount(0);
    expect(chatCalls).toBe(0);
    fs.writeFileSync(
      path.join(outDir, 'result.json'),
      JSON.stringify(
        { mode: 'saved-state-UI-fixture-not-connected', productId: id, chatCalls, outcome: 'pass' },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
