export const GA_MEASUREMENT_ID = 'G-GVSHHN3EJQ';

declare global {
  interface Window {
    gtag?: (
      command: 'event',
      eventName: 'concierge_open' | 'concierge_close',
      parameters: { send_to: string; widget_name: string },
    ) => void;
  }
}

/** Fixed UI events only; never pass shopper messages or preference data. */
export function trackConciergeVisibility(open: boolean): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  try {
    window.gtag('event', open ? 'concierge_open' : 'concierge_close', {
      send_to: GA_MEASUREMENT_ID,
      widget_name: 'jtv_concierge',
    });
  } catch {
    // Report an integration failure locally without interrupting the widget.
    if (import.meta.env.DEV)
      console.warn('jtv_analytics_event_failed', {
        event: open ? 'concierge_open' : 'concierge_close',
      });
  }
}
