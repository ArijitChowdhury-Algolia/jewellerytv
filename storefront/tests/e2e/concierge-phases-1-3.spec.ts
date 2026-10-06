import { expect, test, type Page } from '@playwright/test';
import manifest from '../../evaluation/concierge-phases-1-3/scenario-manifest.json' with { type: 'json' };

const runLive = process.env.JTV_RUN_LIVE_CONCIERGE_E2E === '1';

async function openConnectedConcierge(page: Page, route: string) {
  await page.goto(route);
  const opener = page.getByRole('button', { name: 'Open jewelry Concierge' });
  await expect(opener).toBeVisible();
  await opener.click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Message the Concierge' })).toBeVisible();
  return panel;
}

async function sendTurn(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message the Concierge' });
  await input.fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(input).toBeEnabled({ timeout: 120_000 });
}

test.describe('ConnectedConcierge Phase 3.1 live journeys', () => {
  test.skip(!runLive, 'Live Concierge journeys are opt-in and remain unexecuted by default.');
  test.describe.configure({ mode: 'serial' });

  for (const scenario of manifest.scenarios) {
    test(`${scenario.id} (${scenario.family})`, async ({ page }) => {
      let completionRequests = 0;
      page.on('request', (request) => {
        if (request.url().endsWith('/api/chat')) completionRequests += 1;
      });
      const panel = await openConnectedConcierge(page, scenario.route);
      for (const turn of scenario.turns) {
        await sendTurn(page, turn.text);
        expect(completionRequests).toBeLessThanOrEqual(
          manifest.execution.requestAccounting.maximumShopperTurns,
        );
      }
      await expect(panel.getByRole('button', { name: 'Products', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Conversation', exact: true })).toBeVisible();
    });
  }
});
