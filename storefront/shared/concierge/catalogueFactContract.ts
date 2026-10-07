export const SUPPORTED_FACET_ATTRIBUTES = {
  product_type: 'Catalog_ProductType',
  gemstone: 'Catalog_GemstoneInformation.GemstoneColorGroup',
  watch_dial_color: 'Catalog_WatchPrimaryDialPrimaryColor',
  watch_band_type: 'Catalog_WatchBandType',
} as const;
export const WATCH_BAND_MATERIAL_FAMILIES = ['metal'] as const;
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
export const MATERIAL_ALTERNATIVE_TYPES = ['Gold', 'Silver'] as const;
export const MATERIAL_ALTERNATIVE_COLORS = ['White'] as const;
export const MATERIAL_ALTERNATIVE_PURITIES = ['Sterling', '10K', '14K', '18K', '24K'] as const;
export const PRODUCT_TYPES = [
  'Ring',
  'Earrings',
  'Necklace',
  'Bracelet',
  'Pendant',
  'Wrist Watch',
] as const;
export const EXCLUSION_PRODUCT_TYPES = PRODUCT_TYPES;
export const EXCLUSION_MOTIFS = ['Heart'] as const;
export type SupportedFacetField = keyof typeof SUPPORTED_FACET_ATTRIBUTES;
export function facetAttributeForField(field: string) {
  return field === 'product_type'
    ? SUPPORTED_FACET_ATTRIBUTES.product_type
    : field === 'gemstone'
      ? SUPPORTED_FACET_ATTRIBUTES.gemstone
      : field === 'watch_dial_color'
        ? SUPPORTED_FACET_ATTRIBUTES.watch_dial_color
        : field === 'watch_band_type'
          ? SUPPORTED_FACET_ATTRIBUTES.watch_band_type
          : undefined;
}
