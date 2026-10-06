import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Concierge } from '../src/Concierge';

vi.mock('../src/concierge/ConnectedConcierge', () => ({ ConnectedConcierge: () => null }));

it('always offers the Concierge launcher without an environment health gate', () => {
  const html = renderToStaticMarkup(<Concierge />);
  expect(html).toContain('Open jewelry Concierge');
  expect(html).toContain('Ask Concierge');
  expect(html).not.toContain('Concierge unavailable');
  expect(html).not.toContain('concierge-panel');
  expect(html).not.toContain('<input');
});
