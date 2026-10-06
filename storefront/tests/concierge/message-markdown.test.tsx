import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import { ConversationMessage } from '../../src/concierge/ConnectedConcierge';

function assistant(text: string): UIMessage {
  return { id: 'answer', role: 'assistant', parts: [{ type: 'text', text }] };
}

describe('connected conversation rendering', () => {
  it('renders assistant emphasis, lists and safe links instead of raw Markdown markers', () => {
    const html = renderToStaticMarkup(
      <ConversationMessage
        message={assistant('**Two choices**\n\n- A simple chain\n- A bolder chain\n\n[Read more](https://example.com/guide)')}
        revealed
      />,
    );
    expect(html).toContain('<strong>Two choices</strong>');
    expect(html).toContain('<li>A simple chain</li>');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('**Two choices**');
  });
  it('does not execute raw HTML from agent text', () => {
    const html = renderToStaticMarkup(
      <ConversationMessage message={assistant('<script>alert(1)</script>')} revealed />,
    );
    expect(html).not.toContain('<script>');
  });
});
