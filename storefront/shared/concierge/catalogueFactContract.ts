export const SUPPORTED_FACET_ATTRIBUTES = {
  product_type: 'Catalog_ProductType',
  gemstone: 'Catalog_GemstoneInformation.GemstoneColorGroup',
  watch_dial_color: 'Catalog_WatchPrimaryDialPrimaryColor',
  watch_band_type: 'Catalog_WatchBandType',
} as const;
export const WATCH_BAND_MATERIAL_FAMILIES = ['metal'] as const;
/** LEGACY fallback, used only when no live vocabulary reaches the compiler.
 * Delete alongside the no-vocabulary compiler path. */
export const METAL_WATCH_BAND_MATERIALS = [
  'Stainless Steel',
  'Titanium',
  'Sterling Silver',
  'Brass',
  'Aluminum',
  'Alloy',
  'Base Metal',
  '10K Gold',
  '14K Gold',
  '18K Gold Over Bronze',
] as const;
/** Catalog_MaterialInformation.MaterialColor is a nested, non-faceted attribute.
 * Its exclusion VALUES come from the live vocabulary
 * (Catalog_MaterialInformation.MaterialColor), never from a frozen copy. */
export const MATERIAL_COLOR_EXCLUSION_ATTRIBUTE =
  'Catalog_MaterialInformation.MaterialColor' as const;
export const EXCLUSION_MATERIAL_COLORS = [
  'Black',
  'Blue',
  'Brown',
  'Gray',
  'Green',
  'Multi-color',
  'No Color',
  'Orange',
  'Pink',
  'Purple',
  'Red',
  'Rose',
  'Tri-color',
  'Two-tone',
  'White',
  'Yellow',
] as const;
