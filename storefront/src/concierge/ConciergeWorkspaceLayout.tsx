import type { ReactNode } from 'react';
import '../concierge-workspace.css';
import '../shopping-workspace.css';

export type ConciergeWorkspaceSection = 'conversation' | 'shopping';

export interface ConciergeWorkspaceLayoutProps {
  /** Header controls such as New conversation and Close. */
  headerActions: ReactNode;
  /** Compact Preferences trigger rendered in the same header row. */
  preferenceControls?: ReactNode;
  /** Expanded preference editor rendered above the conversation. */
  preferenceContent?: ReactNode;
  messages: ReactNode;
  status?: ReactNode;
  composer: ReactNode;
  productWorkspace: ReactNode;
  /** Mobile Conversation/Products controls. */
  sectionSwitch?: ReactNode;
  section?: ConciergeWorkspaceSection;
  open?: boolean;
  ariaLabel?: string;
}

/**
 * The approved JTV two-column modal skeleton. State and chat ownership stay
 * with the caller; this component only owns the layout and responsive panes.
 */
export function ConciergeWorkspaceLayout({
  headerActions,
  preferenceControls,
  preferenceContent,
  messages,
  status,
  composer,
  productWorkspace,
  sectionSwitch,
  section = 'conversation',
  open = true,
  ariaLabel = 'Jewelry buying Concierge',
}: ConciergeWorkspaceLayoutProps) {
  if (!open) return null;
  return (
    <aside className="concierge-panel concierge-workspace connected-concierge" aria-label={ariaLabel}>
      <header className="concierge-header">
        <strong>JTV Concierge</strong>
        <div className="concierge-header-actions">
          {headerActions}
          {preferenceControls && <div className="brief-header-controls">{preferenceControls}</div>}
        </div>
      </header>
      {sectionSwitch && (
        <nav className="workspace-sections" aria-label="Concierge sections">
          {sectionSwitch}
        </nav>
      )}
      <div className="concierge-workspace-body" data-section={section}>
        <section className="conversation-column" aria-label="Conversation">
          {preferenceContent && <div className="concierge-preferences">{preferenceContent}</div>}
          <div className="concierge-messages">{messages}</div>
          {status}
          <div className="concierge-prompt">{composer}</div>
        </section>
        <section className="shopping-column" aria-label="Your shopping workspace">
          {productWorkspace}
        </section>
      </div>
    </aside>
  );
}
