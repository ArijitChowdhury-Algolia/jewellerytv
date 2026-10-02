import { z } from 'zod';

const scalar = z.union([z.string(), z.number()]);
const optionalList = z.union([scalar, z.array(scalar)]).nullish();
const recordSchema = z.object({
  objectID: z.string().trim().min(1),
  Catalog_ProductNumber: z.string().nullish(),
  Catalog_TitleDescription: z.string().nullish(),
  Catalog_LongDescription: z.string().nullish(),
  Media_Images: z.array(z.string()).nullish(),
  Pricing_ActivePrice: z.number().finite().nonnegative().nullish(),
  Inventory_AvailableSkuSizes: optionalList,
  Inventory_AvailableSkuSizeNames: optionalList,
  Inventory_InStock: z.boolean().nullish(),
  Ratings_AverageRating: z.number().min(0).max(5).nullish(),
}).passthrough();
export type CatalogueRecord = z.infer<typeof recordSchema>;
export interface Product {
  id: string; familyId: string | null; title: string; images: string[];
  price: number | null; priceLabel: string | null; referencePrice: number | null;
  referenceLabel: string | null; rating: number | null; ratingCount: number | null;
  sizes: {value: string; label: string}[]; inStock: boolean | null;
  brand: string | null; description: string | null;
  attributes: {label: string; value: string}[]; raw: CatalogueRecord;
}
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String).filter(Boolean);
const first = (value: unknown): string | null => strings(value)[0] ?? null;
function nested(record: CatalogueRecord, field: string): unknown {
 const [head, ...tail] = field.split('.');
 const value = record[head];
 if (!tail.length) return value;
 const parts = Array.isArray(value) ? value : [value];
 return parts.flatMap(part => part && typeof part === 'object' ? strings((part as Record<string, unknown>)[tail.join('.')]) : []);
}
const attributeFields = [
 ['Product type','Catalog_ProductType'],['Material','Catalog_JewelryMaterialNavigationName'],['Material purity','Catalog_JewelryMaterialNavigationPurity'],['Material color','Catalog_JewelryMaterialNavigationColor'],['Plating purity','Catalog_MaterialInformation.MaterialPlatingPurity'],['Style','Catalog_StyleOptionTag'],['Primary gemstone','Catalog_GemstoneInformationPrimary.GemstoneName'],['Gemstone composition','Catalog_GemstoneInformationPrimary.GemstoneCreationClassification'],['Primary gemstone carat range','Catalog_GemstoneInformationPrimary.GemstoneCTW'],['Gemstone shape','Catalog_GemstoneInformationPrimary.GemstoneShape'],['Gemstone dimensions','Catalog_GemstoneInformationPrimary.GemstoneCalibratedDimensions'],['Pearl','Catalog_PearlInformationPrimary.PearlFullName'],['Movement','Catalog_MovementType'],['Water resistance','Catalog_WaterResistanceRating'],['Band material','Catalog_WatchBandMaterialName'],['Department','Catalog_TargetConsumer'],
] as const;
export function normalizeProduct(input: unknown): Product {
 const raw = recordSchema.parse(input);
 const sizes = strings(raw.Inventory_AvailableSkuSizes);
 const names = strings(raw.Inventory_AvailableSkuSizeNames);
 return {
  id: raw.objectID, familyId: raw.Catalog_ProductNumber ?? null,
  title: raw.Catalog_TitleDescription || raw.objectID,
  images: (raw.Media_Images ?? []).filter(value => { try {return new URL(value).protocol === 'https:';} catch {return false;} }),
  price: raw.Pricing_ActivePrice ?? null, priceLabel: first(raw.Pricing_PriceLabelName),
  // No verified reference-price or review-count field is present in the captured schema.
  referencePrice: null, referenceLabel: null, rating: raw.Ratings_AverageRating ?? null, ratingCount: null,
  sizes: sizes.map(value => ({value,label:names.find(name=>name===value || name.replace(/^Size\s+/i,'').replace(/\s+(?:inch(?:es)?|mm|cm)$/i,'')===value) ?? value})),
  inStock: raw.Inventory_InStock ?? null, brand: first(raw.Catalog_BrandNavigationName) ?? first(raw.Catalog_Brand),
  description: raw.Catalog_LongDescription ?? null,
  attributes: attributeFields.flatMap(([label, field])=> {const value=[...new Set(strings(nested(raw,field)))].join(', ');return value?[{label,value}]:[];}), raw,
 };
}
