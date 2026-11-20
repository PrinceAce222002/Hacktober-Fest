export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function dist(a: RGB, b: RGB): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Estimates the background color (most common color on the region's border)
 * and foreground/text color (the pixel most different from the background)
 * inside a region of rendered pixels.
 */
export function sampleColors(
  img: PixelSource,
  x: number,
  y: number,
  w: number,
  h: number,
): { background: string; foreground: string } {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width - 1, Math.ceil(x + w));
  const y1 = Math.min(img.height - 1, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return { background: '#ffffff', foreground: '#000000' };
  const px = (cx: number, cy: number): RGB => {
    const i = (cy * img.width + cx) * 4;
    const a = img.data[i + 3] / 255;
    // Composite over white: transparent canvas pixels are white paper.
    return [
      img.data[i] * a + 255 * (1 - a),
      img.data[i + 1] * a + 255 * (1 - a),
      img.data[i + 2] * a + 255 * (1 - a),
    ];
  };
  const counts = new Map<string, { n: number; c: RGB }>();
  const add = (c: RGB) => {
    const q: RGB = [c[0] >> 3, c[1] >> 3, c[2] >> 3];
    const key = q.join(',');
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { n: 1, c });
  };
  for (let cx = x0; cx <= x1; cx++) {
    add(px(cx, y0));
    add(px(cx, y1));
  }
  for (let cy = y0; cy <= y1; cy++) {
    add(px(x0, cy));
    add(px(x1, cy));
  }
  let bg: RGB = [255, 255, 255];
  let best = -1;
  for (const { n, c } of counts.values()) {
    if (n > best) {
      best = n;
      bg = c;
    }
  }
  let fg: RGB = [0, 0, 0];
  let far = -1;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = px(cx, cy);
      const d = dist(c, bg);
      if (d > far) {
        far = d;
        fg = c;
      }
    }
  }
  if (far < 40) fg = [0, 0, 0];
  return { background: rgbToHex(bg), foreground: rgbToHex(fg) };
}
