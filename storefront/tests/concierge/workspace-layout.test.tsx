import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConciergeWorkspaceLayout } from '../../src/concierge/ConciergeWorkspaceLayout';

describe('approved Concierge workspace layout', () => {
  it('keeps header controls, preferences, conversation, composer, and product workspace in one modal', () => {
    const html = renderToStaticMarkup(
      <ConciergeWorkspaceLayout
        headerActions={<button type="button">New conversation</button>}
        preferenceControls={<button type="button">Preferences</button>}
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
    expect(html).toContain('class="brief-header-controls"');
    expect(html).toContain('data-testid="preferences"');
    expect(html).toContain('class="concierge-messages"');
    expect(html).toContain('class="concierge-prompt"');
    expect(html).toContain('class="shopping-column"');
    expect(html).toContain('aria-label="Concierge sections"');
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
});
