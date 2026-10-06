import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Concierge, healthAllowsConcierge } from '../src/Concierge';

it('opens the configured Concierge in production as well as development', () => {
  expect(healthAllowsConcierge({ environment: 'production', conciergeConfigured: true })).toBe(
    true,
  );
  expect(healthAllowsConcierge({ environment: 'development', conciergeConfigured: true })).toBe(
    true,
  );
  expect(healthAllowsConcierge({ environment: 'production', conciergeConfigured: false })).toBe(
    false,
  );
});

it('starts closed so the local storefront stays accessible', () => {
  const html = renderToStaticMarkup(<Concierge />);
  expect(html).toContain('Open Concierge unavailable notice');
  expect(html).not.toContain('concierge-panel');
  expect(html).not.toContain('The local Concierge is unavailable');
  expect(html).not.toContain('<input');
  expect(html).toContain('Concierge unavailable');
});
