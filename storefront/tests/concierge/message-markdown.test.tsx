import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIMessage } from 'instantsearch.js/es/lib/ai-lite';
import { ConversationMessage } from '../../src/concierge/ConnectedConcierge';
import { canonicalBlogUrlsFromMessages } from '../../src/concierge/verifiedBlogLinks';

function assistant(text: string): UIMessage {
  return { id: 'answer', role: 'assistant', parts: [{ type: 'text', text }] };
}

function sourcedBlogAnswer(text: string, canonicalUrl: string): UIMessage {
  return {
    id: 'answer',
    role: 'assistant',
    parts: [
      {
        type: 'tool-retrieve_evidence',
        toolCallId: 'blog-call',
        state: 'output-available',
        input: {},
        output: {
          status: 'ok',
          source: 'blog',
          records: [
            {
              source: 'blog',
              objectID: 'sapphire-guide',
              contentHash: 'verified-content-hash',
              record: { canonical_url: canonicalUrl },
            },
          ],
        },
      },
      { type: 'text', text },
    ] as UIMessage['parts'],
  };
}

describe('connected conversation rendering', () => {
  it('renders assistant emphasis, lists and a retrieved canonical blog link', () => {
    const url = 'https://www.jtv.com/blog/sapphire-guide';
    const message = sourcedBlogAnswer(
      `**Two choices**\n\n- A simple chain\n- A bolder chain\n\n[Read JTV’s sapphire guide](${url})`,
      url,
    );
    const html = renderToStaticMarkup(
      <ConversationMessage
        message={message}
        revealed
        verifiedBlogUrls={canonicalBlogUrlsFromMessages([message])}
      />,
    );
    expect(html).toContain('<strong>Two choices</strong>');
    expect(html).toContain('<li>A simple chain</li>');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('**Two choices**');
  });
  it('keeps an unverified or non-JTV blog destination as plain text', () => {
    const message = sourcedBlogAnswer(
      '[Read JTV’s sapphire guide](https://example.com/sapphire-guide)',
      'https://www.jtv.com/blog/sapphire-guide',
    );
    const html = renderToStaticMarkup(
      <ConversationMessage
        message={message}
        revealed
        verifiedBlogUrls={canonicalBlogUrlsFromMessages([message])}
      />,
    );
    expect(html).toContain('Read JTV’s sapphire guide');
    expect(html).not.toContain('href="https://example.com/sapphire-guide"');
    expect(
      canonicalBlogUrlsFromMessages([sourcedBlogAnswer('Read more', 'http://www.jtv.com/guide')])
        .size,
    ).toBe(0);
  });
  it('does not execute raw HTML from agent text', () => {
    const html = renderToStaticMarkup(
      <ConversationMessage message={assistant('<script>alert(1)</script>')} revealed />,
    );
    expect(html).not.toContain('<script>');
  });
});
