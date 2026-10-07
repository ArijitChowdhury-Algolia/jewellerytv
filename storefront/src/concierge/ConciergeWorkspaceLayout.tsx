import type { ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useConciergeWindowControls } from './useConciergeWindowControls';
import '../concierge-window-controls.css';
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
  const windowControls = useConciergeWindowControls();
  if (!open) return null;
  return (
    <aside
      ref={windowControls.panelRef}
      style={windowControls.style}
      className={`concierge-panel concierge-workspace connected-concierge${windowControls.maximized ? ' concierge-workspace--maximized' : ''}`}
      aria-label={ariaLabel}
    >
      <header className="concierge-header" onPointerDown={windowControls.beginHeaderMove}>
        <button
          type="button"
          className="concierge-window-keyboard-move"
          aria-label="Move Concierge window with arrow keys"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          title="Use arrow keys to move the window"
          onPointerDown={windowControls.beginMove}
          onKeyDown={windowControls.handleMoveKeyDown}
        >
          Move window
        </button>
        <strong>JTV Concierge</strong>
        <div className="concierge-header-actions">
          {headerActions}
          {preferenceControls && <div className="brief-header-controls">{preferenceControls}</div>}
          <button
            type="button"
            className="concierge-window-maximize"
            aria-label={
              windowControls.maximized ? 'Restore Concierge window' : 'Maximize Concierge window'
            }
            title={windowControls.maximized ? 'Restore window size' : 'Maximize to browser window'}
            onClick={windowControls.toggleMaximized}
          >
            {windowControls.maximized ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </button>
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
        </section>
        <section className="shopping-column" aria-label="Your shopping workspace">
          {productWorkspace}
        </section>
      </div>
      <footer className="concierge-composer-footer">
        {status}
        <div className="concierge-prompt">{composer}</div>
      </footer>
      <button
        type="button"
        className="concierge-window-resize"
        aria-label="Resize Concierge window with arrow keys"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        title="Drag to resize or focus and use arrow keys"
        onPointerDown={windowControls.beginResize}
        onKeyDown={windowControls.handleResizeKeyDown}
      />
    </aside>
  );
}
