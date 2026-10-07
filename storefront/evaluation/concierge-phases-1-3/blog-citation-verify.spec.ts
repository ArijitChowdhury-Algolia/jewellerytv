import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Blog citation verification for the canonical_url Markdown-link instruction.
// Opt-in only; one shopper educational turn through the real Concierge.
// Invocation: JTV_RUN_BLOG_CITATION_VERIFY=1 npx playwright test --config evaluation/concierge-phases-1-3/blog-citation-verify.config.ts
// Verifies: the rendered reply's clickable href(s) equal canonical_url values
// of blog records actually retrieved in that turn; no invented URL is rendered.

const live = process.env.JTV_RUN_BLOG_CITATION_VERIFY === '1';

test('Varied educational turn renders only retrieved canonical URLs as links', async ({ page }, testInfo) => {
  test.skip(!live, 'Paid connected verification is opt-in (JTV_RUN_BLOG_CITATION_VERIFY=1).');
  const runDir = path.resolve(
    '..',
    '.checkpoint',
    'runs',
    `blog-citation-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
  fs.mkdirSync(runDir, { recursive: true });
  const startedAt = Date.now();
  const bodies: unknown[] = [];
  const capture: Promise<void>[] = [];
  let completionRequests = 0;
  // A one-turn harness stop condition, not a product or model response limit.
  const maxCompletionRequests = 8;
  await page.route('**/api/chat', async (route) => {
    completionRequests += 1;
    if (completionRequests > maxCompletionRequests) return route.abort('blockedbyclient');
    return route.continue();
  });
  page.on('response', (response) => {
    if (!response.url().includes('/api/agent-evidence')) return;
    capture.push(
      response
        .json()
        .then((body: unknown) => {
          bodies.push(body);
        })
        .catch(() => {
          bodies.push({ unreadable: true, url: response.url() });
        }),
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
  await expect(input).toBeVisible();

  // Varied wording: item-scoped care question, different from the C3a smoke phrasing.
  const question =
    process.env.JTV_BLOG_QUESTION ??
    'What does JTV’s sapphire guide explain about natural and lab-created sapphire? Please link the article you used.';
  await input.fill(question);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(input).toBeEnabled({ timeout: 120_000 });
  await Promise.allSettled(capture);

  const reply = panel.locator('.connected-assistant-message').last();
  await expect(reply).toBeVisible();
  const replyText = (await reply.textContent()) ?? '';
  const hrefs = await reply.locator('a').evaluateAll((anchors) =>
    anchors.map((a) => (a as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
  );

  // Canonical URLs from this turn's retrieved blog records (envelope nests under record).
  const canonicalUrls = bodies
    .flatMap((body) => {
      const result = body as {
        status?: string;
        source?: string;
        records?: Array<{
          source?: string;
          contentHash?: string;
          record?: { canonical_url?: string };
        }>;
      };
      if (result.status !== 'ok' || result.source !== 'blog') return [];
      return (result.records ?? [])
        .filter((record) => record.source === 'blog' && !!record.contentHash)
        .map((record) => record.record?.canonical_url ?? '');
    })
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return (
          parsed.protocol === 'https:' &&
          (parsed.hostname === 'jtv.com' || parsed.hostname.endsWith('.jtv.com'))
        );
      } catch {
        return false;
      }
    });

  const supported = hrefs.filter((href) => canonicalUrls.includes(href as string));
  const unsupported = hrefs.filter((href) => !canonicalUrls.includes(href as string));

  const result = {
    question,
    replyText,
    hrefs,
    canonicalUrls,
    supported,
    unsupported,
    blogCallsCaptured: bodies.length,
    completionRequests,
    elapsedMs: Date.now() - startedAt,
    at: new Date().toISOString(),
    verdict:
      completionRequests > maxCompletionRequests
        ? 'fail: completion stop condition exceeded'
        : unsupported.length > 0
        ? 'fail: invented or unsupported URL rendered'
        : canonicalUrls.length === 0
          ? 'fail: no retrieved canonical JTV article'
          : hrefs.length === 0
            ? 'fail: no article link rendered'
          : supported.length === hrefs.length
            ? 'pass: every rendered href equals a retrieved canonical_url'
            : 'unknown: mixed support',
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log('BLOG-CITATION-RESULT', JSON.stringify(result, null, 2));

  expect(completionRequests).toBeLessThanOrEqual(maxCompletionRequests);
  expect(canonicalUrls.length, 'a JTV blog article must have been retrieved').toBeGreaterThan(0);
  expect(hrefs.length, 'the completed answer must render a clickable article link').toBeGreaterThan(0);
  expect(unsupported, 'rendered hrefs must all equal retrieved blog canonical_url values').toEqual([]);
});
