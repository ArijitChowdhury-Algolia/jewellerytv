import { describe, expect, it } from 'vitest';
import {
  assessBracelet,
  assessWatch,
  cents,
  chooseWatchDirections,
  hasFatherOpeningContext,
  sameProductIds,
  subtotalWithinBudget,
} from './fatherFullOracle';

const base = {
  objectID: 'watch-a',
  Catalog_ProductType: 'Wrist Watch',
  Catalog_Condition: 'First Quality',
  Catalog_PreviouslyOwned: false,
  Inventory_InStock: true,
  Pricing_ActivePrice: 161.09,
  Catalog_WatchPrimaryDialPrimaryColor: 'Cream',
  Catalog_WatchBandType: 'Strap',
  Catalog_BandMaterialInformation: [
    { WatchBandMaterialColor: 'Brown', WatchBandMaterialName: 'Leather' },
  ],
};

describe('Father full-journey record oracle', () => {
  it('finds real brown-leather and black-steel directions by fields, not title words', () => {
    const steel = {
      ...base,
      objectID: 'watch-b',
      Pricing_ActivePrice: 142.99,
      Catalog_WatchPrimaryDialPrimaryColor: 'Black',
      Catalog_WatchBandType: 'Bracelet',
      Catalog_BandMaterialInformation: [
        { WatchBandMaterialColor: 'White', WatchBandMaterialName: 'Stainless Steel' },
      ],
    };
    expect(chooseWatchDirections([base, steel], 350)).toEqual({
      leatherId: 'watch-a',
      steelId: 'watch-b',
    });
  });

  it('rejects pre-owned, unavailable and over-budget listings as gift candidates', () => {
    expect(assessWatch({ ...base, Catalog_PreviouslyOwned: true }, 350).hardFailures).toContain(
      'previously-owned',
    );
    expect(assessWatch({ ...base, Inventory_InStock: false }, 350).hardFailures).toContain(
      'not-in-stock',
    );
    expect(assessWatch({ ...base, Pricing_ActivePrice: 350.01 }, 350).hardFailures).toContain(
      'over-budget',
    );
  });

  it('keeps missing catalogue fields explicitly unknown', () => {
    const withoutOwnership: Record<string, unknown> = { ...base };
    delete withoutOwnership.Catalog_PreviouslyOwned;
    expect(assessWatch(withoutOwnership, 350).unknowns).toContain('previously-owned');
  });

  it('uses integer cents for a watch plus optional bracelet total', () => {
    expect(cents(161.09)).toBe(16109);
    expect(subtotalWithinBudget([161.09, 188.91], 350)).toEqual({
      cents: 35000,
      withinBudget: true,
    });
    expect(subtotalWithinBudget([161.09, 188.92], 350)).toEqual({
      cents: 35001,
      withinBudget: false,
    });
  });

  it('does not count a duplicated product ID as a two-item comparison', () => {
    expect(sameProductIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameProductIds(['a', 'a'], ['a', 'b'])).toBe(false);
  });

  it('requires active recipient and occasion facts before the Father story continues', () => {
    const state = {
      brief: {
        facts: [
          {
            field: 'recipient',
            status: 'active',
            certainty: 'explicit',
            value: { kind: 'text', text: 'Dad' },
          },
          {
            field: 'occasion',
            status: 'active',
            certainty: 'explicit',
            value: { kind: 'text', text: "Father's Day" },
          },
        ],
      },
    };
    expect(hasFatherOpeningContext(state)).toBe(true);
    expect(hasFatherOpeningContext({ brief: { facts: [] } })).toBe(false);
  });

  it('accepts only a verified plain steel bracelet for the optional companion', () => {
    const bracelet = {
      ...base,
      Catalog_ProductType: 'Bracelet',
      Catalog_JewelryMaterialAggregateFullName: 'Stainless Steel',
      Catalog_JewelryGemMaterialStatus: 'Contains No Gem Material',
    };
    expect(assessBracelet(bracelet).plainSteel).toBe(true);
    expect(
      assessBracelet({ ...bracelet, Catalog_JewelryMaterialAggregateFullName: 'Yellow Gold' })
        .plainSteel,
    ).toBe(false);
    expect(
      assessBracelet({ ...bracelet, Catalog_JewelryGemMaterialStatus: 'Contains Gem Material' })
        .plainSteel,
    ).toBe(false);
  });
});
