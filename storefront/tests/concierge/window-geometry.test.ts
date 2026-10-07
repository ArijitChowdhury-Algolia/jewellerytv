import { describe, expect, it } from 'vitest';
import {
  defaultWindowRect,
  moveWindowRect,
  resizeWindowRect,
  type Viewport,
} from '../../src/concierge/windowGeometry';

/*
Scenario list:
- Default desktop geometry fits the viewport and honors the starting offset.
- Moving clamps all four edges so the window remains reachable.
- Resizing grows within the viewport and preserves the top-left anchor.
- Resizing below minimum dimensions stops at the minimum.
- Small viewports still receive a usable rectangle without overflow.
*/
const desktop: Viewport = { width: 1440, height: 900 };

describe('concierge window geometry', () => {
  it('starts with a large window inside the viewport', () => {
    expect(defaultWindowRect(desktop)).toEqual({ x: 24, y: 28, width: 1392, height: 788 });
  });

  it('keeps the window reachable when moved beyond each viewport edge', () => {
    const start = { x: 24, y: 28, width: 900, height: 700 };
    expect(moveWindowRect(start, -500, -500, desktop)).toEqual({
      x: 16,
      y: 16,
      width: 900,
      height: 700,
    });
    expect(moveWindowRect(start, 900, 500, desktop)).toEqual({
      x: 524,
      y: 184,
      width: 900,
      height: 700,
    });
  });

  it('resizes from the lower-right corner without moving the top-left anchor', () => {
    expect(resizeWindowRect({ x: 24, y: 28, width: 900, height: 600 }, 200, 100, desktop)).toEqual({
      x: 24,
      y: 28,
      width: 1100,
      height: 700,
    });
  });

  it('enforces minimum dimensions and viewport limits', () => {
    expect(
      resizeWindowRect({ x: 24, y: 28, width: 700, height: 500 }, -900, -900, desktop),
    ).toEqual({
      x: 24,
      y: 28,
      width: 640,
      height: 420,
    });
    expect(
      resizeWindowRect({ x: 24, y: 28, width: 700, height: 500 }, 2000, 2000, desktop),
    ).toEqual({
      x: 24,
      y: 28,
      width: 1400,
      height: 856,
    });
  });

  it('adapts its minimum dimensions when the viewport is smaller than the desktop minimum', () => {
    const rect = defaultWindowRect({ width: 800, height: 600 });
    expect(rect.width).toBeLessThanOrEqual(768);
    expect(rect.height).toBeLessThanOrEqual(568);
    expect(rect.x).toBeGreaterThanOrEqual(16);
    expect(rect.y).toBeGreaterThanOrEqual(16);
  });
});
