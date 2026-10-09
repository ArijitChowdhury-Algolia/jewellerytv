import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ConnectedConcierge } from './concierge/ConnectedConcierge';
import { trackConciergeVisibility } from './analytics';
import './concierge-workspace.css';
import './concierge/connected.css';

export interface ConciergeHandle {
  ask: () => void;
}

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
  const opener = useRef<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current !== open) trackConciergeVisibility(open);
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

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Open jewelry Concierge"
        hidden={open}
        onClick={() => {
          opener.current = trigger.current;
          setOpen(true);
        }}
        className="concierge-launcher"
      >
        Ask Concierge
      </button>
      <ConnectedConcierge
        context={context}
        blocked={blocked}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
});
