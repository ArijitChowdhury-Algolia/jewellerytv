export interface FacetDefinition { label: string; attribute: string; kind?: "price" | "size" | "list" }
export const facetsByCategory: Record<string,FacetDefinition[]> = {
  "rings": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Ring Type",
      "attribute": "Catalog_RingType",
      "kind": "list"
    },
    {
      "label": "Ring Size",
      "attribute": "Inventory_AvailableSkuSizes",
      "kind": "size"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Pearl Name",
      "attribute": "Catalog_PearlInformationPrimary.PearlFullName",
      "kind": "list"
    },
    {
      "label": "Gemstone and Pearl Color",
      "attribute": "Catalog_PrimaryGemstoneAndPearlColorGroups",
      "kind": "list"
    },
    {
      "label": "Gemstone Composition",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCreationClassification",
      "kind": "list"
    },
    {
      "label": "Gemstone Carat Weight",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCTW",
      "kind": "list"
    },
    {
      "label": "Featured Material",
      "attribute": "Catalog_OtherSettingMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Name",
      "attribute": "Catalog_JewelryMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Color",
      "attribute": "Catalog_JewelryMaterialNavigationColor",
      "kind": "list"
    },
    {
      "label": "Material Purity",
      "attribute": "Catalog_JewelryMaterialNavigationPurity",
      "kind": "list"
    },
    {
      "label": "Theme",
      "attribute": "Catalog_Theme",
      "kind": "list"
    },
    {
      "label": "Motif",
      "attribute": "Catalog_Motif",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    }
  ],
  "earrings": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Earring Type",
      "attribute": "Catalog_EarringType",
      "kind": "list"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Pearl Name",
      "attribute": "Catalog_PearlInformationPrimary.PearlFullName",
      "kind": "list"
    },
    {
      "label": "Gemstone and Pearl Color",
      "attribute": "Catalog_PrimaryGemstoneAndPearlColorGroups",
      "kind": "list"
    },
    {
      "label": "Gemstone Composition",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCreationClassification",
      "kind": "list"
    },
    {
      "label": "Gemstone Carat Weight",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCTW",
      "kind": "list"
    },
    {
      "label": "Featured Material",
      "attribute": "Catalog_OtherSettingMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Name",
      "attribute": "Catalog_JewelryMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Color",
      "attribute": "Catalog_JewelryMaterialNavigationColor",
      "kind": "list"
    },
    {
      "label": "Material Purity",
      "attribute": "Catalog_JewelryMaterialNavigationPurity",
      "kind": "list"
    },
    {
      "label": "Backing Type",
      "attribute": "Catalog_BackingType",
      "kind": "list"
    },
    {
      "label": "Link Type",
      "attribute": "Catalog_ChainLinkType",
      "kind": "list"
    },
    {
      "label": "Theme",
      "attribute": "Catalog_Theme",
      "kind": "list"
    },
    {
      "label": "Motif",
      "attribute": "Catalog_Motif",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    }
  ],
  "necklaces": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Necklace Type",
      "attribute": "Catalog_NecklaceType",
      "kind": "list"
    },
    {
      "label": "Pendant Type",
      "attribute": "Catalog_PendantType",
      "kind": "list"
    },
    {
      "label": "Chain Type",
      "attribute": "Catalog_ChainLinkType",
      "kind": "list"
    },
    {
      "label": "Necklace Length",
      "attribute": "Inventory_AvailableSkuSizeNames",
      "kind": "list"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Pearl Name",
      "attribute": "Catalog_PearlInformationPrimary.PearlFullName",
      "kind": "list"
    },
    {
      "label": "Gemstone and Pearl Color",
      "attribute": "Catalog_PrimaryGemstoneAndPearlColorGroups",
      "kind": "list"
    },
    {
      "label": "Gemstone Composition",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCreationClassification",
      "kind": "list"
    },
    {
      "label": "Featured Material",
      "attribute": "Catalog_OtherSettingMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Name",
      "attribute": "Catalog_JewelryMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Color",
      "attribute": "Catalog_JewelryMaterialNavigationColor",
      "kind": "list"
    },
    {
      "label": "Material Purity",
      "attribute": "Catalog_JewelryMaterialNavigationPurity",
      "kind": "list"
    },
    {
      "label": "Theme",
      "attribute": "Catalog_Theme",
      "kind": "list"
    },
    {
      "label": "Motif",
      "attribute": "Catalog_Motif",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    }
  ],
  "bracelets": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Bracelet Type",
      "attribute": "Catalog_BraceletType",
      "kind": "list"
    },
    {
      "label": "Bracelet Length",
      "attribute": "Inventory_AvailableSkuSizeNames",
      "kind": "list"
    },
    {
      "label": "Chain Type",
      "attribute": "Catalog_ChainLinkType",
      "kind": "list"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Pearl Name",
      "attribute": "Catalog_PearlInformationPrimary.PearlFullName",
      "kind": "list"
    },
    {
      "label": "Gemstone and Pearl Color",
      "attribute": "Catalog_PrimaryGemstoneAndPearlColorGroups",
      "kind": "list"
    },
    {
      "label": "Gemstone Composition",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCreationClassification",
      "kind": "list"
    },
    {
      "label": "Featured Material",
      "attribute": "Catalog_OtherSettingMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Name",
      "attribute": "Catalog_JewelryMaterialNavigationName",
      "kind": "list"
    },
    {
      "label": "Material Color",
      "attribute": "Catalog_JewelryMaterialNavigationColor",
      "kind": "list"
    },
    {
      "label": "Material Purity",
      "attribute": "Catalog_JewelryMaterialNavigationPurity",
      "kind": "list"
    },
    {
      "label": "Theme",
      "attribute": "Catalog_Theme",
      "kind": "list"
    },
    {
      "label": "Motif",
      "attribute": "Catalog_Motif",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    }
  ],
  "watches": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Product Type",
      "attribute": "Catalog_ProductType",
      "kind": "list"
    },
    {
      "label": "Watch Type",
      "attribute": "Catalog_WatchStyle",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Band Type",
      "attribute": "Catalog_WatchBandType",
      "kind": "list"
    },
    {
      "label": "Band Material Name",
      "attribute": "Catalog_WatchBandMaterialName",
      "kind": "list"
    },
    {
      "label": "Band Color",
      "attribute": "Catalog_WatchBandMaterialColorGroup",
      "kind": "list"
    },
    {
      "label": "Dial Color",
      "attribute": "Catalog_WatchPrimaryDialPrimaryColor",
      "kind": "list"
    },
    {
      "label": "Movement Complication",
      "attribute": "Catalog_MovementComplication",
      "kind": "list"
    },
    {
      "label": "Movement Type",
      "attribute": "Catalog_MovementType",
      "kind": "list"
    },
    {
      "label": "Case Shape",
      "attribute": "Catalog_WatchCaseShape",
      "kind": "list"
    },
    {
      "label": "Case Size",
      "attribute": "Catalog_WatchCaseSize",
      "kind": "list"
    },
    {
      "label": "Crystal Type",
      "attribute": "Catalog_WatchCrystalType",
      "kind": "list"
    },
    {
      "label": "Water Resistance Rating",
      "attribute": "Catalog_WaterResistanceRating",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Theme",
      "attribute": "Catalog_Theme",
      "kind": "list"
    }
  ],
  "loose-gemstones": [
    {
      "label": "Price",
      "attribute": "Pricing_PriceRange",
      "kind": "price"
    },
    {
      "label": "StretchPay",
      "attribute": "Financing_InstallmentBillingTermsName",
      "kind": "list"
    },
    {
      "label": "Brand",
      "attribute": "Catalog_BrandNavigationName",
      "kind": "list"
    },
    {
      "label": "Collection",
      "attribute": "Catalog_Collection",
      "kind": "list"
    },
    {
      "label": "Product Type",
      "attribute": "Catalog_ProductType",
      "kind": "list"
    },
    {
      "label": "Gemstone Name",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneName",
      "kind": "list"
    },
    {
      "label": "Gemstone and Pearl Color",
      "attribute": "Catalog_PrimaryGemstoneAndPearlColorGroups",
      "kind": "list"
    },
    {
      "label": "Gemstone Shape",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneShape",
      "kind": "list"
    },
    {
      "label": "Gemstone Dimensions",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCalibratedDimensions",
      "kind": "list"
    },
    {
      "label": "Gemstone Composition",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCreationClassification",
      "kind": "list"
    },
    {
      "label": "Carat Weight",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneCTW",
      "kind": "list"
    },
    {
      "label": "Mined In",
      "attribute": "Catalog_GemstoneInformationPrimary.GemstoneOriginCountry",
      "kind": "list"
    },
    {
      "label": "Department",
      "attribute": "Catalog_TargetConsumer",
      "kind": "list"
    }
  ]
};
export const allFacetAttributes = [...new Set(Object.values(facetsByCategory).flat().map(facet => facet.attribute))];
export const sortOptions = [
  {
    "label": "Relevance",
    "value": "prod_catalog"
  },
  {
    "label": "Featured",
    "value": "prod_catalog_featured"
  },
  {
    "label": "Newest",
    "value": "prod_catalog_newest"
  },
  {
    "label": "Top Rated",
    "value": "prod_catalog_top_rated"
  },
  {
    "label": "Price: Low to High",
    "value": "prod_catalog_price_asc"
  },
  {
    "label": "Price: High to Low",
    "value": "prod_catalog_price_desc"
  }
];
