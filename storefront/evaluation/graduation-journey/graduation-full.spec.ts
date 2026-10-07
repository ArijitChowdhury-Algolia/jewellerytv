import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraduationHarness, safeId, sameIds, type Card } from './graduationHarness';
import {
  activeExclusionText,
  hasActiveContext,
  hasSterlingRequirement,
  hasTotalBudget,
} from './graduationBriefOracle';
import {
  assessGraduationProduct,
  classifyGreenPrimaryGemstone,
  totalWithinGraduationBudget,
  hasExplicitMatchingSetClaim,
  type GraduationCatalogRecord,
} from './graduationOracle';

// Scenario inventory: G1 pride/intake; G2 observed style; G3 sterling and
// exclusions; G4 $300 total and necklace; G5 quieter green correction; G6
// Saved breadth; G7 exact Compare; G8 natural/lab and blog; G9 necklace anchor
// plus earrings; G10 drop-to-stud component replacement; G11 set claim; G12
// comfort limit; G13 necklace-alone finish. Empty/unknown inventory, missing
// exact fields, gold-over-sterling, cap motif, stale IDs, wrong sale units,
// over-budget combination, broken stream, duplicate answer, request exhaustion
// and source drift stop or remain explicit review-pending unknowns. The no-chat
// fixture, record oracle and review gate are separate. No example objectID or
// illustrative Concierge sentence becomes a live recommendation.
const enabled = process.env.JTV_RUN_GRADUATION_FULL === '1';
const maxRequests = Number(process.env.JTV_MAX_COMPLETION_REQUESTS);
const snapshotEnv = process.env.JTV_AGENT_SNAPSHOT ?? '';
const expectedAgentId = process.env.JTV_EXPECTED_AGENT_ID ?? '';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(
  repoRoot,
  '.checkpoint',
  'runs',
  `graduation-full-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
class FirstFailureStop extends Error {}
const cardIds = (cards: Card[]) => cards.map((card) => card.id);

function shopperReference(record: GraduationCatalogRecord, fallback: string) {
  const title = record.Catalog_TitleDescription;
  if (typeof title === 'string' && title.length <= 160 && /^[\p{L}\p{N}\s.,'&()/-]+$/u.test(title))
    return title;
  return fallback;
}
function origin(record: GraduationCatalogRecord): 'Natural' | 'Lab Created' | null {
  const classified = classifyGreenPrimaryGemstone(record);
  return classified.status === 'known' ? classified.creationClassification : null;
}
function eligibleUnknowns(unknowns: string[]) {
  return unknowns.every((unknown) => unknown === 'motif');
}
function explicitDrop(record: GraduationCatalogRecord) {
  const types = record.Catalog_EarringType;
  return Array.isArray(types) && types.some((value) => value === 'Drop');
}
test('Graduation G1-G13 uninterrupted connected shopper journey', async ({ browser }) => {
  test.skip(
    !enabled,
    'Connected graduation journey is opt-in and skips without paid calls by default.',
  );
  test.skip(maxRequests !== 65, 'Set JTV_MAX_COMPLETION_REQUESTS=65 for the finite G1-G13 window.');
  test.skip(
    !snapshotEnv || !expectedAgentId,
    'Pin exact JTV_AGENT_SNAPSHOT and JTV_EXPECTED_AGENT_ID before a connected run.',
  );
  const snapshot = path.resolve(snapshotEnv);
  if (!snapshot.startsWith(path.join(repoRoot, 'storefront', 'evidence') + path.sep))
    throw new Error('Agent snapshot must be saved under storefront/evidence.');
  const agent = JSON.parse(fs.readFileSync(snapshot, 'utf8')) as {
    agentId?: string;
    hashes?: Record<string, string>;
  };
  if (agent.agentId !== expectedAgentId)
    throw new Error('Expected agent ID and saved readback differ.');
  const context = await browser.newContext();
  const page = await context.newPage();
  const h = new GraduationHarness(page, repoRoot, outDir, snapshot, expectedAgentId, 65);
  let firstNecklaceId: string | null = null;
  let quieterNecklaceId: string | null = null;
  let dropId: string | null = null;
  let studsId: string | null = null;
  let activeEarringId: string | null = null;
  let beforeSavedEnd: string[] = [];
  let priorDiscoverIds: string[] = [];
  const halt = () => {
    if (h.firstFailure) throw new FirstFailureStop(h.firstFailure);
  };
  const choose = async (
    beat: string,
    visible: Card[],
    role: 'necklace' | 'earrings',
    desired?: 'green' | 'stud' | 'drop',
    exclude = new Set<string>(),
  ) => {
    await h.verifyBinding(beat, visible);
    halt();
    const candidates: Array<{
      id: string;
      record: GraduationCatalogRecord;
      origin: ReturnType<typeof origin>;
    }> = [];
    for (const card of visible) {
      const record = h.exactRecords.get(card.id);
      if (!record || exclude.has(card.id)) continue;
      const result = assessGraduationProduct(record, role, 30000);
      if (result.hardFailures.length) {
        h.check(
          beat,
          'hard-product-boundary',
          'fail',
          `${card.id}: ${result.hardFailures.join(',')}`,
        );
        continue;
      }
      if (!eligibleUnknowns(result.unknowns)) {
        h.check(
          beat,
          'required-product-evidence',
          'fail',
          `${card.id}: ${result.unknowns.join(',')}`,
        );
        continue;
      }
      if (result.unknowns.length)
        h.check(
          beat,
          'motif-evidence',
          'unknown',
          `${card.id}: motif field missing; review image/title/description`,
        );
      if (desired === 'green' && result.greenDetail !== true) continue;
      if (desired === 'stud' && result.stud !== true) continue;
      if (desired === 'drop' && result.stud !== false) continue;
      candidates.push({ id: card.id, record, origin: origin(record) });
    }
    halt();
    return candidates;
  };
  const savedIds = async () => {
    await h.view('Saved');
    return cardIds(await h.cards('saved'));
  };
  const ensureSaved = async (id: string) => {
    const card = h.panel.locator(`.pw-product[data-product-id="${safeId(id)}"]`).first();
    await expect(card).toBeVisible();
    if (await card.getByRole('button', { name: 'Save', exact: true }).count())
      await h.clickCard(id, 'Save');
  };
  const visibleOptions = async () => {
    await h.view('Discover');
    const discover = await h.cards('discover');
    await h.view('Combination');
    const proposed = await h.cards('proposed');
    await h.view('Saved');
    const saved = await h.cards('saved');
    return [
      ...discover.map((card) => ({ card, source: 'Discover' as const })),
      ...proposed.map((card) => ({ card, source: 'Combination' as const })),
      ...saved.map((card) => ({ card, source: 'Saved' as const })),
    ];
  };
  try {
    await h.install();
    await h.open();
    halt();
    const g1 = await h.send(
      'G1',
      "My daughter is graduating next month. I'm so proud of her. I'd love to get her jewellery she'll still want to wear a year from now, not something that just says graduation.",
    );
    h.check(
      'G1',
      'recipient-context',
      hasActiveContext(g1.shopping, 'recipient', /daughter/i) ? 'pass' : 'fail',
      'opening must record daughter as recipient',
    );
    h.check(
      'G1',
      'occasion-context',
      hasActiveContext(g1.shopping, 'occasion', /graduat/i) ? 'pass' : 'fail',
      'opening must record graduation occasion',
    );
    halt();
    await h.send(
      'G2',
      "Her ears are pierced, and she usually wears small studs. She's got a simple silver necklace she wears all the time. She likes green, but I don't know much more.",
    );
    halt();
    const g3 = await h.send(
      'G3',
      "Let's do sterling silver, though. She doesn't want a gold-coloured finish. And please, no graduation caps.",
    );
    h.check(
      'G3',
      'sterling-requirement',
      hasSterlingRequirement(g3.shopping) ? 'pass' : 'fail',
      'explicit active mission requirement must encode Silver and Sterling',
    );
    h.check(
      'G3',
      'hard-brief',
      'unknown',
      `independent review of sterling, no gold finish, and no cap facts at revision ${String(g3.shopping.brief?.revision ?? 'missing')}`,
    );
    const exclusions = activeExclusionText(g3.shopping);
    h.check(
      'G3',
      'no-gold-finish-recorded',
      exclusions.includes('gold') ? 'pass' : 'unknown',
      exclusions.includes('gold')
        ? 'active explicit exclusion mentions gold finish'
        : 'review whether no gold-coloured finish was represented another supported way',
    );
    h.check(
      'G3',
      'no-cap-motif-recorded',
      exclusions.includes('graduation') && exclusions.includes('cap') ? 'pass' : 'unknown',
      exclusions.includes('graduation') && exclusions.includes('cap')
        ? 'active explicit exclusion mentions graduation caps'
        : 'review whether cap exclusion was represented another supported way',
    );
    halt();
    const g4 = await h.send(
      'G4',
      'I can spend $300 total. Could we start with a necklace, then maybe earrings if there is room?',
    );
    h.check(
      'G4',
      'firm-total-budget',
      hasTotalBudget(g4.shopping) ? 'pass' : 'fail',
      'accepted brief must retain $300 total ceiling',
    );
    h.check(
      'G4',
      'sterling-retained',
      hasSterlingRequirement(g4.shopping) ? 'pass' : 'fail',
      'active sterling requirement',
    );
    const updateAt = g4.tools.indexOf('tool-update_shopping_state');
    const searchAt = g4.tools.indexOf('tool-retrieve_evidence');
    h.check(
      'G4',
      'state-before-retrieval',
      updateAt >= 0 && searchAt > updateAt ? 'pass' : 'fail',
      g4.tools.join(' -> '),
    );
    halt();
    const firstCards = g4.cards;
    priorDiscoverIds = cardIds(firstCards);
    const firstCandidates = await choose('G4', firstCards, 'necklace', 'green');
    firstNecklaceId = firstCandidates[0]?.id ?? null;
    h.check(
      'G4',
      'green-necklace',
      firstNecklaceId ? 'pass' : 'fail',
      firstNecklaceId ?? 'no eligible exact green sterling necklace in Discover',
    );
    halt();
    await h.view('Discover');
    await ensureSaved(firstNecklaceId!);
    const firstRecord = h.exactRecords.get(firstNecklaceId!)!;
    await h.send(
      'G5',
      `I saved that little green one, ${shopperReference(firstRecord, 'the necklace you showed')}, but the pendant looks more formal than she is. Could we find something quieter?`,
    );
    await h.view('Discover');
    const refreshed = await h.cards('discover');
    h.check(
      'G5',
      'discover-refreshed',
      sameIds(cardIds(refreshed), priorDiscoverIds) ? 'fail' : 'pass',
      `before=${priorDiscoverIds.join(',')} after=${cardIds(refreshed).join(',')}`,
    );
    priorDiscoverIds = cardIds(refreshed);
    halt();
    const quieter = await choose('G5', refreshed, 'necklace', 'green', new Set([firstNecklaceId!]));
    quieterNecklaceId = quieter[0]?.id ?? null;
    h.check(
      'G5',
      'quieter-necklace',
      quieterNecklaceId ? 'pass' : 'fail',
      quieterNecklaceId ?? 'no distinct eligible green sterling necklace after correction',
    );
    h.check(
      'G5',
      'understated-fit',
      'unknown',
      'review whether revised necklace is genuinely quieter, not merely a different ID',
    );
    halt();
    await h.view('Discover');
    await ensureSaved(quieterNecklaceId!);
    await h.send(
      'G6',
      "I've saved those two necklaces. Show me a few more pieces she might actually wear, including little earrings if they fit the same quiet style.",
    );
    halt();
    await h.view('Discover');
    const more = await h.cards('discover');
    await h.verifyBinding('G6', more);
    halt();
    for (const card of more) {
      const record = h.exactRecords.get(card.id);
      if (!record) continue;
      const type = record.Catalog_ProductType;
      if (type !== 'Necklace' && type !== 'Earrings') continue;
      const result = assessGraduationProduct(
        record,
        type === 'Necklace' ? 'necklace' : 'earrings',
        30000,
      );
      if (result.hardFailures.length || !eligibleUnknowns(result.unknowns)) continue;
      const saved = await savedIds();
      if (saved.length >= 5) break;
      if (saved.includes(card.id)) continue;
      await h.view('Discover');
      await ensureSaved(card.id);
    }
    const savedAfterG6 = await savedIds();
    h.check(
      'G6',
      'saved-two-necklaces',
      savedAfterG6.includes(firstNecklaceId!) && savedAfterG6.includes(quieterNecklaceId!)
        ? 'pass'
        : 'fail',
      savedAfterG6.join(','),
    );
    h.check(
      'G6',
      'saved-breadth',
      savedAfterG6.length >= 5 ? 'pass' : 'unknown',
      `${savedAfterG6.length} distinct pieces; do not call fewer than five a five-piece shortlist`,
    );
    const savedRecords = await Promise.all(savedAfterG6.map((id) => h.exact(id, 'G6')));
    const savedTypes = savedRecords.map((record) => record?.Catalog_ProductType);
    h.check(
      'G6',
      'saved-mixed-categories',
      savedAfterG6.length < 5
        ? 'unknown'
        : savedTypes.includes('Necklace') && savedTypes.includes('Earrings')
          ? 'pass'
          : 'fail',
      savedTypes.join(','),
    );
    halt();
    await h.view('Saved');
    await h.clickCard(firstNecklaceId!, 'Compare');
    await h.clickCard(quieterNecklaceId!, 'Compare');
    await h.view('Compare');
    const compared = await h.cards('compare');
    h.check(
      'G7',
      'compare-exact-two',
      sameIds(cardIds(compared), [firstNecklaceId!, quieterNecklaceId!]) ? 'pass' : 'fail',
      cardIds(compared).join(','),
    );
    await h.verifyBinding('G7', compared, true);
    await h.screenshot('G7-compare');
    halt();
    const g7 = await h.send(
      'G7',
      'These two necklaces. What is the difference that would actually matter to her?',
    );
    h.check(
      'G7',
      'compare-state',
      sameIds(g7.shopping.compareIds ?? [], [firstNecklaceId!, quieterNecklaceId!])
        ? 'pass'
        : 'fail',
      (g7.shopping.compareIds ?? []).join(','),
    );
    halt();
    const secondRecord = h.exactRecords.get(quieterNecklaceId!)!;
    const contrastingOrigins =
      origin(firstRecord) && origin(secondRecord) && origin(firstRecord) !== origin(secondRecord);
    const educationPrompt = contrastingOrigins
      ? 'I see that one of these stones is listed as natural and the other as lab-created. Does that mean one is less real?'
      : 'I keep seeing natural and lab-created stones in the listings. What does JTV say, and what do these two exact necklaces actually state?';
    const g8 = await h.send('G8', educationPrompt);
    await h.exact(firstNecklaceId!, 'G8');
    await h.exact(quieterNecklaceId!, 'G8');
    h.check(
      'G8',
      'compare-continuity',
      sameIds(g8.shopping.compareIds ?? [], [firstNecklaceId!, quieterNecklaceId!])
        ? 'pass'
        : 'fail',
      (g8.shopping.compareIds ?? []).join(','),
    );
    h.check(
      'G8',
      'origin-contrast',
      contrastingOrigins ? 'pass' : 'unknown',
      contrastingOrigins
        ? 'two exact records support natural/lab contrast'
        : 'exact pair does not support the scripted contrast; shopper used a general education question',
    );
    h.check(
      'G8',
      'blog-grounding',
      'unknown',
      `retrieved sources=${g8.evidenceSources.join(',') || 'none'}; verify applicable JTV blog passage and qualifications; links=${g8.links.join(',') || 'none'}`,
    );
    h.check(
      'G8',
      'blog-retrieval-observed',
      g8.evidenceSources.includes('blog') ? 'pass' : 'unknown',
      g8.evidenceSources.includes('blog')
        ? 'tool output identifies blog source; independent passage/link review required'
        : 'no blog tool output captured; reply must state evidence gap rather than explain from memory',
    );
    halt();
    const g9 = await h.send(
      'G9',
      'I still prefer the quieter necklace. Could we add small earrings, but keep the whole gift under $300?',
    );
    h.check(
      'G9',
      'sterling-retained',
      hasSterlingRequirement(g9.shopping) ? 'pass' : 'fail',
      'active sterling requirement',
    );
    h.check(
      'G9',
      'budget-retained',
      hasTotalBudget(g9.shopping) ? 'pass' : 'fail',
      'active $300 total requirement',
    );
    const options = await visibleOptions();
    await h.verifyBinding(
      'G9',
      options.filter((item) => item.source === 'Discover').map((item) => item.card),
    );
    await h.verifyBinding(
      'G9',
      options.filter((item) => item.source === 'Combination').map((item) => item.card),
    );
    await h.verifyBinding(
      'G9',
      options.filter((item) => item.source === 'Saved').map((item) => item.card),
      true,
    );
    halt();
    const anchorPrice = h.exactRecords.get(quieterNecklaceId!)?.Pricing_ActivePrice;
    if (typeof anchorPrice !== 'number')
      h.check('G9', 'anchor-price', 'fail', 'selected necklace exact price unavailable');
    const earrings = [] as Array<{
      id: string;
      source: 'Discover' | 'Combination' | 'Saved';
      stud: boolean | null;
      drop: boolean;
    }>;
    for (const { card, source } of options) {
      const record = h.exactRecords.get(card.id);
      if (!record || record.Catalog_ProductType !== 'Earrings') continue;
      const result = assessGraduationProduct(record, 'earrings', 30000);
      if (
        result.hardFailures.length ||
        !eligibleUnknowns(result.unknowns) ||
        typeof anchorPrice !== 'number' ||
        typeof record.Pricing_ActivePrice !== 'number'
      )
        continue;
      if (!totalWithinGraduationBudget([anchorPrice, record.Pricing_ActivePrice]).withinBudget)
        continue;
      earrings.push({ id: card.id, source, stud: result.stud, drop: explicitDrop(record) });
    }
    const firstEarring =
      earrings.find((item) => item.drop) ?? earrings.find((item) => item.stud === true);
    h.check(
      'G9',
      'earring-companion',
      firstEarring ? 'pass' : 'fail',
      firstEarring?.id ?? 'no eligible small earring option under total budget',
    );
    h.check(
      'G9',
      'size-and-sale-unit',
      'unknown',
      'independent review of small-earring fit and exact catalogue sale unit required',
    );
    if (firstEarring?.source === 'Saved')
      h.check(
        'G9',
        'saved-option-grounding',
        'unknown',
        `selected Saved item ${firstEarring.id}; reviewer must confirm G9 reply pointed to it rather than the runner silently choosing it`,
      );
    halt();
    dropId = firstEarring?.drop ? firstEarring.id : null;
    studsId = firstEarring?.stud === true ? firstEarring.id : null;
    activeEarringId = firstEarring!.id;
    await h.view(firstEarring!.source);
    await ensureSaved(activeEarringId);
    await h.clickCard(activeEarringId, 'Add to combination');
    await h.view('Saved');
    await h.clickCard(quieterNecklaceId!, 'Add to combination');
    await h.view('Combination');
    const g9Combined = cardIds(await h.cards('combination'));
    h.check(
      'G9',
      'combination-anchor',
      sameIds(g9Combined, [quieterNecklaceId!, activeEarringId]) ? 'pass' : 'fail',
      g9Combined.join(','),
    );
    const g9State = JSON.parse((await h.session())['jtv.shopping.v3'] ?? '{}') as {
      combinationQuantities?: Record<string, number>;
    };
    const g9Quantities = g9State.combinationQuantities ?? {};
    h.check(
      'G9',
      'sale-unit-quantities',
      (g9Quantities[quieterNecklaceId!] ?? 1) === 1 && (g9Quantities[activeEarringId] ?? 1) === 1
        ? 'pass'
        : 'fail',
      JSON.stringify(g9Quantities),
    );
    const initialEarringPrice = h.exactRecords.get(activeEarringId)?.Pricing_ActivePrice;
    if (typeof anchorPrice === 'number' && typeof initialEarringPrice === 'number') {
      const expected = totalWithinGraduationBudget([anchorPrice, initialEarringPrice]).totalCents;
      const selectedSubtotal = h.panel.locator('.pw-selection > .pw-subtotal strong');
      const displayed = Math.round(
        Number((await selectedSubtotal.innerText()).replace(/[^0-9.]/g, '')) * 100,
      );
      h.check(
        'G9',
        'subtotal-cents',
        displayed === expected && expected <= 30000 ? 'pass' : 'fail',
        `expected=${expected} displayed=${displayed}`,
      );
    }
    await h.screenshot('G9-combination');
    halt();
    const g10Prompt = dropId
      ? 'These drop earrings are pretty, but they feel too dressed up for her. Could we switch just the earrings to small studs and keep the necklace?'
      : 'These earrings may be simple enough. Could we check for small studs while keeping the same necklace and $300 total?';
    await h.send('G10', g10Prompt);
    if (!dropId)
      h.check(
        'G10',
        'drop-to-stud-path',
        'unknown',
        'no verified drop pair was available, so the canonical drop-to-stud replacement was not exercised',
      );
    const replacementOptions = await visibleOptions();
    await h.verifyBinding(
      'G10',
      replacementOptions.filter((item) => item.source === 'Discover').map((item) => item.card),
    );
    await h.verifyBinding(
      'G10',
      replacementOptions.filter((item) => item.source === 'Combination').map((item) => item.card),
    );
    await h.verifyBinding(
      'G10',
      replacementOptions.filter((item) => item.source === 'Saved').map((item) => item.card),
      true,
    );
    halt();
    const replacement = replacementOptions.find(({ card }) => {
      const record = h.exactRecords.get(card.id);
      if (
        !record ||
        record.Catalog_ProductType !== 'Earrings' ||
        card.id === activeEarringId ||
        typeof anchorPrice !== 'number' ||
        typeof record.Pricing_ActivePrice !== 'number'
      )
        return false;
      const result = assessGraduationProduct(record, 'earrings', 30000);
      return (
        !result.hardFailures.length &&
        eligibleUnknowns(result.unknowns) &&
        result.stud === true &&
        totalWithinGraduationBudget([anchorPrice, record.Pricing_ActivePrice]).withinBudget
      );
    });
    if (replacement) {
      if (replacement.source === 'Saved')
        h.check(
          'G10',
          'saved-replacement-grounding',
          'unknown',
          `selected Saved stud ${replacement.card.id}; reviewer must confirm the G10 reply supported it`,
        );
      const previousEarringId = activeEarringId!;
      await h.view(replacement.source);
      await ensureSaved(replacement.card.id);
      await h.view('Combination');
      const previousCard = h.panel.locator(
        `.pw-compare-product[data-product-id="${safeId(previousEarringId)}"]`,
      );
      await previousCard.getByRole('button', { name: 'Remove from combination' }).click();
      await expect(previousCard).toHaveCount(0);
      try {
        await h.view(replacement.source);
        await h.clickCard(replacement.card.id, 'Add to combination');
      } catch (error) {
        await h.view('Saved');
        await h.clickCard(previousEarringId, 'Add to combination');
        await h.view('Combination');
        h.check(
          'G10',
          'failed-replacement-preserved',
          sameIds(cardIds(await h.cards('combination')), [quieterNecklaceId!, previousEarringId])
            ? 'pass'
            : 'fail',
          `replacement ${replacement.card.id} failed: ${String(error)}`,
        );
        throw error;
      }
      activeEarringId = replacement.card.id;
      studsId = replacement.card.id;
      await h.view('Combination');
      h.check(
        'G10',
        'anchor-preserved',
        sameIds(cardIds(await h.cards('combination')), [quieterNecklaceId!, activeEarringId])
          ? 'pass'
          : 'fail',
        cardIds(await h.cards('combination')).join(','),
      );
      const g10State = JSON.parse((await h.session())['jtv.shopping.v3'] ?? '{}') as {
        combinationQuantities?: Record<string, number>;
      };
      h.check(
        'G10',
        'sale-unit-quantities',
        (g10State.combinationQuantities?.[quieterNecklaceId!] ?? 1) === 1 &&
          (g10State.combinationQuantities?.[activeEarringId] ?? 1) === 1
          ? 'pass'
          : 'fail',
        JSON.stringify(g10State.combinationQuantities ?? {}),
      );
      const selectedSubtotal = h.panel.locator('.pw-selection > .pw-subtotal strong');
      const newPrice = h.exactRecords.get(activeEarringId)?.Pricing_ActivePrice;
      if (typeof anchorPrice === 'number' && typeof newPrice === 'number') {
        const expected = totalWithinGraduationBudget([anchorPrice, newPrice]).totalCents;
        const visible = Math.round(
          Number((await selectedSubtotal.innerText()).replace(/[^0-9.]/g, '')) * 100,
        );
        h.check(
          'G10',
          'subtotal-cents',
          visible === expected && expected <= 30000 ? 'pass' : 'fail',
          `expected=${expected} visible=${visible}`,
        );
      }
      await h.screenshot('G10-replacement');
    } else {
      h.check(
        'G10',
        'stud-replacement',
        'unknown',
        `no eligible replacement; prior combination must remain unchanged with ${activeEarringId}`,
      );
      await h.view('Combination');
      h.check(
        'G10',
        'prior-combination-preserved',
        sameIds(cardIds(await h.cards('combination')), [quieterNecklaceId!, activeEarringId!])
          ? 'pass'
          : 'fail',
        cardIds(await h.cards('combination')).join(','),
      );
    }
    halt();
    const g11 = await h.send(
      'G11',
      'Those two look good together. Are they an official matching set?',
    );
    h.check(
      'G11',
      'combination-continuity',
      sameIds(g11.shopping.combinationIds ?? [], [quieterNecklaceId!, activeEarringId!])
        ? 'pass'
        : 'fail',
      (g11.shopping.combinationIds ?? []).join(','),
    );
    const necklaceRecord = h.exactRecords.get(quieterNecklaceId!)!;
    const earringRecord = h.exactRecords.get(activeEarringId!)!;
    const explicitPairRelation =
      hasExplicitMatchingSetClaim(necklaceRecord) && hasExplicitMatchingSetClaim(earringRecord);
    h.check(
      'G11',
      'set-claim',
      'unknown',
      explicitPairRelation
        ? 'review the exact explicit pair relation before calling this an official set'
        : 'no explicit paired-set relation was verified; review reply for an honest separate-pieces answer',
    );
    halt();
    const g12 = await h.send(
      'G12',
      'I worry the earrings might irritate her ears. Can you tell if they would be comfortable?',
    );
    await h.exact(activeEarringId!, 'G12');
    h.check(
      'G12',
      'combination-continuity',
      sameIds(g12.shopping.combinationIds ?? [], [quieterNecklaceId!, activeEarringId!])
        ? 'pass'
        : 'fail',
      (g12.shopping.combinationIds ?? []).join(','),
    );
    h.check(
      'G12',
      'comfort-boundary',
      'unknown',
      'review for no medical or wearability promise from catalogue metal alone',
    );
    halt();
    beforeSavedEnd = await savedIds();
    const g13 = await h.send(
      'G13',
      'Then let us keep the necklace as the definite choice and leave the earrings in Saved. I can decide with her later.',
    );
    h.check(
      'G13',
      'sterling-retained',
      hasSterlingRequirement(g13.shopping) ? 'pass' : 'fail',
      'active sterling requirement',
    );
    h.check(
      'G13',
      'budget-retained',
      hasTotalBudget(g13.shopping) ? 'pass' : 'fail',
      'active $300 total requirement',
    );
    h.check(
      'G13',
      'agent-selection-state',
      (g13.shopping.combinationIds ?? []).includes(activeEarringId!) ? 'unknown' : 'pass',
      (g13.shopping.combinationIds ?? []).includes(activeEarringId!)
        ? 'earrings still in Combination after reply; shopper removes them through the UI and reviewer checks guidance'
        : 'earrings already removed from Combination by completed turn',
    );
    await h.view('Combination');
    const finalEarring = h.panel.locator(
      `.pw-compare-product[data-product-id="${safeId(activeEarringId!)}"]`,
    );
    if (await finalEarring.count())
      await finalEarring.getByRole('button', { name: 'Remove from combination' }).click();
    h.check(
      'G13',
      'necklace-alone',
      sameIds(cardIds(await h.cards('combination')), [quieterNecklaceId!]) ? 'pass' : 'fail',
      cardIds(await h.cards('combination')).join(','),
    );
    const finalSubtotal = h.panel.locator('.pw-selection > .pw-subtotal strong');
    const finalCents = Math.round(
      Number((await finalSubtotal.innerText()).replace(/[^0-9.]/g, '')) * 100,
    );
    h.check(
      'G13',
      'necklace-only-subtotal',
      typeof anchorPrice === 'number' && finalCents === Math.round(anchorPrice * 100)
        ? 'pass'
        : 'fail',
      `exact necklace=${String(anchorPrice)} visible cents=${finalCents}`,
    );
    const afterSavedEnd = await savedIds();
    h.check(
      'G13',
      'earrings-stay-saved',
      beforeSavedEnd.includes(activeEarringId!) &&
        afterSavedEnd.includes(activeEarringId!) &&
        sameIds(afterSavedEnd, beforeSavedEnd)
        ? 'pass'
        : 'fail',
      `before=${beforeSavedEnd.join(',')} after=${afterSavedEnd.join(',')}`,
    );
    await h.screenshot('G13-final');
  } catch (error) {
    if (!(error instanceof FirstFailureStop)) h.check('runner', 'exception', 'fail', String(error));
  } finally {
    await h.finish({ firstNecklaceId, quieterNecklaceId, dropId, studsId, activeEarringId }, agent);
    await context.close();
  }
  expect(h.firstFailure, `First graduation defect and receipts at ${outDir}`).toBeNull();
  expect(h.turns, `All thirteen connected turns must complete at ${outDir}`).toHaveLength(13);
  expect(
    h.assertions.filter((item) => item.status === 'unknown'),
    `Independent semantic and source review still required at ${outDir}`,
  ).toHaveLength(0);
});
