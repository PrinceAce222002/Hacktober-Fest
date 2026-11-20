/**
 * Helpers for mapping pointer positions to page view space when a page is
 * displayed rotated (by CSS) by the user-applied rotation.
 */

export function rotatedSize(w: number, h: number, rotation: number): { w: number; h: number } {
  return rotation % 180 === 0 ? { w, h } : { w: h, h: w };
}

/** CSS transform (origin top-left) that rotates a w x h box clockwise into its rotated slot. */
export function rotationTransform(w: number, h: number, rotation: number): string {
  switch (rotation) {
    case 90:
      return `translate(${h}px, 0) rotate(90deg)`;
    case 180:
      return `translate(${w}px, ${h}px) rotate(180deg)`;
    case 270:
      return `translate(0, ${w}px) rotate(270deg)`;
    default:
      return 'none';
  }
}

/** Maps a point in the rotated (displayed) box back into the unrotated w x h box. */
export function unrotatePoint(ox: number, oy: number, w: number, h: number, rotation: number): [number, number] {
  switch (rotation) {
    case 90:
      return [oy, h - ox];
    case 180:
      return [w - ox, h - oy];
    case 270:
      return [w - oy, ox];
    default:
      return [ox, oy];
  }
}
