import { multiply, type Matrix, type Rect } from './matrix';

/** Minimal shape of a pdf.js TextItem. */
export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

/** A horizontal run of existing page text, in view space (pt, top-left origin). */
export interface TextRun {
  id: string;
  text: string;
  x: number;
  baseline: number;
  width: number;
  fontSize: number;
  fontName: string;
  /** Area covering the glyphs, used for hit testing and content removal. */
  rect: Rect;
}

const ASCENT = 0.85;
const DESCENT = 0.25;

/**
 * Converts pdf.js text items to view space and merges neighbouring items on
 * the same line with the same font into editable runs. Rotated or vertical
 * text is skipped (it cannot be edited in place).
 */
export function buildTextRuns(items: RawTextItem[], viewTransform: Matrix, pageId = 'p'): TextRun[] {
  const pieces: Omit<TextRun, 'id' | 'rect'>[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const m = multiply(item.transform as Matrix, viewTransform);
    const horizontal = Math.abs(m[1]) < 1e-3 && Math.abs(m[2]) < 1e-3 && m[0] > 0 && m[3] < 0;
    if (!horizontal) continue;
    const fontSize = Math.abs(m[3]);
    if (fontSize < 0.5) continue;
    // item.width is in user space along the text direction; scale it like the x axis.
    const xScale = Math.hypot(viewTransform[0], viewTransform[1]) || 1;
    pieces.push({
      text: item.str,
      x: m[4],
      baseline: m[5],
      width: item.width * xScale,
      fontSize,
      fontName: item.fontName,
    });
  }

  const runs: TextRun[] = [];
  let current: Omit<TextRun, 'id' | 'rect'> | null = null;
  const flush = () => {
    if (current && current.text.trim()) {
      const text = current.text.replace(/\s+$/, '');
      runs.push({
        ...current,
        text,
        id: `${pageId}-run-${runs.length}`,
        rect: {
          x: current.x,
          y: current.baseline - ASCENT * current.fontSize,
          w: current.width,
          h: (ASCENT + DESCENT) * current.fontSize,
        },
      });
    }
    current = null;
  };
  for (const p of pieces) {
    if (current) {
      const sameLine = Math.abs(p.baseline - current.baseline) < current.fontSize * 0.2;
      const sameStyle = p.fontName === current.fontName && Math.abs(p.fontSize - current.fontSize) < 0.5;
      const gap = p.x - (current.x + current.width);
      if (sameLine && sameStyle && gap > -current.fontSize * 0.5 && gap < current.fontSize * 1.0) {
        const needsSpace = gap > current.fontSize * 0.15 && !/\s$/.test(current.text) && !/^\s/.test(p.text);
        current.text += (needsSpace ? ' ' : '') + p.text;
        current.width = Math.max(current.width, p.x + p.width - current.x);
        continue;
      }
      flush();
    }
    if (!p.text.trim()) continue;
    current = { ...p };
  }
  flush();
  return runs;
}
