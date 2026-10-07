export type Viewport = { width: number; height: number };
export type WindowRect = { x: number; y: number; width: number; height: number };

const EDGE_GAP = 16;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;
const DEFAULT_WIDTH = 1440;
const DEFAULT_MAX_HEIGHT = 900;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function clampWindowRect(rect: WindowRect, viewport: Viewport): WindowRect {
  const maxWidth = Math.max(1, viewport.width - EDGE_GAP * 2);
  const maxHeight = Math.max(1, viewport.height - EDGE_GAP * 2);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  return {
    x: clamp(rect.x, EDGE_GAP, Math.max(EDGE_GAP, viewport.width - width - EDGE_GAP)),
    y: clamp(rect.y, EDGE_GAP, Math.max(EDGE_GAP, viewport.height - height - EDGE_GAP)),
    width,
    height,
  };
}

export function defaultWindowRect(viewport: Viewport): WindowRect {
  const width = Math.min(DEFAULT_WIDTH, Math.max(1, viewport.width - 48));
  const height = Math.min(DEFAULT_MAX_HEIGHT, Math.max(1, viewport.height - 112));
  return clampWindowRect(
    {
      x: viewport.width - width - 24,
      y: viewport.height - height - 84,
      width,
      height,
    },
    viewport,
  );
}

export function moveWindowRect(
  rect: WindowRect,
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
): WindowRect {
  return clampWindowRect({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY }, viewport);
}

export function resizeWindowRect(
  rect: WindowRect,
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
): WindowRect {
  const maxWidth = Math.max(1, viewport.width - rect.x - EDGE_GAP);
  const maxHeight = Math.max(1, viewport.height - rect.y - EDGE_GAP);
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  return {
    ...rect,
    width: clamp(rect.width + deltaX, minWidth, maxWidth),
    height: clamp(rect.height + deltaY, minHeight, maxHeight),
  };
}
