import { expect, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { repeatedExactTextAfterTool } from '../fathers-day-journey/assistantTextIntegrity';
import { hashEvidenceRecord } from '../../server/concierge/retrieveEvidence';

export type Status = 'pass' | 'fail' | 'unknown' | 'not-run';
export type Assertion = { beat: string; id: string; status: Status; detail: string };
export type Card = { id: string; title: string; price: string; text: string };
export type Bound = {
  sourceIndex?: string;
  objectID?: string;
  contentHash?: string;
  evidenceRef?: string;
  raw?: Record<string, unknown>;
};
export type Shopping = {
  missionId?: string;
  brief?: { revision?: number; facts?: unknown[] };
  products?: Bound[];
  selectionRecords?: Bound[];
  compareIds?: string[];
  combinationIds?: string[];
  combinationQuantities?: Record<string, number>;
  activeView?: string;
};
export type Capture = {
  beat: string | null;
  url: string;
  method: string;
  requestBody: string | null;
  status: number | null;
  networkFailure: string | null;
  captureError: string | null;
  responseFile: string | null;
};
export type Turn = {
  beat: string;
  shopper: string;
  reply: string;
  notices: string[];
  cards: Card[];
  completed: boolean;
  repeatedText: string | null;
  shopping: Shopping;
  links: string[];
  tools: string[];
  evidenceSources: string[];
  captures: Capture[];
  completionRequests: number;
  elapsedMs: number;
  error?: string;
};
export type View = 'Discover' | 'Saved' | 'Compare' | 'Combination';
export type CardView = 'discover' | 'saved' | 'compare' | 'combination' | 'proposed';
const monitored = [
  '/api/chat',
  '/api/agent-evidence',
  '/api/agent-product-refresh',
  '/api/products/',
];
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

function sourceHashes(root: string) {
  return Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  );
}
function git(root: string, args: string[]) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}
function sessionState(session: Record<string, string>): Shopping {
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
function receiptCount(page: Page) {
  return page.evaluate(() =>
    Object.entries(sessionStorage).reduce((count, [key, raw]) => {
      if (!key.startsWith('jtv-concierge-completed-')) return count;
      try {
        const parsed = JSON.parse(raw) as { assistantMessageIds?: unknown };
        return (
          count +
          (Array.isArray(parsed.assistantMessageIds) ? parsed.assistantMessageIds.length : 0)
        );
      } catch {
        return count;
      }
    }, 0),
  );
}
export function safeId(id: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`Unsafe product ID: ${id}`);
  return id;
}
export function sameIds(actual: string[], expected: string[]) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export class GraduationHarness {
  readonly panel;
  readonly views;
  readonly assertions: Assertion[] = [];
  readonly turns: Turn[] = [];
  readonly captures: Capture[] = [];
  readonly exactRecords = new Map<string, Record<string, unknown>>();
  readonly sourceBefore: Record<string, string>;
  readonly agentSnapshotHashBefore: string;
  firstFailure: string | null = null;
  completionRequests = 0;
  budgetStopped = false;
  private pending: Promise<void>[] = [];
  private activeBeat: string | null = null;
  private exactReads = 0;

  constructor(
    readonly page: Page,
    readonly root: string,
    readonly outDir: string,
    readonly snapshot: string,
    readonly expectedAgentId: string,
    readonly maxCompletionRequests: number,
  ) {
    this.panel = page.getByRole('complementary', { name: 'Jewelry buying Concierge' });
    this.views = this.panel.getByRole('navigation', { name: 'Product views' });
    this.sourceBefore = sourceHashes(root);
    this.agentSnapshotHashBefore = createHash('sha256')
      .update(fs.readFileSync(snapshot))
      .digest('hex');
    fs.mkdirSync(outDir, { recursive: true });
  }

  check(beat: string, id: string, status: Status, detail: string) {
    this.assertions.push({ beat, id, status, detail });
    if (status === 'fail' && !this.firstFailure) this.firstFailure = `${beat}:${id}`;
  }

  async install() {
    await this.page.route('**/api/chat', async (route) => {
      this.completionRequests += 1;
      if (this.completionRequests > this.maxCompletionRequests) {
        this.budgetStopped = true;
        await route.abort();
      } else await route.continue();
    });
    this.page.on('request', (request: Request) => {
      if (!monitored.some((part) => request.url().includes(part))) return;
      const beat = this.activeBeat;
      const index = this.captures.length;
      const item: Capture = {
        beat,
        url: request.url(),
        method: request.method(),
        requestBody: request.postData(),
        status: null,
        networkFailure: null,
        captureError: null,
        responseFile: null,
      };
      this.captures.push(item);
      this.pending.push(
        (async () => {
          try {
            const response = await request.response();
            item.status = response?.status() ?? null;
            if (!response) return;
            const file = `${beat ?? 'outside'}-${index}-${request.url().includes('/api/chat') ? 'chat' : 'evidence'}.txt`;
            fs.writeFileSync(path.join(this.outDir, file), await response.body());
            item.responseFile = file;
          } catch (error) {
            item.captureError = String(error);
            item.networkFailure = request.failure()?.errorText ?? null;
          }
        })(),
      );
    });
  }

  async open() {
    const health = await this.page.request.get('/api/health');
    fs.writeFileSync(path.join(this.outDir, 'health.json'), await health.text());
    this.check('preflight', 'health', health.ok() ? 'pass' : 'fail', String(health.status()));
    this.check(
      'preflight',
      'runtime-agent-identity',
      'unknown',
      `/api/health does not expose live agent ID; operator expected ${this.expectedAgentId}`,
    );
    await this.page.goto('/');
    await this.page.getByRole('button', { name: 'Open jewelry Concierge' }).click();
    await this.panel.waitFor({ state: 'visible' });
  }

  async cards(view: CardView = 'discover'): Promise<Card[]> {
    const selector =
      view === 'discover'
        ? '.pw-discover .pw-product'
        : view === 'saved'
          ? '.pw-saved .pw-product'
          : view === 'proposed'
            ? '.pw-proposed-looks .pw-product'
            : '.pw-comparison .pw-compare-product';
    return this.panel.locator(selector).evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-product-id') ?? '',
        title: node.querySelector('h3')?.textContent?.trim() ?? '',
        price: node.querySelector('.pw-price')?.textContent?.trim() ?? '',
        text: (node.textContent ?? '').slice(0, 1200),
      })),
    );
  }

  async view(name: View) {
    const button = this.views.getByRole('button', {
      name: new RegExp(`^${name}(?: \\(\\d+\\))?$`),
    });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(this.panel.locator('.product-workspace > p.pw-status[role="status"]')).toBeHidden({
      timeout: 15_000,
    });
  }
  async clickCard(id: string, action: 'Save' | 'Compare' | 'Add to combination') {
    const card = this.panel.locator(`.pw-product[data-product-id="${safeId(id)}"]`).first();
    await card.waitFor({ state: 'visible' });
    await card.getByRole('button', { name: action, exact: true }).click();
    const nextLabel =
      action === 'Save'
        ? 'Remove from saved'
        : action === 'Compare'
          ? /Comparing/
          : /In combination/;
    await expect(card.getByRole('button', { name: nextLabel })).toBeVisible();
  }
  async screenshot(name: string) {
    await this.panel.screenshot({ path: path.join(this.outDir, `${name}-panel.png`) });
    await this.page.screenshot({
      path: path.join(this.outDir, `${name}-viewport.png`),
      fullPage: false,
    });
  }
  async session(): Promise<Record<string, string>> {
    return this.page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  }
  async exact(id: string, beat: string): Promise<Record<string, unknown> | null> {
    const response = await this.page.request.get(`/api/products/${encodeURIComponent(id)}`);
    const body = await response.text();
    fs.writeFileSync(
      path.join(this.outDir, `${beat}-product-${safeId(id)}-${++this.exactReads}.json`),
      body,
    );
    if (!response.ok()) {
      this.check(beat, 'exact-http', 'fail', `${id}: ${response.status()}`);
      return null;
    }
    try {
      const record = JSON.parse(body) as Record<string, unknown>;
      if (record.objectID !== id) {
        this.check(beat, 'exact-id', 'fail', `${id} != ${String(record.objectID)}`);
        return null;
      }
      this.exactRecords.set(id, record);
      return record;
    } catch {
      this.check(beat, 'exact-json', 'fail', id);
      return null;
    }
  }
  async verifyBinding(beat: string, visible: Card[], allowSaved = false) {
    const state = sessionState(await this.session());
    const bound = [
      ...(state.selectionRecords ?? []),
      ...(allowSaved ? (state.products ?? []) : []),
    ];
    const seen = new Set<string>();
    for (const card of visible) {
      if (!card.id) {
        this.check(beat, 'visible-id', 'fail', 'missing product ID');
        continue;
      }
      if (seen.has(card.id)) {
        this.check(
          beat,
          'repeated-visible-id',
          'unknown',
          `${card.id} appears in multiple groups or looks; review presentation`,
        );
        continue;
      }
      seen.add(card.id);
      const selected = bound.find((item) => item.objectID === card.id);
      if (
        !selected ||
        selected.sourceIndex !== 'prod_catalog' ||
        !selected.contentHash ||
        !selected.evidenceRef?.startsWith(`prod_catalog/${card.id}/`) ||
        selected.raw?.objectID !== card.id
      )
        this.check(beat, 'source-binding', 'fail', `${card.id}: no matching source-bound record`);
      else {
        const hash = hashEvidenceRecord(selected.raw);
        if (
          selected.contentHash !== hash ||
          selected.evidenceRef !== `prod_catalog/${encodeURIComponent(card.id)}/${hash}`
        )
          this.check(
            beat,
            'source-hash',
            'fail',
            `${card.id}: retained raw record, contentHash and evidenceRef disagree`,
          );
      }
      const record = await this.exact(card.id, beat);
      if (!record) continue;
      if (
        typeof record.Catalog_TitleDescription === 'string' &&
        card.title !== record.Catalog_TitleDescription
      )
        this.check(
          beat,
          'visible-title',
          'fail',
          `${card.id}: card title differs from exact catalogue record`,
        );
      const price = record.Pricing_ActivePrice;
      if (
        typeof price === 'number' &&
        !card.price.replace(/,/g, '').includes(`$${price.toFixed(2)}`)
      )
        this.check(
          beat,
          'visible-price',
          'fail',
          `${card.id}: UI ${card.price}; exact $${price.toFixed(2)}`,
        );
    }
  }

  async send(beat: string, shopper: string): Promise<Turn> {
    const started = Date.now();
    const beforeReplies = await this.panel.locator('.connected-assistant-message').count();
    const beforeReceipt = await receiptCount(this.page);
    const beforeRequests = this.completionRequests;
    const beforeCaptures = this.captures.length;
    const beforePending = this.pending.length;
    const turn: Turn = {
      beat,
      shopper,
      reply: '',
      notices: [],
      cards: [],
      completed: false,
      repeatedText: null,
      shopping: {},
      links: [],
      tools: [],
      evidenceSources: [],
      captures: [],
      completionRequests: 0,
      elapsedMs: 0,
    };
    this.turns.push(turn);
    this.activeBeat = beat;
    try {
      const input = this.panel.getByRole('textbox', { name: 'Message the Concierge' });
      await input.fill(shopper);
      await this.panel.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(input).toBeDisabled({ timeout: 10_000 });
      await expect(input).toBeEnabled({ timeout: 180_000 });
      if ((await this.panel.locator('.connected-assistant-message').count()) > beforeReplies)
        turn.reply = (
          await this.panel.locator('.connected-assistant-message').last().innerText()
        ).trim();
      turn.notices = await this.panel.locator('.connected-system-notice').allTextContents();
      turn.cards = await this.cards();
      if ((await this.panel.locator('.connected-assistant-message').count()) > beforeReplies)
        turn.links = await this.panel
          .locator('.connected-assistant-message')
          .last()
          .locator('a[href]')
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
    } catch (error) {
      turn.error = String(error);
    } finally {
      await Promise.allSettled(this.pending.slice(beforePending));
      try {
        const session = await this.session();
        turn.shopping = sessionState(session);
        turn.completed = (await receiptCount(this.page)) > beforeReceipt;
        const assistant = latestAssistant(session);
        turn.repeatedText = assistant ? repeatedExactTextAfterTool(assistant) : null;
        turn.tools = (assistant?.parts ?? [])
          .map((part) => part.type ?? '')
          .filter((type) => type.startsWith('tool-'));
        turn.evidenceSources = (assistant?.parts ?? [])
          .filter((part) => part.type === 'tool-retrieve_evidence')
          .map((part) => {
            const output = (part as { output?: { source?: unknown } }).output;
            return typeof output?.source === 'string' ? output.source : '';
          })
          .filter(Boolean);
        fs.writeFileSync(
          path.join(this.outDir, `${beat}-session.json`),
          JSON.stringify(session, null, 2),
        );
        if (
          !turn.reply &&
          (await this.panel.locator('.connected-assistant-message').count()) > beforeReplies
        )
          turn.reply = (
            await this.panel.locator('.connected-assistant-message').last().innerText()
          ).trim();
        turn.notices = await this.panel.locator('.connected-system-notice').allTextContents();
        turn.cards = await this.cards();
        await this.screenshot(beat);
      } catch (error) {
        turn.error = `${turn.error ?? ''} | snapshot: ${String(error)}`.trim();
      }
      turn.completionRequests = this.completionRequests - beforeRequests;
      turn.captures = this.captures.slice(beforeCaptures);
      turn.elapsedMs = Date.now() - started;
      fs.writeFileSync(path.join(this.outDir, `${beat}.json`), JSON.stringify(turn, null, 2));
      this.activeBeat = null;
    }
    this.check(
      beat,
      'reply',
      turn.reply ? 'pass' : 'fail',
      turn.reply ? 'generated answer rendered' : 'no answer',
    );
    this.check(
      beat,
      'completion',
      turn.completed ? 'pass' : 'fail',
      turn.completed ? 'mission receipt advanced' : 'no new receipt',
    );
    this.check(
      beat,
      'notices',
      turn.notices.length ? 'fail' : 'pass',
      turn.notices.join(' | ') || 'none',
    );
    this.check(
      beat,
      'repeated-answer',
      turn.repeatedText ? 'fail' : 'pass',
      turn.repeatedText?.slice(0, 140) ?? 'none',
    );
    if (turn.error) this.check(beat, 'browser', 'fail', turn.error);
    const failed = turn.captures.filter(
      (item) =>
        item.status === null ||
        item.status < 200 ||
        item.status >= 300 ||
        item.networkFailure ||
        item.captureError,
    );
    if (failed.length) {
      const bodyAbortAfterCommit =
        turn.reply &&
        turn.completed &&
        !turn.notices.length &&
        failed.every(
          (item) =>
            item.url.includes('/api/chat') &&
            item.status === 200 &&
            item.networkFailure === 'net::ERR_ABORTED',
        );
      this.check(
        beat,
        'transport-capture',
        bodyAbortAfterCommit ? 'unknown' : 'fail',
        failed.map((item) => `${item.url} ${item.status} ${item.networkFailure ?? ''}`).join('; '),
      );
    }
    if (this.budgetStopped)
      this.check(
        beat,
        'completion-budget',
        'fail',
        `${this.completionRequests} attempted against cap ${this.maxCompletionRequests}`,
      );
    this.check(
      beat,
      'semantic',
      'unknown',
      'independent review of energy, continuity, evidence and claims',
    );
    return turn;
  }

  async finish(
    selected: Record<string, unknown>,
    agent: { agentId?: string; hashes?: Record<string, string> },
  ) {
    await Promise.allSettled(this.pending);
    const sourceAfter = sourceHashes(this.root);
    const agentSnapshotHashAfter = createHash('sha256')
      .update(fs.readFileSync(this.snapshot))
      .digest('hex');
    const drift = sourceFiles.filter((file) => this.sourceBefore[file] !== sourceAfter[file]);
    this.check(
      'preflight',
      'source-drift',
      drift.length ? 'fail' : 'pass',
      drift.join(',') || 'runtime source stable',
    );
    this.check(
      'preflight',
      'snapshot-drift',
      agentSnapshotHashAfter === this.agentSnapshotHashBefore ? 'pass' : 'fail',
      `before=${this.agentSnapshotHashBefore} after=${agentSnapshotHashAfter}`,
    );
    const report = {
      mode: 'connected-G1-G13-not-fixture',
      verdict: this.firstFailure
        ? 'failed'
        : this.turns.length === 13
          ? 'needs-independent-semantic-review'
          : 'incomplete',
      firstFailure: this.firstFailure,
      notRun: Array.from({ length: 13 }, (_, index) => `G${index + 1}`).filter(
        (beat) => !this.turns.some((turn) => turn.beat === beat),
      ),
      agentSnapshot: {
        path: this.snapshot,
        expectedAgentId: this.expectedAgentId,
        agentId: agent.agentId,
        hashes: agent.hashes,
      },
      agentSnapshotHashBefore: this.agentSnapshotHashBefore,
      agentSnapshotHashAfter,
      app: {
        head: git(this.root, ['rev-parse', 'HEAD']),
        originMain: git(this.root, ['rev-parse', 'origin/main']),
        status: git(this.root, ['status', '--short']),
      },
      sourceBefore,
      sourceAfter,
      completionBudget: this.maxCompletionRequests,
      completionRequests: this.completionRequests,
      selected,
      assertions: this.assertions,
      turns: this.turns,
      captures: this.captures,
    };
    fs.writeFileSync(path.join(this.outDir, 'summary.json'), JSON.stringify(report, null, 2));
    return report;
  }
}
