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
  it('keeps generated tables in a keyboard-scrollable region without changing their content', () => {
    const message = assistant(
      '| Term | Meaning | Genuine? |\n| --- | --- | --- |\n| Cultured | Farmed pearl | Yes |',
    );
    const html = renderToStaticMarkup(<ConversationMessage message={message} revealed />);
    expect(html).toContain('class="connected-table-scroll"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('<table>');
    expect(html).toContain('Farmed pearl');
    expect(html).toContain('class="connected-table-glossary"');
    expect(html).toContain('class="connected-table-entry"');
  });
  it('shows provisional text without making its links actionable', () => {
    const message = assistant('A first thought. [See the piece](/product/VG320P)');
    const html = renderToStaticMarkup(
      <ConversationMessage message={message} revealed={false} provisional />,
    );
    expect(html).toContain('A first thought.');
    expect(html).toContain('See the piece');
    expect(html).not.toContain('href=');
    expect(html).toContain('connected-provisional');
    expect(renderToStaticMarkup(<ConversationMessage message={message} revealed={false} />)).toBe(
      '',
    );
  });
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
  it('keeps pre-tool and final text parts distinct without changing either part', () => {
    const beforeTool =
      'A 10th anniversary is a lovely milestone, and your instinct toward something timeless and understated feels especially thoughtful. With white gold and a $500 ceiling, I’d focus on a piece she can wear often rather than something that only works for special occasions.\n\nWhat does she reach for most in everyday life: earrings, necklaces, bracelets, or rings?';
    const afterTool =
      'A 10th anniversary is a lovely milestone, and your instinct toward something timeless and understated feels especially thoughtful. With white gold and a $500 ceiling, I’d focus on a piece she can wear often rather than something reserved for special occasions.\n\nWhat does she reach for most in everyday life: earrings, necklaces, bracelets, or rings?';
    const message = {
      id: 'captured-duplicate',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: beforeTool, state: 'done' },
        {
          type: 'tool-update_shopping_state',
          toolCallId: 'call-state',
          state: 'output-available',
          input: {},
          output: { status: 'applied' },
        },
        { type: 'step-start' },
        { type: 'text', text: afterTool, state: 'done' },
      ],
    } as UIMessage;
    const html = renderToStaticMarkup(<ConversationMessage message={message} revealed />);
    expect(html).toContain(
      'What does she reach for most in everyday life: earrings, necklaces, bracelets, or rings?</p>',
    );
    expect(html.match(/class="connected-assistant-text-part"/g)).toHaveLength(2);
    expect(html.indexOf('only works for special occasions')).toBeLessThan(
      html.indexOf('reserved for special occasions'),
    );
    expect(html.match(/What does she reach for most in everyday life:/g)).toHaveLength(2);
  });
  it('preserves meaningful pre-tool text alongside the final post-tool answer', () => {
    const preTool = 'I’ll keep her ring size unknown while we explore.';
    const finalAnswer = 'A blue necklace could avoid guessing her ring size.';
    const message = {
      id: 'captured-distinct-steps',
      role: 'assistant',
      parts: [
        { type: 'text', text: preTool, state: 'done' },
        {
          type: 'tool-update_shopping_state',
          toolCallId: 'call-state',
          state: 'output-available',
          input: {},
          output: { status: 'applied' },
        },
        { type: 'step-start' },
        { type: 'text', text: finalAnswer, state: 'done' },
      ],
    } as UIMessage;
    const html = renderToStaticMarkup(<ConversationMessage message={message} revealed />);
    expect(html).toContain(preTool);
    expect(html).toContain(finalAnswer);
    expect(html.indexOf(preTool)).toBeLessThan(html.indexOf(finalAnswer));
    expect(html.match(/class="connected-assistant-text-part"/g)).toHaveLength(2);
  });
});
