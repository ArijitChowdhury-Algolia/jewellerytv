import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSISTANT_REPLY_CLASS,
  classifyChatKind,
  directNecklaceFilters,
  effectiveFilterJson,
  evaluateCitations,
  evaluateMaterialRecords,
  evaluateNoRetrieval,
  evaluateRetrieval,
  evaluateWhiteGoldRecords,
  isAssistantReplyNode,
  lastAssistantReplyText,
  priceOperatorMatches,
  activeBriefFactsOf,
  activeMaterialRequirementOf,
  recordMaterialVerdict,
  recordWhiteGoldVerdict,
} from './stage2-smoke-helpers.mjs';

// Fixtures mirror the real two-column Concierge markup in
// storefront/src/concierge/ConnectedConcierge.tsx:
//   line 222: <p className="connected-message connected-user-message">
//   line 225: <div className="connected-message connected-assistant-message connected-markdown">
//   line 649: <p className="connected-system-notice" role="status">
const userBubble = (text) => ({ tagName: 'p', className: 'connected-message connected-user-message', text });
const assistantReply = (text) => ({ tagName: 'div', className: 'connected-message connected-assistant-message connected-markdown', text });
const systemNotice = (text) => ({ tagName: 'p', className: 'connected-system-notice', text });
const productArticle = (text) => ({ tagName: 'article', className: 'pw-product', text });
const legacyAssistantStub = (text) => ({ tagName: 'div', className: 'connected-message', 'data-role': 'assistant', text });

test('lastAssistantReplyText picks only the assistant reply, never the shopper bubble', () => {
  const transcript = [
    userBubble('It is our tenth anniversary.'),
    assistantReply('Happy anniversary. Tell me a little more about her style.'),
  ];
  assert.equal(lastAssistantReplyText(transcript), 'Happy anniversary. Tell me a little more about her style.');
});

test('lastAssistantReplyText ignores product articles and system notices', () => {
  const transcript = [
    assistantReply('Here are some directions.'),
    productArticle('Product card text must never read as a reply'),
    systemNotice('[System notice] This request could not be completed.'),
  ];
  assert.equal(lastAssistantReplyText(transcript), 'Here are some directions.');
});

test('lastAssistantReplyText returns empty when only user bubbles exist (no false pass)', () => {
  const transcript = [userBubble('Show me necklaces'), userBubble('Actually silver')];
  assert.equal(lastAssistantReplyText(transcript), '');
  assert.equal(lastAssistantReplyText([]), '');
  assert.equal(lastAssistantReplyText(undefined), '');
});

test('lastAssistantReplyText does not match the retired broad-selector shape', () => {
  // The old selector also matched .connected-message alone and [data-role=assistant];
  // neither may classify as an assistant reply without the assistant class.
  assert.equal(isAssistantReplyNode(legacyAssistantStub('canned')), false);
  assert.equal(lastAssistantReplyText([legacyAssistantStub('canned')]), '');
  assert.equal(isAssistantReplyNode({ tagName: 'div', className: 'connected-assistant-message-impostor', text: 'x' }), false);
  assert.equal(isAssistantReplyNode({ tagName: 'div', className: `a ${ASSISTANT_REPLY_CLASS} b`, text: 'x' }), true);
});

test('lastAssistantReplyText trims whitespace and takes the latest reply', () => {
  const transcript = [
    assistantReply('  first reply  '),
    assistantReply('\n  latest reply with detail\n '),
  ];
  assert.equal(lastAssistantReplyText(transcript), 'latest reply with detail');
});

test('evaluateNoRetrieval: zero evidence calls passes', () => {
  assert.equal(evaluateNoRetrieval([]), 'pass');
});

test('evaluateNoRetrieval: a readable evidence call means retrieval happened (fail)', () => {
  const calls = [
    { captured: true, parsed: { source: 'prod_catalog', effectiveFilters: [] } },
    { captured: false, parsed: null },
  ];
  assert.equal(evaluateNoRetrieval(calls), 'fail');
});

test('evaluateNoRetrieval: observed but unreadable capture is unknown, never pass', () => {
  const calls = [{ captured: false, parsed: null }];
  assert.equal(evaluateNoRetrieval(calls), 'unknown');
});

test('evaluateRetrieval: no calls reports no-calls', () => {
  assert.deepEqual(evaluateRetrieval([], () => true), { status: 'no-calls', readable: 0, unreadable: 0 });
});

test('evaluateRetrieval: unreadable capture alone stays unknown', () => {
  const outcome = evaluateRetrieval([{ captured: false, parsed: null }], () => true);
  assert.equal(outcome.status, 'unknown');
});

test('evaluateRetrieval: readable match passes even beside unreadable captures', () => {
  const calls = [
    { captured: false, parsed: null },
    { captured: true, parsed: { effectiveFilters: [{ attribute: 'Catalog_ProductType', value: 'Necklace' }] } },
  ];
  assert.equal(evaluateRetrieval(calls, (p) => JSON.stringify(p).includes('Necklace')).status, 'pass');
});

test('evaluateRetrieval: readable miss with another unreadable capture is unknown, not fail', () => {
  const calls = [
    { captured: true, parsed: { effectiveFilters: [] } },
    { captured: false, parsed: null },
  ];
  assert.equal(evaluateRetrieval(calls, () => false).status, 'unknown');
});

test('evaluateRetrieval: readable miss with all captures readable is a real fail', () => {
  const calls = [{ captured: true, parsed: { effectiveFilters: [] } }];
  assert.equal(evaluateRetrieval(calls, () => false).status, 'fail');
});

const necklaceBody = {
  status: 'ok',
  source: 'prod_catalog',
  effectiveFilters: [
    { attribute: 'Catalog_ProductType', values: ['Necklace'] },
    { attribute: 'MetalColour', values: ['White'] },
    { attribute: 'Pricing_ActivePrice', range: { max: 300 } },
  ],
};

test('effectiveFilterJson reads the top-level and nested body shapes', () => {
  assert.ok(effectiveFilterJson(necklaceBody).includes('Catalog_ProductType'));
  assert.ok(effectiveFilterJson({ evidence: { effectiveFilters: [1] } }).includes('1'));
  assert.equal(effectiveFilterJson({}), '[]');
  assert.equal(effectiveFilterJson(null), '[]');
});

test('directNecklaceFilters detects type and exact price bound from effectiveFilters', () => {
  const flags = directNecklaceFilters(necklaceBody);
  assert.deepEqual(flags, { type: true, priceBound: true });
});

test('directNecklaceFilters fails closed when a required filter is absent', () => {
  const missing = { effectiveFilters: [{ attribute: 'Catalog_ProductType', values: ['Necklace'] }] };
  const flags = directNecklaceFilters(missing);
  assert.equal(flags.type, true);
  assert.equal(flags.priceBound, false);
});

// Envelope fixtures in the REAL /api/agent-evidence shape, measured from
// .checkpoint/runs/stage2-smoke-2026-10-07T04-28-36-116Z: each record is
// { source, objectID, contentHash, retrievedAt, evidenceRef, record: {...} }
// and product fields (Catalog_MaterialInformation, canonical_url) live under
// .record. The R1-style shell (VG314H, Gold/White 14K) and the blog shell
// (canonical_url https://www.jtv.com/blog/gold-filled-vs-gold-plated) are
// copied from that run with long text fields elided. White gold is MaterialType
// "Gold" AND MaterialColor "White" (server/concierge/materialEvidence.ts).
const envelope = (objectID, source, inner) => ({
  source,
  objectID,
  contentHash: `hash-${objectID}`,
  retrievedAt: '2026-10-07T04:28:00.000Z',
  evidenceRef: `${source}/${objectID}/hash-${objectID}`,
  record: inner,
});
const goldWhiteRecord = envelope('VG314H', 'prod_catalog', {
  objectID: 'VG314H',
  Catalog_ProductType: 'Necklace',
  Catalog_MaterialInformation: [
    { MaterialColor: 'White', MaterialColorGroup: 'White', MaterialPurity: '14K', MaterialType: 'Gold' },
  ],
});
const bronzeYellowRecord = envelope('ZNBR9', 'prod_catalog', {
  objectID: 'ZNBR9',
  Catalog_ProductType: 'Necklace',
  Catalog_MaterialInformation: [
    { MaterialColor: 'Yellow', MaterialColorGroup: 'Yellow', MaterialType: 'Bronze' },
  ],
});
const noMaterialRecord = envelope('EMPTY', 'prod_catalog', { objectID: 'EMPTY' });
const mixedRecord = envelope('MIX', 'prod_catalog', {
  objectID: 'MIX',
  Catalog_MaterialInformation: [
    { MaterialType: 'Bronze', MaterialColor: 'Yellow' },
    { MaterialType: 'Gold', MaterialColor: 'White' },
  ],
});
const flatGoldWhiteRecord = {
  // backward compatibility: a bare product object with no envelope wrapper
  objectID: 'FLAT1',
  Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialColor: 'White' }],
};
const blogRecord = envelope(
  '4f4c4265851c510994f1dfe8ffd7e3cce1bbb17837b8441bba87617f96a34102',
  'blog',
  {
    objectID: '4f4c4265851c510994f1dfe8ffd7e3cce1bbb17837b8441bba87617f96a34102',
    title: 'Gold Filled vs Gold Plated',
    canonical_url: 'https://www.jtv.com/blog/gold-filled-vs-gold-plated',
    content: '(long article body elided from the fixture)',
  },
);

test('recordWhiteGoldVerdict: Gold/White entry passes, Bronze/Yellow fails', () => {
  assert.equal(recordWhiteGoldVerdict(goldWhiteRecord), 'pass');
  assert.equal(recordWhiteGoldVerdict(bronzeYellowRecord), 'fail');
  assert.equal(recordWhiteGoldVerdict(mixedRecord), 'pass');
});

test('recordWhiteGoldVerdict: empty or missing material array is unknown, not a violation', () => {
  assert.equal(recordWhiteGoldVerdict(noMaterialRecord), 'unknown');
  assert.equal(recordWhiteGoldVerdict({ objectID: 'E', Catalog_MaterialInformation: [] }), 'unknown');
});

test('material oracle reads product fields under the envelope record wrapper AND flat shapes', () => {
  // Real envelope: product fields under .record (this is the regression that
  // made every real capture read as material-less).
  assert.equal(recordWhiteGoldVerdict(goldWhiteRecord), 'pass');
  assert.equal(recordWhiteGoldVerdict(flatGoldWhiteRecord), 'pass');
  assert.equal(recordWhiteGoldVerdict({ record: { objectID: 'X' } }), 'unknown');
});

test('evaluateWhiteGoldRecords: no calls reports no-calls', () => {
  assert.deepEqual(evaluateWhiteGoldRecords([]), { status: 'no-calls', readable: 0, unreadable: 0, records: 0 });
});

test('evaluateWhiteGoldRecords: unreadable capture alone stays unknown', () => {
  assert.equal(evaluateWhiteGoldRecords([{ captured: false, parsed: null }]).status, 'unknown');
});

test('evaluateWhiteGoldRecords: all-white-gold records pass across captured bodies', () => {
  const calls = [{ captured: true, parsed: { source: 'prod_catalog', records: [goldWhiteRecord, goldWhiteRecord] } }];
  const outcome = evaluateWhiteGoldRecords(calls);
  assert.equal(outcome.status, 'pass');
  assert.equal(outcome.records, 2);
});

test('evaluateWhiteGoldRecords: material data present but no Gold/White entry fails', () => {
  const calls = [{ captured: true, parsed: { records: [bronzeYellowRecord] } }];
  assert.equal(evaluateWhiteGoldRecords(calls).status, 'fail');
});

test('evaluateWhiteGoldRecords: records without material arrays are unknown, never fail', () => {
  const calls = [{ captured: true, parsed: { records: [noMaterialRecord, noMaterialRecord] } }];
  const outcome = evaluateWhiteGoldRecords(calls);
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.records, 2);
});

test('evaluateWhiteGoldRecords: zero returned records is unknown (nothing to verify)', () => {
  const calls = [{ captured: true, parsed: { records: [] } }];
  assert.equal(evaluateWhiteGoldRecords(calls).status, 'unknown');
});

// OR-alternatives fixture set for C4 (Silver+Sterling OR Gold+White, no
// Yellow). SWW679D's Silver/Sterling shell is copied from the real C4 capture;
// the two-tone record mirrors the real 193Z7A (Silver/Sterling AND Yellow 14K
// Gold), which the exclusion rule must fail.
const sterlingRecord = envelope('SWW679D', 'prod_catalog', {
  objectID: 'SWW679D',
  Catalog_MaterialInformation: [
    { MaterialColor: 'White', MaterialColorGroup: 'White', MaterialPurity: 'Sterling', MaterialType: 'Silver' },
  ],
});
const yellowGoldRecord = envelope('YG1', 'prod_catalog', {
  objectID: 'YG1',
  Catalog_MaterialInformation: [{ MaterialType: 'Gold', MaterialColor: 'Yellow' }],
});
const twoToneSterlingYellowRecord = envelope('193Z7A', 'prod_catalog', {
  objectID: '193Z7A',
  Catalog_MaterialInformation: [
    { MaterialColor: 'White', MaterialColorGroup: 'White', MaterialPurity: 'Sterling', MaterialType: 'Silver' },
    { MaterialColor: 'Yellow', MaterialColorGroup: 'Yellow', MaterialPurity: '14K', MaterialType: 'Gold' },
  ],
});
const unknownMaterialRecord = envelope('UM1', 'prod_catalog', {
  objectID: 'UM1',
  Catalog_MaterialInformation: [],
});

test('recordMaterialVerdict matches either OR alternative', () => {
  const alternatives = [
    { type: 'Silver', color: 'White', purity: 'Sterling' },
    { type: 'Gold', color: 'White' },
  ];
  assert.equal(recordMaterialVerdict(goldWhiteRecord, alternatives), 'pass');
  assert.equal(recordMaterialVerdict(sterlingRecord, alternatives), 'pass');
  assert.equal(recordMaterialVerdict(bronzeYellowRecord, alternatives), 'fail');
});

test('recordMaterialVerdict: any excluded MaterialColor entry fails the record', () => {
  const alternatives = [
    { type: 'Silver', color: 'White', purity: 'Sterling' },
    { type: 'Gold', color: 'White' },
  ];
  // yellow gold carries the excluded color even though its type matches an alternative
  assert.equal(recordMaterialVerdict(yellowGoldRecord, alternatives, ['Yellow']), 'fail');
  assert.equal(recordMaterialVerdict(goldWhiteRecord, alternatives, ['Yellow']), 'pass');
  // exclusion is case-sensitive per catalogue values: a lowercase 'yellow'
  // entry does not trip the exclusion, and the record still passes via its
  // compliant Gold/White entry
  assert.equal(
    recordMaterialVerdict(
      {
        objectID: 'X',
        Catalog_MaterialInformation: [
          { MaterialType: 'Gold', MaterialColor: 'White' },
          { MaterialType: 'Gold', MaterialColor: 'yellow' },
        ],
      },
      alternatives,
      ['Yellow'],
    ),
    'pass',
  );
});

test('recordMaterialVerdict: missing material data is unknown, not a violation', () => {
  const alternatives = [{ type: 'Gold', color: 'White' }];
  assert.equal(recordMaterialVerdict(unknownMaterialRecord, alternatives), 'unknown');
  assert.equal(recordMaterialVerdict(noMaterialRecord, alternatives), 'unknown');
});

test('evaluateMaterialRecords: fail dominates across records (every record must comply)', () => {
  const alternatives = [
    { type: 'Silver', color: 'White', purity: 'Sterling' },
    { type: 'Gold', color: 'White' },
  ];
  const calls = [{ captured: true, parsed: { records: [goldWhiteRecord, bronzeYellowRecord] } }];
  const outcome = evaluateMaterialRecords(calls, alternatives);
  assert.equal(outcome.status, 'fail');
  assert.equal(outcome.records, 2);
});

test('evaluateMaterialRecords: all records compliant passes', () => {
  const alternatives = [
    { type: 'Silver', color: 'White', purity: 'Sterling' },
    { type: 'Gold', color: 'White' },
  ];
  const calls = [{ captured: true, parsed: { records: [goldWhiteRecord, sterlingRecord] } }];
  assert.equal(evaluateMaterialRecords(calls, alternatives, ['Yellow']).status, 'pass');
});

test('evaluateMaterialRecords: only material-less records stays unknown', () => {
  const alternatives = [{ type: 'Gold', color: 'White' }];
  const calls = [{ captured: true, parsed: { records: [unknownMaterialRecord] } }];
  assert.equal(evaluateMaterialRecords(calls, alternatives, ['Yellow']).status, 'unknown');
});

test('evaluateWhiteGoldRecords now fails when any record lacks Gold/White', () => {
  // Aggregation correction: the per-record requirement is universal, so a
  // 4-good-1-bad record set must fail, not pass.
  const calls = [{ captured: true, parsed: { records: [goldWhiteRecord, bronzeYellowRecord] } }];
  assert.equal(evaluateWhiteGoldRecords(calls).status, 'fail');
});

test('priceOperatorMatches distinguishes strict lt from inclusive lte', () => {
  const lteBody = { effectiveFilters: [{ field: 'Pricing_ActivePrice', operator: 'lte', value: 300 }] };
  const ltBody = { effectiveFilters: [{ field: 'Pricing_ActivePrice', operator: 'lt', value: 300 }] };
  assert.equal(priceOperatorMatches(lteBody, 'Pricing_ActivePrice', 'lte'), true);
  assert.equal(priceOperatorMatches(lteBody, 'Pricing_ActivePrice', 'lt'), false);
  assert.equal(priceOperatorMatches(ltBody, 'Pricing_ActivePrice', 'lt'), true);
  assert.equal(priceOperatorMatches({}, 'Pricing_ActivePrice', 'lt'), false);
});

test('evaluateCitations passes when every reply URL equals a retrieved canonical_url', () => {
  const calls = [
    {
      captured: true,
      parsed: {
        source: 'blog',
        records: [
          blogRecord,
          envelope('second-blog', 'blog', {
            objectID: 'second-blog',
            canonical_url: 'https://www.jtv.com/blog/care-guide',
          }),
        ],
      },
    },
  ];
  const reply = 'Read more at https://www.jtv.com/blog/gold-filled-vs-gold-plated and https://www.jtv.com/blog/care-guide.';
  assert.deepEqual(evaluateCitations(reply, calls), { status: 'pass', urls: 2, canonicalUrls: 2 });
});

test('evaluateCitations reads anchor hrefs alongside reply text (markdown links)', () => {
  // The rendered reply shows the URL only as an <a> label, so the spec passes
  // the hrefs next to the text; both layers must be accepted.
  const calls = [{ captured: true, parsed: { source: 'blog', records: [blogRecord] } }];
  const candidates = [
    'You can read the full JTV guide here.', // textContent: no URL at all
    'https://www.jtv.com/blog/gold-filled-vs-gold-plated', // anchor href
  ];
  assert.deepEqual(evaluateCitations(candidates, calls), { status: 'pass', urls: 1, canonicalUrls: 1 });
});

test('evaluateCitations fails when a reply URL matches no retrieved canonical_url', () => {
  const calls = [{ captured: true, parsed: { source: 'blog', records: [blogRecord] } }];
  const reply = 'See https://example.com/invented-post for details.';
  assert.deepEqual(evaluateCitations(reply, calls), { status: 'fail', urls: 1, canonicalUrls: 1 });
});

test('evaluateCitations: readable body with zero records fails unsupported citations', () => {
  const calls = [{ captured: true, parsed: { records: [] } }];
  assert.equal(evaluateCitations('See https://example.com/x', calls).status, 'fail');
});

test('evaluateCitations: no URL in the reply is unknown, not a fail', () => {
  const calls = [{ captured: true, parsed: { source: 'blog', records: [blogRecord] } }];
  assert.deepEqual(evaluateCitations('No links here.', calls), { status: 'unknown', urls: 0, canonicalUrls: 0 });
});

test('evaluateCitations: unreadable bodies with URLs present stay unknown', () => {
  assert.equal(evaluateCitations('See https://example.com/x', [{ captured: false, parsed: null }]).status, 'unknown');
});

test('classifyChatKind separates failures from completions', () => {
  assert.equal(classifyChatKind({ failed: true, status: null }), 'failure');
  assert.equal(classifyChatKind({ failed: false, status: 502 }), 'failure');
  assert.equal(classifyChatKind({ failed: false, status: 200 }), 'completion');
  assert.equal(classifyChatKind({ failed: false, status: null }), 'completion');
});

test('classifyChatKind counts continuations and retries as distinct kinds', () => {
  // second request of a normal turn
  assert.equal(classifyChatKind({ failed: false, status: 200, ordinal: 2 }), 'continuation');
  // a request re-issued after a failure inside the same turn is a retry, not a continuation
  assert.equal(
    classifyChatKind({ failed: false, status: 200, ordinal: 2, previousKind: 'failure' }),
    'retry',
  );
  // first request of the abort-and-retry shopper turn is a retry at the case level
  assert.equal(classifyChatKind({ failed: false, status: 200, ordinal: 1, isRetryTurn: true }), 'retry');
  // a later request of the retry turn that follows a success is a continuation
  assert.equal(
    classifyChatKind({ failed: false, status: 200, ordinal: 2, previousKind: 'retry', isRetryTurn: true }),
    'continuation',
  );
  // failures outrank everything
  assert.equal(classifyChatKind({ failed: false, status: 500, ordinal: 2, previousKind: 'retry' }), 'failure');
});

// SKIP-WITHOUT-RESIDUE: a skip must leave zero residue under
// .checkpoint/runs/. The spec can only guarantee that if the run directory is
// created strictly AFTER both test.skip guards and every file write lives
// inside that guarded body. This static check runs without a browser.
test('spec creates the run directory only after both opt-in skips (no residue on skip)', () => {
  const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage2-smoke.spec.ts');
  const lines = fs.readFileSync(specPath, 'utf8').split('\n');
  const lineOf = (needle) =>
    lines.map((l, i) => (l.includes(needle) ? i + 1 : 0)).filter(Boolean);
  const optInSkips = lineOf('test.skip(!live');
  const budgetSkips = lineOf('test.skip(!budgetReady');
  const mkdirs = lineOf('fs.mkdirSync');
  const writes = lineOf('fs.writeFileSync');
  assert.equal(optInSkips.length, 1, 'exactly one opt-in test.skip guard');
  assert.equal(budgetSkips.length, 1, 'exactly one budget test.skip guard');
  assert.equal(mkdirs.length, 1, 'exactly one run-directory creation');
  assert.ok(
    mkdirs[0] > optInSkips[0] && mkdirs[0] > budgetSkips[0],
    `fs.mkdirSync (line ${mkdirs[0]}) must come after both test.skip guards (lines ${optInSkips[0]}, ${budgetSkips[0]})`,
  );
  assert.ok(
    writes.every((line) => line > mkdirs[0]),
    'every file write must live inside the guarded body, after the run-directory creation',
  );
});

// ---- W1 repair: active-fact oracle input (superseded facts never drive a verdict) ----

const evidenceCall = (facts) => ({
  captured: true,
  parsed: { status: 'ok', source: 'prod_catalog', records: [] },
  record: { url: 'http://localhost:5173/api/agent-evidence', requestBody: JSON.stringify({ brief: { facts } }) },
});

test('activeBriefFactsOf reads only the latest brief snapshot and only active facts', () => {
  const calls = [
    evidenceCall([
      { field: 'material', status: 'active', value: { kind: 'material_alternatives', alternatives: [{ type: 'Gold', color: 'White' }] } },
      { field: 'product_type', status: 'active', value: { kind: 'facet', attribute: 'Catalog_ProductType', values: ['Necklace'], operator: 'any' } },
    ]),
    evidenceCall([
      { field: 'material', status: 'superseded', value: { kind: 'material_alternatives', alternatives: [{ type: 'Gold', color: 'White' }] } },
      { field: 'material', status: 'active', value: { kind: 'material_alternatives', alternatives: [{ type: 'Gold' }] } },
    ]),
  ];
  const facts = activeBriefFactsOf(calls);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].value.alternatives[0].color, undefined, 'superseded white-only fact must not survive');
});

test('activeBriefFactsOf ignores unreadable and uncaptured calls', () => {
  const calls = [
    { captured: false, parsed: null, record: { requestBody: null } },
    evidenceCall([{ field: 'product_type', status: 'active' }]),
  ];
  assert.equal(activeBriefFactsOf(calls).length, 1);
});

test('activeMaterialRequirementOf returns typed alternatives and none-operator exclusions', () => {
  const calls = [
    evidenceCall([
      { field: 'material', status: 'active', value: { kind: 'material_alternatives', alternatives: [{ type: 'Silver', color: 'White', purity: 'Sterling' }, { type: 'Gold', color: 'White' }] } },
      { field: 'exclusion', status: 'active', value: { kind: 'facet', attribute: 'Catalog_MaterialInformation.MaterialColor', values: ['Yellow'], operator: 'none' } },
      { field: 'product_type', status: 'superseded', value: { kind: 'facet', attribute: 'Catalog_ProductType', values: ['Bracelet'], operator: 'any' } },
    ]),
  ];
  const requirement = activeMaterialRequirementOf(calls);
  assert.equal(requirement.found, true);
  assert.equal(requirement.alternatives.length, 2);
  assert.deepEqual(requirement.excludedColors, ['Yellow']);
});

test('activeMaterialRequirementOf found=false when no active alternatives fact is typed', () => {
  const requirement = activeMaterialRequirementOf([evidenceCall([{ field: 'product_type', status: 'active' }])]);
  assert.equal(requirement.found, false);
  assert.deepEqual(requirement.alternatives, []);
  assert.deepEqual(requirement.excludedColors, []);
});

test('activeMaterialRequirementOf is honest when no call is readable', () => {
  const requirement = activeMaterialRequirementOf([{ captured: false, parsed: null, record: { requestBody: null } }]);
  assert.equal(requirement.found, false);
});

test('activeBriefFactsOf drops facts with a missing or undefined status (strict active filter)', () => {
  const calls = [
    evidenceCall([
      { field: 'material', status: 'active', value: { kind: 'material_alternatives', alternatives: [{ type: 'Gold', color: 'White' }] } },
      { field: 'product_type', value: { kind: 'facet', attribute: 'Catalog_ProductType', values: ['Necklace'], operator: 'any' } },
      { field: 'fit', status: undefined, value: { kind: 'measurement', value: 22, unit: 'in' } },
    ]),
  ];
  const facts = activeBriefFactsOf(calls);
  assert.equal(facts.length, 1, 'only the explicitly active fact survives');
  assert.equal(facts[0].field, 'material');
});
