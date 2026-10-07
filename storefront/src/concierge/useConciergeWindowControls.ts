import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import {
  clampWindowRect,
  defaultWindowRect,
  moveWindowRect,
  resizeWindowRect,
  type WindowRect,
} from './windowGeometry';

type Interaction = {
  pointerId: number;
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  rect: WindowRect;
};

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useConciergeWindowControls() {
  const panelRef = useRef<HTMLElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const [rect, setRect] = useState<WindowRect | null>(null);
  const [restoreRect, setRestoreRect] = useState<WindowRect | null>(null);
  const [maximized, setMaximized] = useState(false);

  const currentRect = useCallback((): WindowRect => {
    if (rect) return rect;
    const bounds = panelRef.current?.getBoundingClientRect();
    return bounds
      ? clampWindowRect(
          { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
          viewport(),
        )
      : defaultWindowRect(viewport());
  }, [rect]);

  const begin = useCallback(
    (kind: Interaction['kind'], event: PointerEvent<HTMLElement>) => {
      if (window.matchMedia('(max-width: 767px)').matches || event.button !== 0 || maximized)
        return;
      event.preventDefault();
      interaction.current = {
        pointerId: event.pointerId,
        kind,
        startX: event.clientX,
        startY: event.clientY,
        rect: currentRect(),
      };
    },
    [currentRect, maximized],
  );

  const beginHeaderMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, a, input, select, textarea, [role="button"]')
      )
        return;
      begin('move', event);
    },
    [begin],
  );

  useEffect(() => {
    function onPointerMove(event: globalThis.PointerEvent) {
      const active = interaction.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      setRect(
        active.kind === 'move'
          ? moveWindowRect(active.rect, dx, dy, viewport())
          : resizeWindowRect(active.rect, dx, dy, viewport()),
      );
    }
    function endInteraction(event: globalThis.PointerEvent) {
      if (interaction.current?.pointerId === event.pointerId) interaction.current = null;
    }
    function onResize() {
      const currentViewport = viewport();
      if (currentViewport.width < 768) return;
      setRect((current) => (current ? clampWindowRect(current, currentViewport) : current));
      setRestoreRect((current) => (current ? clampWindowRect(current, currentViewport) : current));
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endInteraction);
    window.addEventListener('pointercancel', endInteraction);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endInteraction);
      window.removeEventListener('pointercancel', endInteraction);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  function handleMoveKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const distances: Record<string, [number, number]> = {
      ArrowUp: [0, -24],
      ArrowDown: [0, 24],
      ArrowLeft: [-24, 0],
      ArrowRight: [24, 0],
    };
    const delta = distances[event.key];
    if (!delta || maximized) return;
    event.preventDefault();
    const scale = event.shiftKey ? 3 : 1;
    setRect(moveWindowRect(currentRect(), delta[0] * scale, delta[1] * scale, viewport()));
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const distances: Record<string, [number, number]> = {
      ArrowUp: [0, -24],
      ArrowDown: [0, 24],
      ArrowLeft: [-24, 0],
      ArrowRight: [24, 0],
    };
    const delta = distances[event.key];
    if (!delta || maximized) return;
    event.preventDefault();
    const scale = event.shiftKey ? 3 : 1;
    setRect(resizeWindowRect(currentRect(), delta[0] * scale, delta[1] * scale, viewport()));
  }

  function toggleMaximized() {
    if (maximized) {
      setRect(clampWindowRect(restoreRect ?? defaultWindowRect(viewport()), viewport()));
      setMaximized(false);
      return;
    }
    setRestoreRect(currentRect());
    interaction.current = null;
    setMaximized(true);
  }

  const style =
    rect && !maximized
      ? {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          right: 'auto',
          bottom: 'auto',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          maxHeight: 'none',
        }
      : undefined;

  return {
    panelRef,
    style,
    maximized,
    beginHeaderMove,
    beginMove: (event: PointerEvent<HTMLElement>) => begin('move', event),
    beginResize: (event: PointerEvent<HTMLElement>) => begin('resize', event),
    handleMoveKeyDown,
    handleResizeKeyDown,
    toggleMaximized,
  };
}
