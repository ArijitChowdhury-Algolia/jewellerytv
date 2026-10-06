import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import {
  ConversationMessage,
  parseVerifiedProductLink,
} from '../../src/concierge/ConnectedConcierge';

const assistant = (text: string) => ({
  id: 'assistant-1',
  role: 'assistant' as const,
  parts: [{ type: 'text', text, state: 'done' as const }],
});

describe('Concierge product identity links', () => {
  it('renders an explicit PDP href safely and keeps normal target behavior', () => {
    const html = renderToStaticMarkup(
      <ConversationMessage
        message={assistant('[Piece](/product/Ring%2FBlue)') as unknown as UIMessage}
        revealed
      />,
    );
    expect(html).toContain('href="/product/Ring%2FBlue"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('focuses only exact known verified IDs and rejects fuzzy or mismatched links', () => {
    const known = new Set(['ring-1']);
    const verified = new Set(['ring-1']);
    expect(parseVerifiedProductLink('/product/ring-1', known, verified)).toBe('ring-1');
    expect(parseVerifiedProductLink('/product/ring-10', known, verified)).toBeNull();
    expect(parseVerifiedProductLink('/product/ring-1', new Set(), verified)).toBeNull();
    expect(parseVerifiedProductLink('/product/ring-1?extra=1', known, verified)).toBeNull();
  });
});
