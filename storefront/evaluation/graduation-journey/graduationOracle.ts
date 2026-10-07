export type GraduationCatalogRecord = Record<string, unknown>;
export type GraduationRole = 'necklace' | 'earrings';
export type GreenGemstoneClassification =
  | { status: 'known'; name: string; creationClassification: 'Natural' | 'Lab Created' }
  | { status: 'unknown' };

const DEFAULT_BUDGET_CENTS = 30_000;

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function strings(value: unknown): string[] {
  return values(value).map(normalized).filter(Boolean);
}

function objectEntries(value: unknown): GraduationCatalogRecord[] {
  return values(value).filter(
    (entry): entry is GraduationCatalogRecord =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
}

export function cents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid catalogue price');
  return Math.round(value * 100);
}

function hasSterlingSilver(record: GraduationCatalogRecord): boolean {
  const materials = objectEntries(record.Catalog_MaterialInformation);
  if (!materials.length) return false;
  return materials.every((material) => {
    const type = normalized(material.MaterialType);
    const purity = normalized(material.MaterialPurity);
    const color = normalized(material.MaterialColor);
    return (
      type === 'silver' && purity === 'sterling' && (color === 'white' || color.includes('silver'))
    );
  });
}

function materialEvidenceMissing(record: GraduationCatalogRecord): boolean {
  const materials = objectEntries(record.Catalog_MaterialInformation);
  return (
    materials.length === 0 ||
    materials.some(
      (material) =>
        !normalized(material.MaterialType) ||
        !normalized(material.MaterialPurity) ||
        !normalized(material.MaterialColor),
    )
  );
}

function hasGoldColoredFinish(record: GraduationCatalogRecord): boolean {
  const materials = objectEntries(record.Catalog_MaterialInformation);
  const materialColors = materials.map((entry) => normalized(entry.MaterialColor));
  const navigationColors = strings(record.Catalog_JewelryMaterialNavigationColor);
  const goldMaterialEvidence = materials.some(
    (entry) =>
      normalized(entry.MaterialType).includes('gold') ||
      /^\d+\s*k$/i.test(normalized(entry.MaterialPlatingPurity)),
  );
  const textEvidence = [record.Catalog_TitleDescription, record.Catalog_LongDescription]
    .filter((value): value is string => typeof value === 'string')
    .map(normalized);
  return (
    goldMaterialEvidence ||
    [...materialColors, ...navigationColors].some(
      (color) => color.includes('gold') || color === 'yellow' || color === 'rose',
    ) ||
    textEvidence.some((description) =>
      /\b(?:gold|yellow\s+gold|rose\s+gold|gold[- ]colou?red)\b/.test(description),
    )
  );
}

function hasGraduationCapMotif(record: GraduationCatalogRecord): boolean {
  const explicitMotif = strings(record.Catalog_Motif).some((motif) =>
    /\bgraduation\s+cap\b|\bcap\s+and\s+gown\b/.test(motif),
  );
  const descriptions = [record.Catalog_TitleDescription, record.Catalog_LongDescription]
    .filter((value): value is string => typeof value === 'string')
    .map(normalized);
  return (
    explicitMotif ||
    descriptions.some((description) =>
      /\bgraduation\s+cap\b|\bcap\s+and\s+gown\b/.test(description),
    )
  );
}

function greenDetail(record: GraduationCatalogRecord): boolean | null {
  const gemstoneEntries = objectEntries(record.Catalog_GemstoneInformationPrimary);
  const gemstoneColors = gemstoneEntries.flatMap((entry) => [
    normalized(entry.GemstoneColor),
    normalized(entry.GemstoneColorGroup),
  ]);
  const materialColors = objectEntries(record.Catalog_MaterialInformation).map((entry) =>
    normalized(entry.MaterialColor),
  );
  const colors = [
    ...gemstoneColors,
    ...materialColors,
    ...strings(record.Catalog_JewelryMaterialNavigationColor),
  ].filter(Boolean);
  if (!colors.length) return null;
  return colors.some((color) => color.includes('green'));
}

function studType(record: GraduationCatalogRecord): boolean | null {
  const types = strings(record.Catalog_EarringType);
  if (!types.length) return null;
  return types.includes('stud');
}

/** Checks one exact catalogue record against the graduation journey's hard constraints. */
export function assessGraduationProduct(
  record: GraduationCatalogRecord,
  role: GraduationRole,
  budgetCents = DEFAULT_BUDGET_CENTS,
) {
  const hardFailures: string[] = [];
  const unknowns: string[] = [];
  const expectedType = role === 'necklace' ? 'necklace' : 'earrings';
  if (normalized(record.Catalog_ProductType) !== expectedType) hardFailures.push('product-type');
  if (!hasSterlingSilver(record)) {
    (materialEvidenceMissing(record) ? unknowns : hardFailures).push('material');
  }
  if (hasGoldColoredFinish(record)) hardFailures.push('gold-colored-finish');
  if (normalized(record.Catalog_Condition) !== 'first quality') {
    (record.Catalog_Condition == null ? unknowns : hardFailures).push('condition');
  }
  if (record.Catalog_PreviouslyOwned !== false) {
    (record.Catalog_PreviouslyOwned == null ? unknowns : hardFailures).push('previously-owned');
  }
  if (record.Inventory_InStock !== true) {
    (record.Inventory_InStock == null ? unknowns : hardFailures).push('not-in-stock');
  }
  if (record.Catalog_Motif == null) unknowns.push('motif');
  if (hasGraduationCapMotif(record)) hardFailures.push('graduation-cap-motif');

  const price = record.Pricing_ActivePrice;
  let priceCents: number | null = null;
  if (typeof price !== 'number' || !Number.isFinite(price)) unknowns.push('price');
  else {
    priceCents = cents(price);
    if (priceCents > budgetCents) hardFailures.push('over-budget');
  }

  const stud = role === 'earrings' ? studType(record) : null;
  if (role === 'earrings' && stud === null) unknowns.push('earring-type');
  return { hardFailures, unknowns, greenDetail: greenDetail(record), stud, priceCents };
}

/** Adds exact catalogue prices using integer cents against the firm $300 total ceiling. */
export function totalWithinGraduationBudget(prices: number[], budgetCents = DEFAULT_BUDGET_CENTS) {
  const totalCents = prices.reduce((total, price) => total + cents(price), 0);
  return { totalCents, withinBudget: totalCents <= budgetCents };
}

/** Classifies one unambiguous green primary gemstone from its exact catalogue fields. */
export function classifyGreenPrimaryGemstone(
  record: GraduationCatalogRecord,
): GreenGemstoneClassification {
  const [gemstone, ...additional] = objectEntries(record.Catalog_GemstoneInformationPrimary);
  if (additional.length || !gemstone) return { status: 'unknown' };

  const name = typeof gemstone.GemstoneName === 'string' ? gemstone.GemstoneName.trim() : '';
  const colorGroup = normalized(gemstone.GemstoneColorGroup);
  const classification = normalized(gemstone.GemstoneCreationClassification);
  if (!name || colorGroup !== 'green') return { status: 'unknown' };
  if (classification === 'natural') {
    return { status: 'known', name, creationClassification: 'Natural' };
  }
  if (classification === 'lab created') {
    return { status: 'known', name, creationClassification: 'Lab Created' };
  }
  return { status: 'unknown' };
}

/** Fails closed because current catalogue shapes do not expose an explicit paired-set relation. */
export function hasExplicitMatchingSetClaim(_record: GraduationCatalogRecord): boolean {
  void _record;
  return false;
}
