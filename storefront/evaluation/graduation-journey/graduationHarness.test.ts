import { describe, expect, it } from 'vitest';
import { safeId, sameIds } from './graduationHarness';

describe('graduation browser identity helpers', () => {
  it('preserves valid dotted catalogue IDs without accepting selector syntax', () => {
    expect(safeId('ABC.123-4')).toBe('ABC.123-4');
    expect(() => safeId('abc"] button')).toThrow('Unsafe product ID');
  });

  it('compares exact distinct IDs independent of display order', () => {
    expect(sameIds(['necklace-a', 'earrings-b'], ['earrings-b', 'necklace-a'])).toBe(true);
    expect(sameIds(['necklace-a', 'necklace-a'], ['necklace-a', 'earrings-b'])).toBe(false);
  });
});
