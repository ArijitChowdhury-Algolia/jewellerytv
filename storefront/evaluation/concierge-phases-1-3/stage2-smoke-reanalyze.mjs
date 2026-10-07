#!/usr/bin/env node
/**
 * POST-HOC RE-ANALYSIS of a captured Stage 2 smoke run directory. No browser,
 * no paid calls: it re-reads the saved requests.json / transcript.md from a
 * completed run, applies the CORRECTED oracles (envelope unwrapping, rendered
 * reply citations), and writes amended-summary.json into that run directory,
 * clearly labelled 'post-hoc re-analysis of captured evidence, not a new run'.
 *
 * Usage (from storefront/):
 *   node evaluation/concierge-phases-1-3/stage2-smoke-reanalyze.mjs [runDirName]
 * Without an argument the latest stage2-smoke-* directory is used.
 *
 * Post-hoc limitation: the saved transcript stores the reply's textContent,
 * which loses markdown link hrefs, so the citation oracle here runs on text
 * URLs only and may read 'unknown' where the live harness (which also captures
 * anchor hrefs) can decide. That limitation is recorded in the output notes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  directNecklaceFilters,
  evaluateCitations,
  evaluateMaterialRecords,
  evaluateNoRetrieval,
  evaluateRetrieval,
  priceOperatorMatches,
  recordMaterialVerdict,
} from './stage2-smoke-helpers.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runsRoot = path.resolve(scriptDir, '..', '..', '..', '.checkpoint', 'runs');

const requested = process.argv[2];
let runDir;
if (requested) {
  runDir = path.join(runsRoot, requested);
} else {
  const candidates = fs
    .readdirSync(runsRoot)
    .filter((name) => name.startsWith('stage2-smoke-'))
    .sort();
  if (!candidates.length) {
    console.error('No stage2-smoke-* run directories found under', runsRoot);
    process.exit(1);
  }
  runDir = path.join(runsRoot, candidates[candidates.length - 1]);
}
if (!fs.statSync(runDir).isDirectory()) {
  console.error('Not a run directory:', runDir);
  process.exit(1);
}

const requests = JSON.parse(fs.readFileSync(path.join(runDir, 'requests.json'), 'utf8'));

// transcript.md sections: "## <turn> (<at>)\n\nShopper: ...\n\nConcierge: ..."
const transcript = {};
const transcriptText = fs.readFileSync(path.join(runDir, 'transcript.md'), 'utf8');
for (const match of transcriptText.matchAll(/## ([^\s(]+) \([^)]*\)\n\nShopper: (.*?)\n\nConcierge: (.*?)\n/gs)) {
  transcript[match[1]] = { shopper: match[2], reply: match[3] };
}

const callsByTurn = new Map();
for (const record of requests) {
  if (!record.url.includes('/api/agent-evidence')) continue;
  let parsed = null;
  try {
    parsed = JSON.parse(record.responseBody);
  } catch {
    parsed = null;
  }
  const captured = !record.failed && record.status === 200 && parsed !== null && typeof parsed === 'object';
  const list = callsByTurn.get(record.turn) ?? [];
  list.push({ captured, parsed, record });
  callsByTurn.set(record.turn, list);
}

const C4_ALTERNATIVES = [
  { type: 'Silver', color: 'White', purity: 'Sterling' },
  { type: 'Gold', color: 'White' },
];

const assertions = {};
function record(id, status, detail) {
  assertions[id] = { status, detail };
}

// C1: no product retrieval during intake.
const c1Calls = callsByTurn.get('C1') ?? [];
record('C1-no-product-retrieval', evaluateNoRetrieval(c1Calls), `${c1Calls.length} evidence requests observed in the captured run`);

// C2: prod_catalog source and the compiled Necklace filter.
const c2Calls = callsByTurn.get('C2') ?? [];
record('C2-prod-catalog-retrieval', evaluateRetrieval(c2Calls, (parsed) => JSON.stringify(parsed).includes('prod_catalog')).status, `${c2Calls.length} evidence calls captured`);
record(
  'C2-category-filter-present',
  evaluateRetrieval(c2Calls, (parsed) => {
    const json = JSON.stringify(parsed?.effectiveFilters ?? []);
    return json.includes('Catalog_ProductType') && json.includes('Necklace');
  }).status,
  'effectiveFilters must contain Catalog_ProductType/Necklace',
);

// R1/R2: type + price-operator + white-gold records, per phrasing.
for (const [turnId, expectedOperator] of [
  ['R1', 'lt'],
  ['R2', 'lte'],
]) {
  const calls = callsByTurn.get(turnId) ?? [];
  const type = evaluateRetrieval(calls, (parsed) => {
    const json = JSON.stringify(parsed?.effectiveFilters ?? []);
    return json.includes('Catalog_ProductType') && json.includes('Necklace');
  });
  const price = evaluateRetrieval(
    calls,
    (parsed) =>
      JSON.stringify(parsed?.effectiveFilters ?? []).includes('Pricing_ActivePrice') &&
      priceOperatorMatches(parsed, 'Pricing_ActivePrice', expectedOperator),
  );
  const material = evaluateMaterialRecords(calls, [{ type: 'Gold', color: 'White' }]);
  record(`${turnId}-type-filter`, type.status, 'Catalog_ProductType=Necklace in effectiveFilters');
  record(`${turnId}-price-filter`, price.status, `Pricing_ActivePrice bound with operator ${expectedOperator}`);
  record(`${turnId}-material-filter`, material.status, materialDetail(calls, [{ type: 'Gold', color: 'White' }], []));
}

// C4/C4b: OR alternatives + yellow exclusion, per record.
for (const turnId of ['C4', 'C4b']) {
  const calls = callsByTurn.get(turnId) ?? [];
  if (!calls.length) continue;
  const outcome = evaluateMaterialRecords(calls, C4_ALTERNATIVES, ['Yellow']);
  record(`${turnId}-material-alternatives${turnId === 'C4b' ? '-retry' : ''}`, outcome.status, materialDetail(calls, C4_ALTERNATIVES, ['Yellow']));
  if (turnId === 'C4') {
    record('C4-yellow-exclusion', outcome.status, 'no returned record may carry a MaterialColor Yellow entry (same records-based aggregate)');
  }
}

// C3a: blog source + citation identity against the saved reply text.
const c3aCalls = callsByTurn.get('C3a') ?? [];
record('C3-blog-source', evaluateRetrieval(c3aCalls, (parsed) => JSON.stringify(parsed).includes('blog')).status, `${c3aCalls.length} evidence calls captured`);
const c3aReply = transcript.C3a?.reply ?? '';
const citations = evaluateCitations(c3aReply, c3aCalls);
record(
  'C3-citation-url',
  citations.status,
  `${citations.urls} URLs extracted from the saved transcript reply text against ${citations.canonicalUrls} retrieved canonical_urls; saved text loses markdown hrefs, so text-only extraction may read unknown where the live harness can decide`,
);

function materialDetail(calls, alternatives, excludedColors) {
  const records = calls
    .filter((call) => call.captured && call.parsed && typeof call.parsed === 'object')
    .flatMap((call) => (Array.isArray(call.parsed?.records) ? call.parsed.records : []));
  const failing = records.filter((r) => recordMaterialVerdict(r, alternatives, excludedColors) === 'fail').map((r) => r.objectID);
  const unknownCount = records.filter((r) => recordMaterialVerdict(r, alternatives, excludedColors) === 'unknown').length;
  return `${records.length} records checked; failing: ${failing.length ? failing.join(',') : 'none'}; material-less (unknown): ${unknownCount}`;
}

const amended = {
  label: 'post-hoc re-analysis of captured evidence, not a new run',
  sourceRun: path.basename(runDir),
  evaluatedAt: new Date().toISOString(),
  oraclesVersion: 'envelope-unwrap + rendered-reply citations + purity-aware alternatives',
  assertions,
  notes: [
    'No paid Agent Studio turn was spent producing this file; every verdict is recomputed from the captured response bodies already on disk.',
    'Citation extraction uses the saved transcript text, which loses markdown link hrefs; the live harness captures anchor hrefs as well and is authoritative for C3-citation-url.',
    'Material oracles read Catalog_MaterialInformation under the envelope record wrapper; sterling silver matches MaterialType Silver + MaterialColor White + MaterialPurity Sterling.',
  ],
};
fs.writeFileSync(path.join(runDir, 'amended-summary.json'), JSON.stringify(amended, null, 2));

console.log(`POST-HOC RE-ANALYSIS of ${path.basename(runDir)} (not a new run)`);
for (const [id, entry] of Object.entries(assertions)) {
  console.log(`  ${entry.status.padEnd(9)} ${id}  ${entry.detail}`);
}
console.log(`Wrote ${path.join(runDir, 'amended-summary.json')}`);
