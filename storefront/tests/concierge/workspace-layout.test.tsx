import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConciergeWorkspaceLayout } from '../../src/concierge/ConciergeWorkspaceLayout';

describe('approved Concierge workspace layout', () => {
  it('keeps header controls, preferences, conversation, composer, and product workspace in one modal', () => {
    const html = renderToStaticMarkup(
      <ConciergeWorkspaceLayout
        headerActions={<button type="button">New conversation</button>}
        preferenceControls={<button type="button">Preferences</button>}
        closeAction={
          <button type="button" aria-label="Close Concierge">
            Close
          </button>
        }
        preferenceContent={<div data-testid="preferences">Preference editor</div>}
        messages={<p>Assistant answer</p>}
        status={<p role="status">Checking</p>}
        composer={
          <label>
            Ask
            <input aria-label="Ask the Concierge" />
          </label>
        }
        productWorkspace={<div data-testid="product-workspace">Saved and Compare</div>}
        sectionSwitch={
          <>
            <button>Conversation</button>
            <button>Products</button>
          </>
        }
      />,
    );
    expect(html).toContain('class="concierge-panel concierge-workspace connected-concierge"');
    expect(html).toContain('class="concierge-header"');
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    expect(header).toMatch(
      /New conversation[\s\S]*Preferences[\s\S]*Maximize Concierge window[\s\S]*Close Concierge/,
    );
    expect(header).not.toContain('concierge-window-resize');
    expect(html).toContain('class="concierge-window-resize"');
    expect(html).toContain('class="brief-header-controls"');
    expect(html).toContain('data-testid="preferences"');
    expect(html).toContain('class="concierge-messages"');
    expect(html).toContain('class="concierge-prompt"');
    expect(html).toContain('class="shopping-column"');
    expect(html).toContain('aria-label="Concierge sections"');
    expect(html).toMatch(
      /New conversation[\s\S]*Preferences[\s\S]*Maximize Concierge window[\s\S]*Close Concierge/,
    );
    expect(html).toContain('class="concierge-window-resize"');
    expect(html.indexOf('class="concierge-window-resize"')).toBeGreaterThan(
      html.indexOf('</footer>'),
    );
    expect(html).not.toContain('Product workspace</h2>');
  });

  it('uses the mobile section state without changing the slot contract', () => {
    const html = renderToStaticMarkup(
      <ConciergeWorkspaceLayout
        headerActions={<button type="button">Close</button>}
        messages={<p>Conversation</p>}
        composer={<button type="button">Send</button>}
        productWorkspace={<p>Products</p>}
        section="shopping"
        sectionSwitch={<button aria-pressed="true">Products</button>}
      />,
    );
    expect(html).toContain('data-section="shopping"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('keeps one shared composer and its status outside both scrollable columns', () => {
    const html = renderToStaticMarkup(
      <ConciergeWorkspaceLayout
        headerActions={<button type="button">Close</button>}
        messages={<p>Conversation</p>}
        status={<p role="status">Searching</p>}
        composer={<input aria-label="Message the Concierge" />}
        productWorkspace={<p>Products</p>}
        section="shopping"
      />,
    );
    expect(html).toMatch(/<\/section><\/div><footer class="concierge-composer-footer">/);
    expect(html).toMatch(
      /<footer class="concierge-composer-footer"><p role="status">Searching<\/p>/,
    );
    expect(html.match(/aria-label="Message the Concierge"/g)).toHaveLength(1);
  });
});
