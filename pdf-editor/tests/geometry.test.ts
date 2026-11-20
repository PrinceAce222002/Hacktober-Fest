import { describe, expect, it } from 'vitest';
import { rotatedSize, unrotatePoint } from '../src/editor/geometry';

describe('rotation geometry', () => {
  const w = 100;
  const h = 200;
  it('swaps size for quarter turns', () => {
    expect(rotatedSize(w, h, 90)).toEqual({ w: 200, h: 100 });
    expect(rotatedSize(w, h, 180)).toEqual({ w: 100, h: 200 });
  });

  it('maps the displayed top-left corner back to the right source corner', () => {
    // Rotating clockwise by 90 puts the source bottom-left corner at the display top-left.
    expect(unrotatePoint(0, 0, w, h, 90)).toEqual([0, h]);
    expect(unrotatePoint(0, 0, w, h, 180)).toEqual([w, h]);
    expect(unrotatePoint(0, 0, w, h, 270)).toEqual([w, 0]);
    expect(unrotatePoint(10, 20, w, h, 0)).toEqual([10, 20]);
  });

  it('agrees with the CSS rotation for an arbitrary point', () => {
    // CSS for 90: translate(h,0) rotate(90deg) maps (x, y) -> (h - y, x)
    const [x, y] = [30, 50];
    const display: [number, number] = [h - y, x];
    expect(unrotatePoint(display[0], display[1], w, h, 90)).toEqual([x, y]);
    // 270: translate(0, w) rotate(270deg) maps (x, y) -> (y, w - x)
    expect(unrotatePoint(y, w - x, w, h, 270)).toEqual([x, y]);
  });
});
