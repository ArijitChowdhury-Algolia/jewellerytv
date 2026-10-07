import { describe, expect, it } from 'vitest';
import {
  assessGraduationProduct,
  cents,
  classifyGreenPrimaryGemstone,
  hasExplicitMatchingSetClaim,
  totalWithinGraduationBudget,
} from './graduationOracle';

const necklace = {
  objectID: 'necklace-a',
  Catalog_ProductType: 'Necklace',
  Catalog_Condition: 'First Quality',
  Catalog_PreviouslyOwned: false,
  Inventory_InStock: true,
  Pricing_ActivePrice: 129.99,
  Catalog_JewelryMaterialNavigationName: ['Silver'],
  Catalog_JewelryMaterialNavigationPurity: ['Sterling'],
  Catalog_MaterialInformation: [
    { MaterialType: 'Silver', MaterialPurity: 'Sterling', MaterialColor: 'White' },
  ],
  Catalog_GemstoneInformationPrimary: [{ GemstoneColorGroup: 'Green' }],
  Catalog_Motif: ['Floral'],
};

describe('graduation journey record oracle', () => {
  it('classifies a qualifying sterling silver necklace with a green detail', () => {
    expect(assessGraduationProduct(necklace, 'necklace')).toMatchObject({
      hardFailures: [],
      unknowns: [],
      greenDetail: true,
      stud: null,
      priceCents: 12999,
    });
  });

  it('requires exact sterling composition, first quality, listed stock and not pre-owned', () => {
    const altered = {
      ...necklace,
      Catalog_JewelryMaterialNavigationPurity: ['Silver Plated'],
      Catalog_MaterialInformation: [
        { MaterialType: 'Silver', MaterialPurity: 'Silver Plated', MaterialColor: 'White' },
      ],
      Catalog_Condition: 'Pre-Owned',
      Catalog_PreviouslyOwned: true,
      Inventory_InStock: false,
    };
    expect(assessGraduationProduct(altered, 'necklace').hardFailures).toEqual(
      expect.arrayContaining(['material', 'condition', 'previously-owned', 'not-in-stock']),
    );
  });

  it('rejects gold-over-sterling records even when silver and sterling facets match', () => {
    const goldOverSterling = {
      ...necklace,
      Catalog_TitleDescription: '18K Yellow Gold Over Sterling Silver Pendant',
      Catalog_MaterialInformation: [
        {
          MaterialType: 'Silver',
          MaterialPurity: 'Sterling',
          MaterialColor: 'Yellow',
          MaterialPlatingPurity: '18K',
        },
      ],
    };
    expect(assessGraduationProduct(goldOverSterling, 'necklace').hardFailures).toContain(
      'gold-colored-finish',
    );
  });

  it('rejects mixed metals or plated entries despite a separate qualifying sterling entry', () => {
    const mixedMetal = {
      ...necklace,
      Catalog_MaterialInformation: [
        { MaterialType: 'Silver', MaterialPurity: 'Sterling', MaterialColor: 'White' },
        { MaterialType: 'Gold', MaterialPurity: '14K', MaterialColor: 'Yellow' },
      ],
    };
    const plated = {
      ...necklace,
      Catalog_MaterialInformation: [
        {
          MaterialType: 'Silver',
          MaterialPurity: 'Sterling',
          MaterialColor: 'White',
          MaterialPlatingPurity: '18K',
        },
      ],
    };
    expect(assessGraduationProduct(mixedMetal, 'necklace').hardFailures).toEqual(
      expect.arrayContaining(['material', 'gold-colored-finish']),
    );
    expect(assessGraduationProduct(plated, 'necklace').hardFailures).toContain(
      'gold-colored-finish',
    );
  });

  it('keeps missing material details unknown', () => {
    expect(
      assessGraduationProduct(
        {
          ...necklace,
          Catalog_MaterialInformation: [{ MaterialType: 'Silver', MaterialPurity: 'Sterling' }],
        },
        'necklace',
      ).unknowns,
    ).toContain('material');
  });

  it('keeps missing evidence unknown and treats a cap motif as a hard exclusion', () => {
    const missing: Record<string, unknown> = { ...necklace };
    delete missing.Catalog_Condition;
    delete missing.Catalog_PreviouslyOwned;
    delete missing.Inventory_InStock;
    delete missing.Catalog_Motif;
    expect(assessGraduationProduct(missing, 'necklace').unknowns).toEqual(
      expect.arrayContaining(['condition', 'previously-owned', 'not-in-stock', 'motif']),
    );
    expect(
      assessGraduationProduct({ ...necklace, Catalog_Motif: ['Graduation Cap'] }, 'necklace')
        .hardFailures,
    ).toContain('graduation-cap-motif');
    expect(
      assessGraduationProduct(
        { ...necklace, Catalog_Motif: [], Catalog_LongDescription: 'Graduation cap pendant' },
        'necklace',
      ).hardFailures,
    ).toContain('graduation-cap-motif');
  });

  it('recognizes earrings and only identifies studs from an explicit earring type', () => {
    const studs = {
      ...necklace,
      Catalog_ProductType: 'Earrings',
      Catalog_EarringType: ['Stud'],
      Catalog_GemstoneInformationPrimary: [{ GemstoneColorGroup: 'Green' }],
    };
    expect(assessGraduationProduct(studs, 'earrings')).toMatchObject({
      hardFailures: [],
      greenDetail: true,
      stud: true,
    });
    expect(
      assessGraduationProduct({ ...studs, Catalog_EarringType: ['Drop'] }, 'earrings').stud,
    ).toBe(false);
    expect(
      assessGraduationProduct({ ...studs, Catalog_EarringType: undefined }, 'earrings').stud,
    ).toBeNull();
  });

  it('uses integer cents for a firm combined $300 ceiling', () => {
    expect(cents(129.99)).toBe(12999);
    expect(totalWithinGraduationBudget([129.99, 170.01])).toEqual({
      totalCents: 30000,
      withinBudget: true,
    });
    expect(totalWithinGraduationBudget([129.99, 170.02])).toEqual({
      totalCents: 30001,
      withinBudget: false,
    });
  });

  it('allows a matching-set claim only when the exact record says so', () => {
    expect(hasExplicitMatchingSetClaim(necklace)).toBe(false);
    expect(
      hasExplicitMatchingSetClaim({ ...necklace, Catalog_TitleDescription: 'Matching Set' }),
    ).toBe(false);
    expect(hasExplicitMatchingSetClaim({ ...necklace, Catalog_NecklaceType: ['Set'] })).toBe(false);
  });

  it('classifies exact natural and lab-created green primary gemstones by their records', () => {
    expect(
      classifyGreenPrimaryGemstone({
        Catalog_GemstoneInformationPrimary: [
          {
            GemstoneName: 'Tourmaline',
            GemstoneColorGroup: 'Green',
            GemstoneCreationClassification: 'Natural',
          },
        ],
      }),
    ).toEqual({ status: 'known', name: 'Tourmaline', creationClassification: 'Natural' });
    expect(
      classifyGreenPrimaryGemstone({
        Catalog_GemstoneInformationPrimary: [
          {
            GemstoneName: 'Cubic Zirconia',
            GemstoneColorGroup: 'Green',
            GemstoneCreationClassification: 'Lab Created',
          },
        ],
      }),
    ).toEqual({ status: 'known', name: 'Cubic Zirconia', creationClassification: 'Lab Created' });
  });

  it('returns unknown for missing, unsupported or mixed primary gemstone evidence', () => {
    expect(classifyGreenPrimaryGemstone({})).toEqual({ status: 'unknown' });
    expect(
      classifyGreenPrimaryGemstone({
        Catalog_GemstoneInformationPrimary: [
          { GemstoneName: 'Tourmaline', GemstoneColorGroup: 'Green' },
        ],
      }),
    ).toEqual({ status: 'unknown' });
    expect(
      classifyGreenPrimaryGemstone({
        Catalog_GemstoneInformationPrimary: [
          {
            GemstoneName: 'Tourmaline',
            GemstoneColorGroup: 'Green',
            GemstoneCreationClassification: 'Natural',
          },
          {
            GemstoneName: 'Cubic Zirconia',
            GemstoneColorGroup: 'Green',
            GemstoneCreationClassification: 'Lab Created',
          },
        ],
      }),
    ).toEqual({ status: 'unknown' });
  });
});
