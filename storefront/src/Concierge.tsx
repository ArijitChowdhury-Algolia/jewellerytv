import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ConnectedConcierge } from './concierge/ConnectedConcierge';
import './concierge-workspace.css';
import './concierge/connected.css';

export interface ConciergeHandle {
  ask: () => void;
}

type Gate = 'checking' | 'connected' | 'unavailable';

export const demoTrace: {
  context: Record<string, string> | null;
  contextError: string;
  requests: unknown[];
} = {
  context: null,
  contextError: '',
  requests: [],
};

export const Concierge = forwardRef<
  ConciergeHandle,
  { context?: () => Record<string, string>; blocked?: string }
>(function Concierge({ context, blocked }, ref) {
  const [open, setOpen] = useState(false);
  const [gate, setGate] = useState<Gate>('checking');
  const opener = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((health: { environment?: string; developmentConfigured?: boolean } | null) => {
        setGate(
          health?.environment === 'development' && health.developmentConfigured === true
            ? 'connected'
            : 'unavailable',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setGate('unavailable');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useImperativeHandle(
    ref,
    () => ({
      ask: () => {
        const activeElement = typeof document === 'undefined' ? null : document.activeElement;
        opener.current =
          activeElement instanceof HTMLElement && activeElement !== document.body
            ? activeElement
            : trigger.current;
        setOpen(true);
      },
    }),
    [],
  );

  const unavailable = gate !== 'connected';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={unavailable ? 'Open Concierge unavailable notice' : 'Open jewelry Concierge'}
        hidden={open}
        onClick={() => {
          opener.current = trigger.current;
          setOpen(true);
        }}
        className="concierge-launcher"
      >
        {unavailable ? 'Concierge unavailable' : 'Ask Concierge'}
      </button>
      {open && unavailable && (
          <aside className="concierge-panel concierge-workspace" aria-label="Concierge unavailable">
            <header className="concierge-header">
              <strong>JTV Concierge</strong>
              <button
                type="button"
                aria-label="Close Concierge notice"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </header>
            <div className="concierge-workspace-body concierge-unavailable-body">
              <section className="conversation-column" aria-label="Conversation">
                <p role="status">
                  The local Concierge is unavailable while its development configuration is
                  reviewed.
                </p>
              </section>
              <section className="shopping-column" aria-label="Product workspace">
                <h2>Product workspace</h2>
                <p>Saved products and comparisons are unavailable in this local shell.</p>
              </section>
            </div>
          </aside>
      )}
      {!unavailable && (
        <ConnectedConcierge
          context={context}
          blocked={blocked}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
});
