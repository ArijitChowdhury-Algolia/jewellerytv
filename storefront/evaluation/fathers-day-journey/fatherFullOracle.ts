export type CatalogRecord = Record<string, unknown>;

export function hasFatherOpeningContext(state: { brief?: { facts?: unknown[] } }) {
  const facts = (state.brief?.facts ?? []).filter(
    (
      raw,
    ): raw is {
      field?: string;
      status?: string;
      certainty?: string;
      value?: { kind?: string; text?: string };
    } => !!raw && typeof raw === 'object',
  );
  const has = (field: string, pattern: RegExp) =>
    facts.some(
      (fact) =>
        fact.field === field &&
        fact.status === 'active' &&
        fact.certainty === 'explicit' &&
        fact.value?.kind === 'text' &&
        typeof fact.value.text === 'string' &&
        pattern.test(fact.value.text),
    );
  return has('recipient', /\b(dad|father)\b/i) && has('occasion', /father.?s day/i);
}

export function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid catalogue price');
  return Math.round(value * 100);
}

export function subtotalWithinBudget(prices: number[], budget: number) {
  const total = prices.reduce((sum, price) => sum + cents(price), 0);
  return { cents: total, withinBudget: total <= cents(budget) };
}

export function sameProductIds(actual: string[], expected: string[]) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function bandMaterials(record: CatalogRecord) {
  const values = record.Catalog_BandMaterialInformation;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is CatalogRecord => !!value && typeof value === 'object');
}

export function assessWatch(record: CatalogRecord, budget: number) {
  const hardFailures: string[] = [];
  const unknowns: string[] = [];
  if (text(record.Catalog_ProductType) !== 'wrist watch') hardFailures.push('not-watch');
  if (text(record.Catalog_Condition) !== 'first quality') {
    (record.Catalog_Condition == null ? unknowns : hardFailures).push('condition');
  }
  if (record.Catalog_PreviouslyOwned !== false) {
    (record.Catalog_PreviouslyOwned == null ? unknowns : hardFailures).push('previously-owned');
  }
  if (record.Inventory_InStock !== true) {
    (record.Inventory_InStock == null ? unknowns : hardFailures).push('not-in-stock');
  }
  const price = record.Pricing_ActivePrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) unknowns.push('price');
  else if (cents(price) > cents(budget)) hardFailures.push('over-budget');

  const band = bandMaterials(record);
  const leather =
    text(record.Catalog_WatchBandType) === 'strap' &&
    band.some(
      (part) =>
        text(part.WatchBandMaterialName).includes('leather') &&
        text(part.WatchBandMaterialColor).includes('brown'),
    );
  const steel =
    text(record.Catalog_WatchPrimaryDialPrimaryColor) === 'black' &&
    text(record.Catalog_WatchBandType) === 'bracelet' &&
    band.some((part) => text(part.WatchBandMaterialName).includes('stainless steel'));
  return {
    hardFailures,
    unknowns,
    leather,
    steel,
    price: typeof price === 'number' ? price : null,
  };
}

export function chooseWatchDirections(records: CatalogRecord[], budget: number) {
  let leatherId: string | null = null;
  let steelId: string | null = null;
  for (const record of records) {
    const id = record.objectID;
    if (typeof id !== 'string' || !id) continue;
    const assessment = assessWatch(record, budget);
    if (assessment.hardFailures.length || assessment.unknowns.length) continue;
    if (assessment.leather && !leatherId) leatherId = id;
    if (assessment.steel && !steelId) steelId = id;
  }
  return { leatherId, steelId };
}

export function assessBracelet(record: CatalogRecord) {
  const hardFailures: string[] = [];
  const unknowns: string[] = [];
  if (text(record.Catalog_ProductType) !== 'bracelet') hardFailures.push('not-bracelet');
  if (text(record.Catalog_Condition) !== 'first quality') {
    (record.Catalog_Condition == null ? unknowns : hardFailures).push('condition');
  }
  if (record.Catalog_PreviouslyOwned !== false) {
    (record.Catalog_PreviouslyOwned == null ? unknowns : hardFailures).push('previously-owned');
  }
  if (record.Inventory_InStock !== true) {
    (record.Inventory_InStock == null ? unknowns : hardFailures).push('not-in-stock');
  }
  const material = text(record.Catalog_JewelryMaterialAggregateFullName);
  const gemStatus = text(record.Catalog_JewelryGemMaterialStatus);
  if (!material) unknowns.push('material');
  if (!gemStatus) unknowns.push('gem-material');
  const plainSteel =
    material.includes('stainless steel') && gemStatus === 'contains no gem material';
  const price = record.Pricing_ActivePrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) unknowns.push('price');
  return { hardFailures, unknowns, plainSteel, price: typeof price === 'number' ? price : null };
}
