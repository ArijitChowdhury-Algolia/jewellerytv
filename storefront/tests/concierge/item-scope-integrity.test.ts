import { describe, expect, it, vi } from 'vitest';
import { createEvidenceRetriever } from '../../server/concierge/retrieveEvidence.js';
import { createBriefState } from '../../shared/briefState.js';
import {
  updateShoppingState as updateShoppingStateBase,
} from '../../shared/concierge/state/updateShoppingState.js';

/* No-paid state-to-retrieval contract scenarios: a differently cased budget key is
 * rejected without altering a live product scope; the exact corrected key compiles
 * its bound price constraint; search remains a mock and no catalogue is written. */

// Fixture live vocabulary: the writer validates catalogue values against the
// vocabulary the client supplies in production (/api/catalog-vocabulary).
const fixtureVocabulary = {
  values: {
    'Catalog_ProductType': ['Necklace', 'Ring'],
  } as Record<string, string[]>,
  builtAt: '2026-10-09T00:00:00.000Z',
  hasValue: (attribute: string, value: string) =>
    (fixtureVocabulary.values[attribute] ?? []).includes(value),
  availableValues: (attribute: string) => fixtureVocabulary.values[attribute] ?? [],
  isFilterable: (attribute: string) => attribute in fixtureVocabulary.values,
};
const updateShoppingState = (
  state: Parameters<typeof updateShoppingStateBase>[0],
  input: Parameters<typeof updateShoppingStateBase>[1],
  message: { id: string; text: string },
) => updateShoppingStateBase(state, input, message, fixtureVocabulary);

describe('item scope integrity across state and evidence', () => {
  it('requires a corrected exact key before a budget can participate in retrieval', async () => {
    const message = { id: 'm-vg320p', text: 'Please show VG320P for under $500.' };
    const initial = { brief: createBriefState('mission-1'), receipts: [] };
    const productType = {
      action: 'add',
      factIds: [],
      fact: {
        id: 'product-type',
        field: 'product_type',
        value: {
          kind: 'facet',
          attribute: 'Catalog_ProductType',
          values: ['Necklace'],
          operator: 'any',
        },
        scope: { kind: 'item', key: 'necklace-vg320p' },
        strength: 'requirement',
        certainty: 'explicit',
      },
      sourceQuote: 'VG320P',
    };
    const budget = (key: string) => ({
      action: 'add',
      factIds: [],
      fact: {
        id: 'budget-500',
        field: 'budget',
        value: {
          kind: 'money',
          cents: 50000,
          currency: 'USD',
          operator: 'lte',
          basis: 'per_item',
        },
        scope: { kind: 'item', key },
        strength: 'requirement',
        certainty: 'explicit',
      },
      sourceQuote: '$500',
    });
    const input = (revision: number, operationId: string, operations: unknown[]) => ({
      missionId: 'mission-1',
      expectedRevision: revision,
      operationId,
      sourceMessageId: message.id,
      operations,
    });

    const accepted = await updateShoppingState(initial, input(0, 'type', [productType]), message);
    expect(accepted.result.status).toBe('applied');
    const rejected = await updateShoppingState(
      accepted.state,
      input(1, 'drifted-budget', [budget('necklace-vg320P')]),
      message,
    );
    expect(rejected.result.failure?.code).toBe('ITEM_SCOPE_KEY_COLLISION');
    expect(rejected.state).toBe(accepted.state);

    const corrected = await updateShoppingState(
      accepted.state,
      input(1, 'exact-budget', [budget('necklace-vg320p')]),
      message,
    );
    expect(corrected.result.status).toBe('applied');
    const correctedBrief = corrected.state.brief;
    if (correctedBrief.version !== 3) throw new Error('Expected migrated v3 brief');
    const search = vi.fn().mockResolvedValue([]);
    const retrieve = createEvidenceRetriever({
      search,
      currentState: async () => correctedBrief,
    });
    const result = await retrieve({
      source: 'prod_catalog',
      query: 'VG320P',
      count: 1,
      missionId: 'mission-1',
      expectedRevision: 2,
      turnId: 'turn-vg320p',
      target: { kind: 'item', itemKey: 'necklace-vg320p', productType: 'Necklace' },
    });
    expect(result.status).toBe('zero_hits');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].filters).toContainEqual({
      field: 'Pricing_ActivePrice',
      operator: 'lte',
      value: 500,
    });
  });
});
