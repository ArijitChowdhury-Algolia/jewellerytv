import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repeatedExactTextAfterTool } from './assistantTextIntegrity';
import {
  assessBracelet,
  assessWatch,
  chooseWatchDirections,
  hasFatherOpeningContext,
  sameProductIds,
  subtotalWithinBudget,
  type CatalogRecord,
} from './fatherFullOracle';

// Scenario inventory: F1 gratitude/intake; F2 surprise and old watch; F3 two
// record-backed directions and firm total; F4 fit uncertainty; F5 refreshed
// black/steel; F6 distinct Saved choices; F7 exact Compare; F8 rating/blog
// detour; F9 recommendation; F10 optional bracelet and cent subtotal; F11
// watch-alone removal; F12 delivery boundary. Empty/unknown inventory, missing
// exact fields, stale IDs, duplicate answer, broken stream, budget exhaustion,
// over-price/stock/ownership and source drift stop or remain explicit unknowns.
// The no-chat fixture and pure record/identity tests are separate. No fixed SKU
// or illustrative Concierge sentence becomes a runtime recommendation.
const enabled = process.env.JTV_RUN_FATHER_FULL === '1';
const maxRequests = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const agentSnapshotPath = process.env.JTV_AGENT_SNAPSHOT ?? '';
const expectedAgentId = process.env.JTV_EXPECTED_AGENT_ID ?? '';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `fathers-day-full-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const sourceFiles = [
  'storefront/src/concierge/ConnectedConcierge.tsx',
  'storefront/src/concierge/sdkTools.ts',
  'storefront/src/concierge/toolRuntime.ts',
  'storefront/src/concierge/ConciergeWorkspaceProvider.tsx',
  'storefront/src/ProductWorkspace.tsx',
  'storefront/server/api.ts',
  'storefront/server/concierge/retrieveEvidence.ts',
  'storefront/shared/concierge/state/updateShoppingState.ts',
] as const;
type Status = 'pass' | 'fail' | 'unknown' | 'not-run';
type Assertion = { beat: string; id: string; status: Status; detail: string };
type Card = { id: string; title: string; price: string; text: string };
type Selection = {
  sourceIndex?: string;
  objectID?: string;
  contentHash?: string;
  evidenceRef?: string;
  raw?: CatalogRecord;
};
type Shopping = {
  missionId?: string;
  brief?: { revision?: number; facts?: unknown[] };
  products?: Selection[];
  selectionRecords?: Selection[];
  compareIds?: string[];
  combinationIds?: string[];
  combinationQuantities?: Record<string, number>;
  activeView?: string;
};
type Turn = {
  beat: string;
  shopper: string;
  reply: string;
  notice: string[];
  cards: Card[];
  completed: boolean;
  repeatedText: string | null;
  sessionFile: string | null;
  shopping: Shopping;
  links: string[];
  toolOrder: string[];
  captures: Capture[];
  completionRequests: number;
  elapsedMs: number;
  error?: string;
};
type Capture = {
  beat: string | null;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  networkFailure: string | null;
  captureError: string | null;
  responseFile: string | null;
};
class FirstFailureStop extends Error {}

function hashSources() {
  return Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(repoRoot, file)))
        .digest('hex'),
    ]),
  );
}
function git(args: string[]) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}
function ids(items: Card[]) {
  return items.map((item) => item.id);
}
function safeId(id: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`Unsafe product ID in UI: ${id}`);
  return id;
}
function shopperReference(record: CatalogRecord) {
  const title = record.Catalog_TitleDescription;
  if (typeof title === 'string' && title.length <= 160 && /^[\p{L}\p{N}\s.,'&()/-]+$/u.test(title))
    return title;
  return 'the brown leather watch you showed';
}
function receiptCount(page: Page) {
  return page.evaluate(() =>
    Object.entries(sessionStorage).reduce((total, [key, raw]) => {
      if (!key.startsWith('jtv-concierge-completed-')) return total;
      try {
        const value = JSON.parse(raw) as { assistantMessageIds?: unknown };
        return (
          total + (Array.isArray(value.assistantMessageIds) ? value.assistantMessageIds.length : 0)
        );
      } catch {
        return total;
      }
    }, 0),
  );
}
async function cards(
  page: Page,
  view: 'discover' | 'saved' | 'compare' | 'combination' | 'proposed' = 'discover',
) {
  const selector =
    view === 'discover'
      ? '.pw-discover .pw-product'
      : view === 'saved'
        ? '.pw-saved .pw-product'
        : view === 'proposed'
          ? '.pw-proposed-looks .pw-product'
          : '.pw-comparison .pw-compare-product';
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute('data-product-id') ?? '',
      title: node.querySelector('h3')?.textContent?.trim() ?? '',
      price: node.querySelector('.pw-price')?.textContent?.trim() ?? '',
      text: (node.textContent ?? '').slice(0, 1200),
    })),
  );
}
function shoppingFromSession(session: Record<string, string>): Shopping {
  try {
    return JSON.parse(session['jtv.shopping.v3'] ?? '{}') as Shopping;
  } catch {
    return {};
  }
}
function latestAssistant(session: Record<string, string>) {
  try {
    const messages = JSON.parse(session['instantsearch-chat-initial-messages'] ?? '[]') as Array<{
      role?: string;
      parts?: Array<{ type?: string; text?: string }>;
    }>;
    return [...messages].reverse().find((message) => message.role === 'assistant');
  } catch {
    return undefined;
  }
}
const sameIds = sameProductIds;

test('Father F1-F12 uninterrupted connected shopper journey', async ({ browser }) => {
  test.skip(!enabled, 'Full Father connected journey is opt-in and never runs by default.');
  test.skip(maxRequests !== 60, 'Set JTV_MAX_COMPLETION_REQUESTS=60 for the finite F1-F12 window.');
  test.skip(
    !agentSnapshotPath,
    'Pin JTV_AGENT_SNAPSHOT to the exact reviewed saved-agent readback.',
  );
  test.skip(!expectedAgentId, 'Set JTV_EXPECTED_AGENT_ID to the Controller-approved agent ID.');
  const snapshot = path.resolve(agentSnapshotPath);
  if (!snapshot.startsWith(path.join(repoRoot, 'storefront', 'evidence') + path.sep))
    throw new Error('Agent snapshot must be a saved storefront/evidence readback.');
  const agent = JSON.parse(fs.readFileSync(snapshot, 'utf8')) as {
    agentId?: string;
    hashes?: Record<string, string>;
  };
  if (agent.agentId !== expectedAgentId)
    throw new Error('Agent snapshot and expected agent ID differ.');
  const agentSnapshotHashBefore = createHash('sha256')
    .update(fs.readFileSync(snapshot))
    .digest('hex');
  fs.mkdirSync(runDir, { recursive: true });
  const sourceBefore = hashSources();
  const context = await browser.newContext();
  const page = await context.newPage();
  const captures: Capture[] = [];
  const pending: Promise<void>[] = [];
  const turns: Turn[] = [];
  const assertions: Assertion[] = [];
  const exactRecords = new Map<string, CatalogRecord>();
  let activeBeat: string | null = null;
  let requests = 0;
  let exactReads = 0;
  let budgetStopped = false;
  let firstFailure: string | null = null;
  let leatherId: string | null = null;
  let steelId: string | null = null;
  let braceletId: string | null = null;
  let savedBeforeBracelet: string[] = [];
  let priorDiscoverIds: string[] = [];
  const check = (beat: string, id: string, status: Status, detail: string) => {
    assertions.push({ beat, id, status, detail });
    if (status === 'fail' && !firstFailure) firstFailure = `${beat}:${id}`;
  };
  const halt = () => {
    if (firstFailure) throw new FirstFailureStop(firstFailure);
  };
  const panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
  const views = panel.getByRole('navigation', { name: 'Product views' });
  const view = async (name: 'Discover' | 'Saved' | 'Compare' | 'Combination') => {
    await views.getByRole('button', { name: new RegExp(`^${name}(?: \\(\\d+\\))?$`) }).click();
    await expect(
      views.getByRole('button', { name: new RegExp(`^${name}(?: \\(\\d+\\))?$`) }),
    ).toHaveAttribute('aria-current', 'page');
  };
  const save = async (id: string) => {
    const card = panel.locator(`.pw-product[data-product-id="${safeId(id)}"]`).first();
    await expect(card).toBeVisible();
    const button = card.getByRole('button', { name: 'Save', exact: true });
    await button.click();
    await expect(card.getByRole('button', { name: 'Remove from saved' })).toBeVisible();
  };
  const compare = async (id: string) => {
    const card = panel.locator(`.pw-product[data-product-id="${safeId(id)}"]`).first();
    await card.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(card.getByRole('button', { name: /Comparing/ })).toBeVisible();
  };
  const combine = async (id: string) => {
    const card = panel.locator(`.pw-product[data-product-id="${safeId(id)}"]`).first();
    await card.getByRole('button', { name: 'Add to combination' }).click();
    await expect(card.getByRole('button', { name: /In combination/ })).toBeVisible();
  };
  async function exact(id: string, beat: string): Promise<CatalogRecord | null> {
    const response = await page.request.get(`/api/products/${encodeURIComponent(id)}`);
    const body = await response.text();
    fs.writeFileSync(path.join(runDir, `${beat}-product-${safeId(id)}-${++exactReads}.json`), body);
    if (!response.ok()) {
      check(beat, 'exact-product-http', 'fail', `${id}: ${response.status()}`);
      return null;
    }
    try {
      const record = JSON.parse(body) as CatalogRecord;
      if (record.objectID !== id) {
        check(beat, 'exact-product-id', 'fail', `${id} != ${String(record.objectID)}`);
        return null;
      }
      exactRecords.set(id, record);
      return record;
    } catch {
      check(beat, 'exact-product-json', 'fail', id);
      return null;
    }
  }
  async function verifyCards(
    beat: string,
    visible: Card[],
    watchOnly: boolean,
    allowSaved = false,
  ) {
    const seen = new Set<string>();
    const session = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
    const state = shoppingFromSession(session);
    const selections = [
      ...(state.selectionRecords ?? []),
      ...(allowSaved ? (state.products ?? []) : []),
    ];
    for (const card of visible) {
      if (!card.id || seen.has(card.id)) {
        check(beat, 'visible-id', 'fail', `missing or duplicate ${card.id}`);
        continue;
      }
      seen.add(card.id);
      const selection = selections.find((item) => item.objectID === card.id);
      if (
        !selection ||
        selection.sourceIndex !== 'prod_catalog' ||
        !selection.contentHash ||
        !selection.evidenceRef?.startsWith(`prod_catalog/${card.id}/`) ||
        selection.raw?.objectID !== card.id
      )
        check(
          beat,
          'selection-provenance',
          'fail',
          `${card.id}: missing or mismatched bound prod_catalog record`,
        );
      const record = await exact(card.id, beat);
      if (!record) continue;
      const assessment = assessWatch(record, 350);
      if (watchOnly && assessment.hardFailures.length)
        check(beat, 'watch-boundary', 'fail', `${card.id}: ${assessment.hardFailures.join(',')}`);
      if (watchOnly && assessment.unknowns.length)
        check(beat, 'watch-fields', 'unknown', `${card.id}: ${assessment.unknowns.join(',')}`);
      const listing =
        typeof record.Pricing_ActivePrice === 'number'
          ? `$${record.Pricing_ActivePrice.toFixed(2)}`
          : null;
      if (listing && !card.price.replace(/,/g, '').includes(listing))
        check(beat, 'visible-price', 'fail', `${card.id}: card ${card.price}, exact ${listing}`);
    }
  }
  await page.route('**/api/chat', async (route) => {
    requests += 1;
    if (requests > 60) {
      budgetStopped = true;
      await route.abort();
    } else await route.continue();
  });
  page.on('request', (request: Request) => {
    if (
      !['/api/chat', '/api/agent-evidence', '/api/agent-product-refresh', '/api/products/'].some(
        (part) => request.url().includes(part),
      )
    )
      return;
    const index = captures.length;
    const item: Capture = {
      beat: activeBeat,
      url: request.url(),
      method: request.method(),
      requestBody: request.postData(),
      status: null,
      networkFailure: null,
      captureError: null,
      responseFile: null,
    };
    captures.push(item);
    pending.push(
      (async () => {
        try {
          const response = await request.response();
          item.status = response?.status() ?? null;
          if (!response) return;
          const file = `${activeBeat ?? 'outside'}-${index}-${request.url().includes('/api/chat') ? 'chat' : 'evidence'}.txt`;
          fs.writeFileSync(path.join(runDir, file), await response.body());
          item.responseFile = file;
        } catch (error) {
          item.captureError = String(error);
          item.networkFailure = request.failure()?.errorText ?? null;
        }
      })(),
    );
  });
  async function run(beat: string, shopper: string) {
    const start = Date.now();
    const requestStart = requests;
    const captureStart = captures.length;
    const pendingStart = pending.length;
    const replyStart = await panel.locator('.connected-assistant-message').count();
    const receiptStart = await receiptCount(page);
    const turn: Turn = {
      beat,
      shopper,
      reply: '',
      notice: [],
      cards: [],
      completed: false,
      repeatedText: null,
      sessionFile: null,
      shopping: {},
      links: [],
      toolOrder: [],
      captures: [],
      completionRequests: 0,
      elapsedMs: 0,
    };
    turns.push(turn);
    activeBeat = beat;
    try {
      const input = panel.getByRole('textbox', { name: 'Message the Concierge' });
      await input.fill(shopper);
      await panel.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(input).toBeDisabled({ timeout: 10_000 });
      await expect(input).toBeEnabled({ timeout: 180_000 });
      const replies = await panel.locator('.connected-assistant-message').count();
      if (replies > replyStart)
        turn.reply = (
          await panel.locator('.connected-assistant-message').last().innerText()
        ).trim();
      turn.notice = await panel.locator('.connected-system-notice').allTextContents();
      turn.cards = await cards(page);
      turn.links = await panel
        .locator('.connected-assistant-message')
        .last()
        .locator('a[href]')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
    } catch (error) {
      turn.error = String(error);
    } finally {
      await Promise.allSettled(pending.slice(pendingStart));
      try {
        const session = await page.evaluate(() =>
          Object.fromEntries(Object.entries(sessionStorage)),
        );
        turn.shopping = shoppingFromSession(session);
        turn.completed = (await receiptCount(page)) > receiptStart;
        const assistant = latestAssistant(session);
        turn.repeatedText = assistant ? repeatedExactTextAfterTool(assistant) : null;
        turn.toolOrder = (assistant?.parts ?? [])
          .map((part) => part.type ?? '')
          .filter((type) => type.startsWith('tool-'));
        turn.sessionFile = `${beat}-session.json`;
        fs.writeFileSync(path.join(runDir, turn.sessionFile), JSON.stringify(session, null, 2));
        if (
          !turn.reply &&
          (await panel.locator('.connected-assistant-message').count()) > replyStart
        )
          turn.reply = (
            await panel.locator('.connected-assistant-message').last().innerText()
          ).trim();
        turn.notice = await panel.locator('.connected-system-notice').allTextContents();
        turn.cards = await cards(page);
        await panel.screenshot({ path: path.join(runDir, `${beat}-panel.png`) });
        await page.screenshot({ path: path.join(runDir, `${beat}-viewport.png`), fullPage: false });
      } catch (error) {
        turn.error = `${turn.error ?? ''} | snapshot: ${String(error)}`.trim();
      }
      turn.completionRequests = requests - requestStart;
      turn.captures = captures.slice(captureStart);
      turn.elapsedMs = Date.now() - start;
      fs.writeFileSync(path.join(runDir, `${beat}.json`), JSON.stringify(turn, null, 2));
      activeBeat = null;
    }
    check(
      beat,
      'reply',
      turn.reply ? 'pass' : 'fail',
      turn.reply ? 'generated reply rendered' : 'no generated reply',
    );
    check(
      beat,
      'completed-receipt',
      turn.completed ? 'pass' : 'fail',
      turn.completed ? 'mission-scoped assistant receipt advanced' : 'no new receipt',
    );
    check(
      beat,
      'system-notice',
      turn.notice.length ? 'fail' : 'pass',
      turn.notice.join(' | ') || 'none',
    );
    check(
      beat,
      'repeated-answer',
      turn.repeatedText ? 'fail' : 'pass',
      turn.repeatedText?.slice(0, 160) ?? 'none',
    );
    if (turn.error) check(beat, 'browser', 'fail', turn.error);
    const failedCaptures = turn.captures.filter(
      (item) =>
        item.status === null ||
        item.status < 200 ||
        item.status >= 300 ||
        item.networkFailure ||
        item.captureError,
    );
    if (failedCaptures.length) {
      const onlyCompletedBodyAbort =
        turn.completed &&
        turn.reply &&
        turn.notice.length === 0 &&
        failedCaptures.every(
          (item) =>
            item.url.includes('/api/chat') &&
            item.status === 200 &&
            item.networkFailure === 'net::ERR_ABORTED',
        );
      check(
        beat,
        'transport-capture',
        onlyCompletedBodyAbort ? 'unknown' : 'fail',
        failedCaptures
          .map(
            (item) => `${item.url} status=${item.status} failure=${item.networkFailure ?? 'none'}`,
          )
          .join('; '),
      );
    }
    if (budgetStopped)
      check(beat, 'budget', 'fail', `attempted ${requests} completion requests; cap 60`);
    check(
      beat,
      'semantic',
      'unknown',
      'independent review of warmth, continuity, source support and helpfulness required',
    );
    return turn;
  }
  try {
    const health = await page.request.get('/api/health');
    fs.writeFileSync(path.join(runDir, 'health.json'), await health.text());
    check('preflight', 'health', health.ok() ? 'pass' : 'fail', String(health.status()));
    check(
      'preflight',
      'runtime-agent-identity',
      'unknown',
      `operator expected ${expectedAgentId}; /api/health does not expose the live agent ID, so independent runtime verification is required`,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    await expect(panel).toBeVisible();
    if (!firstFailure) {
      const f1 = await run(
        'F1',
        "Father's Day is coming up. Dad always says not to get him anything, but he's always been there for me. He loves watches, and I want to get him one he'd actually wear. I have no idea where to begin.",
      );
      check(
        'F1',
        'accepted-opening-context',
        hasFatherOpeningContext(f1.shopping) ? 'pass' : 'fail',
        "active recipient Dad and Father's Day occasion facts must be present",
      );
    }
    if (!firstFailure) {
      await run(
        'F2',
        "A complete surprise. He'd tell me to save my money. He still wears the same black-dial watch with a steel bracelet, even when he takes my daughter to the pool on Saturdays. Sometimes he adds a plain steel bracelet on his other wrist.",
      );
    }
    if (!firstFailure) {
      const f3 = await run(
        'F3',
        "I've seen him admire brown leather watches. Maybe that's the change, as long as the face isn't huge or busy. I can spend up to $350 for the whole gift.",
      );
      await verifyCards('F3', f3.cards, true);
      halt();
      priorDiscoverIds = ids(f3.cards);
      const budgetFacts = (f3.shopping.brief?.facts ?? []) as Array<{
        field?: string;
        status?: string;
        value?: { kind?: string; cents?: number; basis?: string; operator?: string };
      }>;
      check(
        'F3',
        'firm-total-budget',
        budgetFacts.some(
          (fact) =>
            fact.field === 'budget' &&
            fact.status !== 'retracted' &&
            fact.value?.kind === 'money' &&
            fact.value.cents === 35000 &&
            fact.value.basis === 'total' &&
            fact.value.operator === 'lte',
        )
          ? 'pass'
          : 'fail',
        'accepted brief must retain $350 total upper bound',
      );
      const updateAt = f3.toolOrder.findIndex((type) => type === 'tool-update_shopping_state');
      const retrieveAt = f3.toolOrder.findIndex((type) => type === 'tool-retrieve_evidence');
      check(
        'F3',
        'state-before-retrieval',
        updateAt >= 0 && retrieveAt > updateAt ? 'pass' : 'fail',
        f3.toolOrder.join(' -> '),
      );
      halt();
      const records = (await Promise.all(f3.cards.map((card) => exact(card.id, 'F3')))).filter(
        (record): record is CatalogRecord => !!record,
      );
      const directions = chooseWatchDirections(records, 350);
      leatherId = directions.leatherId;
      steelId = directions.steelId;
      check(
        'F3',
        'leather-direction',
        leatherId ? 'pass' : 'fail',
        leatherId ?? 'no eligible exact brown-leather watch in Discover',
      );
      check(
        'F3',
        'steel-direction',
        steelId ? 'pass' : 'unknown',
        steelId ?? 'black-steel direction may arrive at F5',
      );
    }
    if (!firstFailure && leatherId) {
      await view('Discover');
      await save(leatherId);
      const leather = exactRecords.get(leatherId)!;
      await run(
        'F4',
        `That brown-leather watch, ${shopperReference(leather)}, catches my eye. Dad's old watch sits close to his wrist. Would this one feel bulky?`,
      );
      check(
        'F4',
        'fit-claim',
        'unknown',
        'review listed case dimensions and absence of a wrist-fit promise',
      );
    }
    if (!firstFailure) {
      const before = priorDiscoverIds;
      const f5 = await run(
        'F5',
        'Could we also see a black-dial steel one with a cleaner face? I want to compare the change against what he already likes.',
      );
      await view('Discover');
      const after = ids(await cards(page));
      priorDiscoverIds = after;
      check(
        'F5',
        'discover-refreshed',
        sameIds(before, after) ? 'fail' : 'pass',
        `before=${before.join(',')} after=${after.join(',')}`,
      );
      await verifyCards('F5', f5.cards, true);
      halt();
      const records = (await Promise.all(f5.cards.map((card) => exact(card.id, 'F5')))).filter(
        (record): record is CatalogRecord => !!record,
      );
      steelId = chooseWatchDirections(records, 350).steelId;
      check(
        'F5',
        'steel-direction',
        steelId ? 'pass' : 'fail',
        steelId ?? 'no eligible exact black-dial steel-bracelet watch',
      );
    }
    if (!firstFailure && steelId) {
      await view('Discover');
      await save(steelId);
      await run(
        'F6',
        'I like that leather one and this clean black-dial steel one. Show me a few more watches in those two directions before I decide.',
      );
      await view('Discover');
      const more = await cards(page);
      await verifyCards('F6', more, true);
      halt();
      await view('Saved');
      const saved = ids(await cards(page, 'saved'));
      await view('Discover');
      for (const card of more) {
        if (saved.length >= 5) break;
        const record = exactRecords.get(card.id);
        if (!record || saved.includes(card.id)) continue;
        const assessment = assessWatch(record, 350);
        if (
          assessment.hardFailures.length ||
          assessment.unknowns.length ||
          (!assessment.leather && !assessment.steel)
        )
          continue;
        await save(card.id);
        saved.push(card.id);
      }
      check(
        'F6',
        'saved-two-directions',
        saved.includes(leatherId!) && saved.includes(steelId) ? 'pass' : 'fail',
        saved.join(','),
      );
      check(
        'F6',
        'saved-breadth',
        saved.length >= 5 ? 'pass' : 'unknown',
        `${saved.length} distinct eligible watches saved; do not call fewer than five a five-watch shortlist`,
      );
      fs.writeFileSync(path.join(runDir, 'F6-saved.json'), JSON.stringify(saved, null, 2));
    }
    if (!firstFailure && leatherId && steelId) {
      await view('Saved');
      await compare(leatherId);
      await compare(steelId);
      await view('Compare');
      const compareCards = await cards(page, 'compare');
      const compared = ids(compareCards);
      check(
        'F7',
        'exact-compare',
        sameIds(compared, [leatherId, steelId]) ? 'pass' : 'fail',
        compared.join(','),
      );
      await verifyCards('F7', compareCards, true, true);
      halt();
      await panel
        .getByRole('region', { name: 'Shopping choices' })
        .screenshot({ path: path.join(runDir, 'F7-compare.png') });
      await run(
        'F7',
        "I've saved a few, but it's really these two: the brown leather one that feels like a gift, and the clean black-and-steel one that feels like Dad. Can I see them together?",
      );
      const f7 = turns.at(-1)!;
      check(
        'F7',
        'compare-state',
        sameIds(f7.shopping.compareIds ?? [], [leatherId, steelId]) ? 'pass' : 'fail',
        (f7.shopping.compareIds ?? []).join(','),
      );
    }
    if (!firstFailure && leatherId && steelId) {
      const f8 = await run(
        'F8',
        'Dad takes my daughter to the pool most Saturdays. Does either of these two watches have a stated water-resistance rating? If he jumped in with her, could he wear it?',
      );
      await exact(leatherId, 'F8');
      await exact(steelId, 'F8');
      check(
        'F8',
        'compare-continuity',
        sameIds(f8.shopping.compareIds ?? [], [leatherId, steelId]) ? 'pass' : 'fail',
        (f8.shopping.compareIds ?? []).join(','),
      );
      check(
        'F8',
        'water-education',
        'unknown',
        `verify exact ratings and any retrieved blog passage; links=${f8.links.join(',') || 'none'}`,
      );
    }
    if (!firstFailure && steelId) {
      await run(
        'F9',
        "He usually stays poolside, so swimming isn't the deciding factor. The cleaner steel one still feels more like him. Would you choose it over the leather one?",
      );
      check(
        'F9',
        'recommendation',
        'unknown',
        `review recommendation for exact selected steel watch ${steelId} and source-grounded trade-off`,
      );
    }
    if (!firstFailure && steelId) {
      const f10 = await run(
        'F10',
        'He sometimes wears that plain steel bracelet, too. Could we put one beside the watch and see whether the two work as a gift? Still $350 total.',
      );
      await view('Discover');
      const discoverOptions = await cards(page);
      await verifyCards('F10', discoverOptions, false);
      halt();
      await view('Combination');
      const proposedOptions = await cards(page, 'proposed');
      await verifyCards('F10', proposedOptions, false);
      halt();
      const options = [
        ...discoverOptions.map((card) => ({ card, source: 'Discover' as const })),
        ...proposedOptions.map((card) => ({ card, source: 'Combination' as const })),
      ];
      let braceletView: 'Discover' | 'Combination' | null = null;
      for (const { card, source } of options) {
        const record = await exact(card.id, 'F10');
        if (!record) continue;
        const bracelet = assessBracelet(record);
        if (bracelet.hardFailures.length || bracelet.unknowns.length || !bracelet.plainSteel)
          continue;
        const watchPrice = exactRecords.get(steelId)?.Pricing_ActivePrice;
        const braceletPrice = bracelet.price;
        if (typeof watchPrice !== 'number' || typeof braceletPrice !== 'number') continue;
        if (subtotalWithinBudget([watchPrice, braceletPrice], 350).withinBudget) {
          braceletId = card.id;
          braceletView = source;
          break;
        }
      }
      if (braceletId && braceletView) {
        await view(braceletView);
        await combine(braceletId);
        await view('Saved');
        savedBeforeBracelet = ids(await cards(page, 'saved'));
        await combine(steelId);
        await view('Combination');
        const combined = ids(await cards(page, 'combination'));
        check(
          'F10',
          'exact-combination',
          sameIds(combined, [steelId, braceletId]) ? 'pass' : 'fail',
          combined.join(','),
        );
        const combinationState = await page.evaluate(() => {
          try {
            const state = JSON.parse(sessionStorage.getItem('jtv.shopping.v3') ?? '{}') as {
              combinationQuantities?: Record<string, number>;
            };
            return state.combinationQuantities ?? {};
          } catch {
            return {};
          }
        });
        check(
          'F10',
          'sale-unit-quantities',
          (combinationState[steelId] ?? 1) === 1 && (combinationState[braceletId] ?? 1) === 1
            ? 'pass'
            : 'fail',
          JSON.stringify(combinationState),
        );
        const subtotal = panel.locator('.pw-selection > .pw-subtotal strong');
        const raw = [
          exactRecords.get(steelId)?.Pricing_ActivePrice,
          exactRecords.get(braceletId)?.Pricing_ActivePrice,
        ];
        if (raw.every((price): price is number => typeof price === 'number')) {
          const expected = subtotalWithinBudget(raw as number[], 350).cents;
          const displayed = Math.round(
            Number((await subtotal.innerText()).replace(/[^0-9.]/g, '')) * 100,
          );
          check(
            'F10',
            'subtotal-cents',
            displayed === expected ? 'pass' : 'fail',
            `expected=${expected} displayed=${displayed}`,
          );
        }
        await panel
          .getByRole('region', { name: 'Shopping choices' })
          .screenshot({ path: path.join(runDir, 'F10-combination.png') });
      } else {
        check(
          'F10',
          'companion-shortage',
          'unknown',
          `no verified bracelet inside remaining $350; Discover IDs: ${ids(discoverOptions).join(',')}; proposed Combination IDs: ${ids(proposedOptions).join(',')}`,
        );
        check('F10', 'combination', 'not-run', 'no eligible companion');
      }
      check(
        'F10',
        'budget-retained',
        'unknown',
        `brief revision ${String(f10.shopping.brief?.revision ?? 'missing')}; independently review total-budget fact`,
      );
    }
    if (!firstFailure && steelId) {
      await run(
        'F11',
        braceletId
          ? 'Seeing them together, I think the bracelet is too much for him. He barely lets me buy him anything. Just the watch.'
          : 'I think the watch alone feels right for him. He barely lets me buy him anything.',
      );
      if (braceletId) {
        await view('Combination');
        const bracelet = panel.locator(
          `.pw-compare-product[data-product-id="${safeId(braceletId)}"]`,
        );
        await bracelet.getByRole('button', { name: 'Remove from combination' }).click();
        const after = ids(await cards(page, 'combination'));
        check('F11', 'watch-alone', sameIds(after, [steelId]) ? 'pass' : 'fail', after.join(','));
        await view('Saved');
        const saved = ids(await cards(page, 'saved'));
        check(
          'F11',
          'saved-preserved',
          sameIds(saved, savedBeforeBracelet) ? 'pass' : 'fail',
          `before=${savedBeforeBracelet.join(',')} after=${saved.join(',')}`,
        );
      } else
        check(
          'F11',
          'watch-alone',
          'unknown',
          'no bracelet was added; verify selected watch stayed in state',
        );
    }
    if (!firstFailure && steelId) {
      const f12 = await run('F12', "Can you make sure this watch gets here by Father's Day?");
      check(
        'F12',
        'selected-watch',
        (f12.shopping.products ?? []).some((item) => item.objectID === steelId) ? 'pass' : 'fail',
        steelId,
      );
      check(
        'F12',
        'delivery-boundary',
        'unknown',
        'review answer for unsupported delivery, order, reservation or checkout promise',
      );
    }
  } catch (error) {
    if (!(error instanceof FirstFailureStop))
      check(activeBeat ?? 'runner', 'exception', 'fail', String(error));
  } finally {
    await Promise.allSettled(pending);
    const sourceAfter = hashSources();
    const agentSnapshotHashAfter = createHash('sha256')
      .update(fs.readFileSync(snapshot))
      .digest('hex');
    check(
      'preflight',
      'agent-snapshot-drift',
      agentSnapshotHashAfter === agentSnapshotHashBefore ? 'pass' : 'fail',
      `before=${agentSnapshotHashBefore} after=${agentSnapshotHashAfter}`,
    );
    const drift = sourceFiles.filter((file) => sourceBefore[file] !== sourceAfter[file]);
    check(
      'preflight',
      'source-drift',
      drift.length ? 'fail' : 'pass',
      drift.join(',') || 'runtime source hashes stable',
    );
    if (budgetStopped)
      check('preflight', 'completion-budget', 'fail', `${requests} attempted against cap 60`);
    const report = {
      mode: 'connected-F1-F12-not-fixture',
      verdict: firstFailure
        ? 'failed'
        : turns.length === 12
          ? 'needs-independent-semantic-review'
          : 'incomplete',
      firstFailure,
      notRun: Array.from({ length: 12 }, (_, index) => `F${index + 1}`).filter(
        (beat) => !turns.some((turn) => turn.beat === beat),
      ),
      agentSnapshot: { path: snapshot, agentId: agent.agentId, hashes: agent.hashes },
      agentSnapshotHashBefore,
      agentSnapshotHashAfter,
      app: {
        head: git(['rev-parse', 'HEAD']),
        originMain: git(['rev-parse', 'origin/main']),
        status: git(['status', '--short']),
      },
      sourceBefore,
      sourceAfter,
      completionBudget: 60,
      completionRequests: requests,
      selected: { leatherId, steelId, braceletId },
      assertions,
      turns,
      captures,
    };
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
  expect(firstFailure, `First Father defect and receipts at ${runDir}`).toBeNull();
  expect(turns, `Full F1-F12 journey must complete at ${runDir}`).toHaveLength(12);
  expect(
    assertions.filter((item) => item.status === 'unknown'),
    `Independent semantic/source review remains at ${runDir}`,
  ).toHaveLength(0);
});
