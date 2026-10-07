import { describe, expect, it } from 'vitest';
import {
  activeExclusionText,
  hasActiveContext,
  hasSterlingRequirement,
  hasTotalBudget,
} from './graduationBriefOracle';

const material = {
  field: 'material',
  status: 'active',
  strength: 'requirement',
  certainty: 'explicit',
  scope: { kind: 'mission' },
  value: { kind: 'material_alternatives', alternatives: [{ type: 'Silver', purity: 'Sterling' }] },
};
const budget = {
  field: 'budget',
  status: 'active',
  strength: 'requirement',
  certainty: 'explicit',
  scope: { kind: 'mission' },
  value: { kind: 'money', cents: 30000, currency: 'USD', operator: 'lte', basis: 'total' },
};

describe('graduation active brief oracle', () => {
  it('requires explicit active mission-scoped sterling and total USD budget facts', () => {
    const state = { brief: { facts: [material, budget] } };
    expect(hasSterlingRequirement(state)).toBe(true);
    expect(hasTotalBudget(state)).toBe(true);
  });

  it('rejects tentative, superseded, preference, item-scoped or wrong-currency facts', () => {
    expect(
      hasSterlingRequirement({ brief: { facts: [{ ...material, status: 'tentative' }] } }),
    ).toBe(false);
    expect(
      hasSterlingRequirement({ brief: { facts: [{ ...material, strength: 'preference' }] } }),
    ).toBe(false);
    expect(hasTotalBudget({ brief: { facts: [{ ...budget, status: 'superseded' }] } })).toBe(false);
    expect(hasTotalBudget({ brief: { facts: [{ ...budget, scope: { kind: 'item' } }] } })).toBe(
      false,
    );
    expect(
      hasTotalBudget({
        brief: { facts: [{ ...budget, value: { ...budget.value, currency: 'EUR' } }] },
      }),
    ).toBe(false);
  });

  it('collects only active explicit exclusions for review', () => {
    const exclusion = {
      ...material,
      field: 'exclusion',
      value: { kind: 'text', text: 'no graduation caps or gold-coloured finish' },
    };
    expect(
      activeExclusionText({ brief: { facts: [exclusion, { ...exclusion, status: 'retracted' }] } }),
    ).toContain('graduation caps');
  });

  it('requires active recipient and occasion context from the opening turn', () => {
    const state = {
      brief: {
        facts: [
          {
            field: 'recipient',
            status: 'active',
            certainty: 'explicit',
            value: { kind: 'text', text: 'my daughter' },
          },
          {
            field: 'occasion',
            status: 'active',
            certainty: 'explicit',
            value: { kind: 'text', text: 'graduation' },
          },
        ],
      },
    };
    expect(hasActiveContext(state, 'recipient', /daughter/i)).toBe(true);
    expect(hasActiveContext(state, 'occasion', /graduat/i)).toBe(true);
    expect(hasActiveContext({ brief: { facts: [] } }, 'recipient', /daughter/i)).toBe(false);
  });
});
