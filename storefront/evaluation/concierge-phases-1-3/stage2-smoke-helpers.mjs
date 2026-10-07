/**
 * Pure helpers for the Stage 2 bounded smoke harness. No browser, no network,
 * no paid calls: unit-tested by stage2-smoke.test.mjs via `node --test`.
 *
 * The reply-node classification mirrors the real two-column Concierge markup in
 * storefront/src/concierge/ConnectedConcierge.tsx:
 *   line 222: <p className="connected-message connected-user-message">
 *   line 225: <div className="connected-message connected-assistant-message connected-markdown">
 * A selector that matches `.connected-message` alone matches the shopper's own
 * bubble, which is the false-pass defect this module exists to prevent.
 */

/** The one class that only assistant reply nodes carry. */
export const ASSISTANT_REPLY_CLASS = 'connected-assistant-message';

/** True only for a node whose class list contains the assistant reply class exactly. */
export function isAssistantReplyNode(node) {
  if (!node || typeof node.className !== 'string') return false;
  return node.className.split(/\s+/).includes(ASSISTANT_REPLY_CLASS);
}

/**
 * Last assistant reply text from a snapshot of conversation nodes. Returns ''
 * when there is no assistant reply; never falls back to a user bubble, a
 * product article, or a system notice.
 */
export function lastAssistantReplyText(nodes) {
  const replies = (Array.isArray(nodes) ? nodes : [])
    .filter(isAssistantReplyNode)
    .map((node) => String(node.text ?? ''))
    .filter((text) => text.trim().length > 0);
  const last = replies[replies.length - 1];
  return last ? last.trim() : '';
}

/**
 * Outcome of evaluating one turn's /api/agent-evidence calls against a filter
 * predicate. `calls` items: { captured: boolean, parsed: unknown }. A response
 * that failed, was non-200, or did not parse as an object is NOT captured, and
 * an uncaptured response can never produce 'pass' or 'fail' on its own: the
 * harness cannot read what it did not capture.
 *
 * status: 'no-calls' (no evidence request observed at all), 'pass', 'fail',
 * or 'unknown' (some or all responses unreadable and the predicate did not
 * already pass on a readable one).
 */
export function evaluateRetrieval(calls, predicate) {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return { status: 'no-calls', readable: 0, unreadable: 0 };
  const readable = list.filter(
    (call) => call?.captured && call.parsed && typeof call.parsed === 'object',
  );
  const unreadable = list.length - readable.length;
  if (readable.some((call) => predicate(call.parsed)))
    return { status: 'pass', readable: readable.length, unreadable };
  if (unreadable > 0) return { status: 'unknown', readable: readable.length, unreadable };
  return { status: 'fail', readable: readable.length, unreadable: 0 };
}

/**
 * C1's "no product retrieval" assertion. Distinguishes three worlds:
 * - no evidence request observed at all -> 'pass'
 * - evidence requests observed and at least one readable -> the agent did
 *   retrieve, so 'fail' regardless of content
 * - evidence requests observed but none readable -> 'unknown' (a failed
 *   capture must never read as a pass)
 */
export function evaluateNoRetrieval(calls) {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return 'pass';
  const anyReadable = list.some((call) => call?.captured && call.parsed && typeof call.parsed === 'object');
  return anyReadable ? 'fail' : 'unknown';
}

/** JSON of a parsed evidence body's effective filters, from either body shape. */
export function effectiveFilterJson(parsed) {
  const filters =
    parsed?.effectiveFilters ?? parsed?.evidence?.effectiveFilters ?? [];
  return JSON.stringify(filters);
}

/**
 * The direct white-gold necklace filter checks shared by R1 and R2. Type and
 * price compile as string filters in effectiveFilters (retrieveEvidence.ts
 * pushes Catalog_ProductType and Pricing_ActivePrice bounds there); the
 * material constraint does NOT: it is verified POST-search per record by
 * server/concierge/materialEvidence.ts materialMatch() against each record's
 * Catalog_MaterialInformation entries. Returns the two filter booleans; the
 * material oracle is evaluateWhiteGoldRecords below.
 */
export function directNecklaceFilters(parsed) {
  const json = effectiveFilterJson(parsed);
  return {
    type: json.includes('Catalog_ProductType') && json.includes('Necklace'),
    priceBound: json.includes('Pricing_ActivePrice'),
  };
}

/** White gold in the catalogue is MaterialType "Gold" AND MaterialColor "White". */
export function recordWhiteGoldVerdict(record) {
  return recordMaterialVerdict(record, [{ type: 'Gold', color: 'White' }]);
}

/**
 * Product fields live under the evidence envelope's record wrapper:
 * records[i] = { source, objectID, contentHash, retrievedAt, evidenceRef,
 * record: { ...product fields, Catalog_MaterialInformation, canonical_url } }
 * (measured from .checkpoint/runs/stage2-smoke-2026-10-07T04-28-36-116Z). The
 * inner product object is what every per-record oracle must read.
 */
export function unwrapEvidenceRecord(record) {
  return record?.record ?? record;
}

/**
 * Generic per-record material verdict, measured against the compiled
 * alternatives (OR semantics): each alternative is a { type, color, purity? }
 * triple that must match one Catalog_MaterialInformation entry (case-sensitive;
 * an omitted/null purity is a wildcard). NOTE the real catalogue encoding,
 * measured from the captured records: sterling silver is MaterialType "Silver",
 * MaterialColor "White", MaterialPurity "Sterling" — "Sterling" is the PURITY,
 * not a color. A record fails if ANY entry carries an excluded MaterialColor
 * (e.g. "Yellow") or if it has material data and no alternative matches. Empty
 * or missing material arrays are unknown, not a violation. Returns
 * 'pass' | 'fail' | 'unknown'.
 */
export function recordMaterialVerdict(record, alternatives, excludedColors = []) {
  const materials = unwrapEvidenceRecord(record)?.Catalog_MaterialInformation;
  if (!Array.isArray(materials) || materials.length === 0) return 'unknown';
  const excluded = excludedColors.some((color) =>
    materials.some((entry) => entry?.MaterialColor === color),
  );
  if (excluded) return 'fail';
  const matched = alternatives.some(({ type, color, purity }) =>
    materials.some(
      (entry) =>
        entry?.MaterialType === type &&
        entry?.MaterialColor === color &&
        (purity == null || entry?.MaterialPurity === purity),
    ),
  );
  return matched ? 'pass' : 'fail';
}

/**
 * Aggregate one turn's evidence calls against the per-record material oracle.
 * The per-record requirement is universal: EVERY returned record must support
 * the material requirement, so 'fail' dominates, then 'pass', else 'unknown'
 * (no readable body, zero records, or no record carrying material data).
 */
export function evaluateMaterialRecords(calls, alternatives, excludedColors = []) {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return { status: 'no-calls', readable: 0, unreadable: 0, records: 0 };
  const readable = list.filter(
    (call) => call?.captured && call.parsed && typeof call.parsed === 'object',
  );
  const unreadable = list.length - readable.length;
  if (readable.length === 0)
    return { status: 'unknown', readable: 0, unreadable, records: 0 };
  const records = readable.flatMap((call) =>
    Array.isArray(call.parsed?.records) ? call.parsed.records : [],
  );
  const verdicts = records.map((record) => recordMaterialVerdict(record, alternatives, excludedColors));
  if (verdicts.includes('fail'))
    return { status: 'fail', readable: readable.length, unreadable, records: records.length };
  if (verdicts.includes('pass'))
    return { status: 'pass', readable: readable.length, unreadable, records: records.length };
  return { status: 'unknown', readable: readable.length, unreadable, records: records.length };
}

/** Back-compat wrapper: the R1/R2 white-gold oracle (fail dominates). */
export function evaluateWhiteGoldRecords(calls) {
  return evaluateMaterialRecords(calls, [{ type: 'Gold', color: 'White' }]);
}

/** True when an effectiveFilters entry compiles `field` with exactly `operator`. */
export function priceOperatorMatches(parsed, field, operator) {
  const filters = parsed?.effectiveFilters ?? parsed?.evidence?.effectiveFilters ?? [];
  return filters.some((f) => (f?.field ?? f?.attribute) === field && f?.operator === operator);
}

/** URLs from a citation candidate: a text blob, a bare URL, or a list of either. */
function extractCitationUrls(candidates) {
  const single = (candidate) =>
    typeof candidate === 'string'
      ? (candidate.match(/https?:\/\/[^\s)\]}>"]+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, ''))
      : [];
  return (Array.isArray(candidates) ? candidates : [candidates]).flatMap(single);
}

/**
 * C3 citation oracle. `candidates` is the RENDERED assistant reply: its text,
 * and the hrefs of anchors inside it (a markdown link renders as <a>label</a>,
 * so textContent alone loses the URL; the spec passes both). Every candidate
 * URL must equal the canonical_url of a blog record retrieved in that turn
 * (canonical_url lives under the record wrapper). 'pass' when every candidate
 * URL matches; 'fail' when any candidate URL matches none, including a
 * readable body that returned no records; 'unknown' when there are no
 * candidate URLs or no body was readable. Semantic passage SUPPORT stays with
 * independent review; this only checks citation identity.
 */
export function evaluateCitations(candidates, calls) {
  const urls = extractCitationUrls(candidates);
  if (urls.length === 0) return { status: 'unknown', urls: 0, canonicalUrls: 0 };
  const list = Array.isArray(calls) ? calls : [];
  const readable = list.filter(
    (call) => call?.captured && call.parsed && typeof call.parsed === 'object',
  );
  if (readable.length === 0) return { status: 'unknown', urls: urls.length, canonicalUrls: 0 };
  const canonicalUrls = new Set(
    readable
      .flatMap((call) => (Array.isArray(call.parsed?.records) ? call.parsed.records : []))
      .map((record) => {
        const inner = unwrapEvidenceRecord(record);
        return typeof inner?.canonical_url === 'string' ? inner.canonical_url : '';
      })
      .filter(Boolean),
  );
  if (canonicalUrls.size === 0) return { status: 'fail', urls: urls.length, canonicalUrls: 0 };
  return {
    status: urls.every((url) => canonicalUrls.has(url)) ? 'pass' : 'fail',
    urls: urls.length,
    canonicalUrls: canonicalUrls.size,
  };
}

/**
 * Ledger request kind for one observed /api/chat exchange, with real
 * continuation accounting:
 * - failed transport or HTTP >= 400 -> 'failure'
 * - a request issued after a failed one within the same turn -> 'retry'
 * - a later request within the same turn -> 'continuation'
 * - the first request of the retry turn of the abort-and-retry case -> 'retry'
 * - the first request of any other turn -> 'completion'
 */
export function classifyChatKind({
  failed,
  status,
  ordinal = 1,
  previousKind = null,
  isRetryTurn = false,
} = {}) {
  if (failed || (typeof status === 'number' && status >= 400)) return 'failure';
  if (previousKind === 'failure') return 'retry';
  if (ordinal > 1) return 'continuation';
  return isRetryTurn ? 'retry' : 'completion';
}

/**
 * ACTIVE-FACT ORACLE INPUT (W1 repair, 2026-10-07).
 * Evidence calls within one turn carry successive brief snapshots; earlier
 * snapshots can hold facts that were later superseded or retracted within the
 * same turn. A superseded fact must never drive a verdict (measured false
 * oracle: W1 R7b white-only). This helper reads the LAST evidence call that
 * carries a brief.facts array and returns only facts whose status is
 * 'active'. Inherited facts that are STILL active in the shared session are
 * returned too: they are the agent's accepted state, so oracles judge the
 * records against them instead of against the latest prompt alone.
 */
export function activeBriefFactsOf(calls) {
  const list = Array.isArray(calls) ? calls : [];
  let facts = [];
  for (const call of list) {
    if (!call?.captured) continue;
    const requestBody = (() => {
      try {
        return call.record?.requestBody ? JSON.parse(call.record.requestBody) : null;
      } catch {
        return null;
      }
    })();
    const briefFacts = requestBody?.brief?.facts;
    if (Array.isArray(briefFacts)) facts = briefFacts;
  }
  return facts.filter(
    (fact) =>
      fact &&
      typeof fact === 'object' &&
      fact.status === 'active',
  );
}

/**
 * Extract the ACTIVE material requirement (alternatives + exclusion colours)
 * from a turn's evidence calls. `found` is false when no active
 * material_alternatives fact exists, which is itself a case failure: the
 * shopper's material intent must be typed, not guessed. Exclusion colours come
 * from active exclusion facts on Catalog_MaterialInformation.MaterialColor
 * with operator 'none' (the C4 supported shape).
 */
export function activeMaterialRequirementOf(calls) {
  const facts = activeBriefFactsOf(calls);
  const alternativesFact = facts.find(
    (fact) =>
      fact.field === 'material' &&
      fact.value?.kind === 'material_alternatives' &&
      Array.isArray(fact.value.alternatives),
  );
  const excludedColors = facts
    .filter(
      (fact) =>
        fact.field === 'exclusion' &&
        fact.value?.kind === 'facet' &&
        fact.value.attribute === 'Catalog_MaterialInformation.MaterialColor' &&
        fact.value.operator === 'none' &&
        Array.isArray(fact.value.values),
    )
    .flatMap((fact) => fact.value.values);
  return {
    found: Boolean(alternativesFact),
    alternatives: alternativesFact?.value.alternatives ?? [],
    excludedColors: [...new Set(excludedColors)],
    activeFactCount: facts.length,
  };
}
