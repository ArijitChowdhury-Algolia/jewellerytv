import { afterEach, describe, expect, it, vi } from 'vitest';
import { GA_MEASUREMENT_ID, trackConciergeVisibility } from '../src/analytics';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Concierge Google Analytics visibility', () => {
  it('is safe without a browser window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => trackConciergeVisibility(true)).not.toThrow();
  });
  it('sends fixed events to the provided property without shopper data', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', {
      gtag,
      location: { search: '?q=private-shopper-text' },
    });
    trackConciergeVisibility(true);
    trackConciergeVisibility(false);
    expect(gtag.mock.calls).toEqual([
      ['event', 'concierge_open', { send_to: GA_MEASUREMENT_ID, widget_name: 'jtv_concierge' }],
      ['event', 'concierge_close', { send_to: GA_MEASUREMENT_ID, widget_name: 'jtv_concierge' }],
    ]);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('private-shopper-text');
  });

  it('does not prevent widget operation when the tag is unavailable', () => {
    vi.stubGlobal('window', {});
    expect(() => trackConciergeVisibility(true)).not.toThrow();
  });

  it('does not prevent widget operation when analytics throws', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', {
      gtag: () => {
        throw new Error('analytics blocked');
      },
    });
    expect(() => trackConciergeVisibility(false)).not.toThrow();
    expect(warning).toHaveBeenCalledWith('jtv_analytics_event_failed', {
      event: 'concierge_close',
    });
  });
});
