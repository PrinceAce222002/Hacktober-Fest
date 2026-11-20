/**
 * 2D affine matrices in PDF notation: [a b c d e f] maps (x, y) to
 * (a*x + c*y + e, b*x + d*y + f). `multiply(m1, m2)` applies m1 first, then m2,
 * matching the PDF spec's row-vector convention (e.g. Trm = Tparams x Tm x CTM).
 */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function applyToPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounding box of a rectangle after transformation. */
export function transformRect(m: Matrix, x0: number, y0: number, x1: number, y1: number): Rect {
  const pts = [
    applyToPoint(m, x0, y0),
    applyToPoint(m, x1, y0),
    applyToPoint(m, x0, y1),
    applyToPoint(m, x1, y1),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * The transform from PDF user space to "view space" (top-left origin, y down,
 * 1 unit = 1pt) for a page with the given box and /Rotate. Mirrors pdf.js's
 * PageViewport at scale 1 so coordinates match what pdf.js renders.
 */
export function viewportTransform(
  box: [number, number, number, number],
  rotation: number,
): { transform: Matrix; width: number; height: number } {
  const [x1, y1, x2, y2] = box;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rot = ((rotation % 360) + 360) % 360;
  let a: number, b: number, c: number, d: number;
  switch (rot) {
    case 90:
      [a, b, c, d] = [0, 1, 1, 0];
      break;
    case 180:
      [a, b, c, d] = [-1, 0, 0, 1];
      break;
    case 270:
      [a, b, c, d] = [0, -1, -1, 0];
      break;
    default:
      [a, b, c, d] = [1, 0, 0, -1];
  }
  let offX: number, offY: number, width: number, height: number;
  if (a === 0) {
    offX = Math.abs(cy - y1);
    offY = Math.abs(cx - x1);
    width = Math.abs(y2 - y1);
    height = Math.abs(x2 - x1);
  } else {
    offX = Math.abs(cx - x1);
    offY = Math.abs(cy - y1);
    width = Math.abs(x2 - x1);
    height = Math.abs(y2 - y1);
  }
  return {
    transform: [a, b, c, d, offX - a * cx - c * cy, offY - b * cx - d * cy],
    width,
    height,
  };
}

export function rectContainsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
