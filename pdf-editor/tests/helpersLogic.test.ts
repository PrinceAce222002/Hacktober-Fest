import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, sampleColors } from '../src/lib/color';
import { baselineOffset, matchFont } from '../src/lib/fonts';
import { buildTextRuns } from '../src/lib/textRuns';
import type { Matrix } from '../src/lib/matrix';

describe('color helpers', () => {
  it('converts between hex and rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
  });

  it('samples background and text colors from pixels', () => {
    const width = 20;
    const height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set([240, 240, 200, 255], i * 4);
    // A dark red "glyph" in the middle.
    for (let y = 4; y < 6; y++) for (let x = 8; x < 12; x++) data.set([150, 0, 0, 255], (y * width + x) * 4);
    const { background, foreground } = sampleColors({ data, width, height }, 0, 0, 19, 9);
    expect(background).toBe('#f0f0c8');
    expect(foreground).toBe('#960000');
  });
});

describe('font matching', () => {
  it('maps embedded font names to standard families and styles', () => {
    expect(matchFont('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toEqual({ family: 'Times', bold: true, italic: true });
    expect(matchFont('Arial-BoldMT')).toEqual({ family: 'Helvetica', bold: true, italic: false });
    expect(matchFont('CourierNewPSMT')).toEqual({ family: 'Courier', bold: false, italic: false });
    expect(matchFont('XYZABC+Calibri-Italic')).toEqual({ family: 'Helvetica', bold: false, italic: true });
    expect(matchFont('g_d0_f1', 'serif').family).toBe('Times');
    expect(matchFont('CMR10').family).toBe('Times');
  });

  it('computes a baseline offset within the line box', () => {
    const off = baselineOffset('Helvetica', 10);
    expect(off).toBeGreaterThan(8);
    expect(off).toBeLessThan(12);
  });
});

describe('buildTextRuns', () => {
  const view: Matrix = [1, 0, 0, -1, 0, 800];
  const item = (str: string, x: number, y: number, width: number, fontName = 'f1', size = 12) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width,
    height: size,
    fontName,
  });

  it('merges fragments on the same line and splits on font, line and gap changes', () => {
    const runs = buildTextRuns(
      [
        item('Hello', 50, 700, 30),
        item('world', 84, 700, 30),
        item('Far away', 300, 700, 50),
        item('Bold', 50, 680, 25, 'f2'),
        item('', 0, 0, 0),
        item('Rotated', 50, 600, 40),
      ].map((it, i) => (i === 5 ? { ...it, transform: [0, 12, -12, 0, 50, 600] } : it)),
      view,
    );
    expect(runs.map((r) => r.text)).toEqual(['Hello world', 'Far away', 'Bold']);
    expect(runs[0]).toMatchObject({ x: 50, baseline: 100, fontSize: 12, width: 64 });
    expect(runs[0].rect.y).toBeLessThan(100);
    expect(runs[0].rect.y + runs[0].rect.h).toBeGreaterThan(100);
  });
});
