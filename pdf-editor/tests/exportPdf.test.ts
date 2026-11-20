import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportPdf } from '../src/lib/exportPdf';
import { analyzePage, getPageView, rewriteContent } from '../src/lib/pdfAnalysis';
import { createSamplePdf } from '../src/lib/samplePdf';
import type { Asset, DocState, EditorObject, TextObject } from '../src/state/types';
import { extractPdf } from './helpers';

async function initialState(bytes: Uint8Array): Promise<DocState> {
  const doc = await PDFDocument.load(bytes);
  return {
    pages: doc.getPages().map((p, i) => {
      const v = getPageView(p);
      return { id: `p${i}`, srcIndex: i, rotation: 0, width: v.width, height: v.height, objects: [] };
    }),
  };
}

function withObjects(state: DocState, pageIdx: number, objects: EditorObject[]): DocState {
  return {
    pages: state.pages.map((p, i) => (i === pageIdx ? { ...p, objects: [...p.objects, ...objects] } : p)),
  };
}

const style = { fontFamily: 'Helvetica' as const, fontSize: 12, color: '#000000', bold: false, italic: false };

describe('exportPdf', () => {
  it('replaces existing text by removing the original glyphs from the content stream', async () => {
    const src = await createSamplePdf();
    const [page1] = await extractPdf(src);
    const run = page1.runs.find((r) => r.text === 'Quarterly Report')!;
    expect(run).toBeTruthy();
    const edit: TextObject = {
      id: 't1',
      type: 'text',
      x: run.x,
      baseline: run.baseline,
      text: 'Annual Report',
      style: { ...style, fontSize: run.fontSize, bold: true, color: '#1a3380' },
      replaces: { runId: run.id, rect: run.rect, cover: '#eef2ff' },
    };
    const state = withObjects(await initialState(src), 0, [edit]);
    const { bytes, stats } = await exportPdf(src, state, new Map());
    const out = await extractPdf(bytes);
    expect(out[0].text).toContain('Annual Report');
    expect(out[0].text).not.toContain('Quarterly');
    // Other text on the page is untouched.
    expect(out[0].text).toContain('Prepared by the Example Company');
    expect(stats.removedGlyphs).toBe('Quarterly Report'.length);
    expect(stats.coveredRegions).toBe(0);
    const newRun = out[0].runs.find((r) => r.text === 'Annual Report')!;
    expect(newRun.x).toBeCloseTo(run.x, 1);
    expect(newRun.baseline).toBeCloseTo(run.baseline, 1);
    expect(newRun.fontSize).toBeCloseTo(run.fontSize, 1);
  });

  it('erases part of a line while keeping the remaining glyphs in place', async () => {
    const src = await createSamplePdf();
    const [page1] = await extractPdf(src);
    const run = page1.runs.find((r) => r.text.startsWith('Total revenue'))!;
    // Erase only the first ~45% of the line ("Total revenue").
    const erase: EditorObject = {
      id: 'e1',
      type: 'erase',
      x: run.rect.x - 2,
      y: run.rect.y,
      w: run.rect.w * 0.45,
      h: run.rect.h,
      fill: null,
    };
    const state = withObjects(await initialState(src), 0, [erase]);
    const { bytes, stats } = await exportPdf(src, state, new Map());
    const out = await extractPdf(bytes);
    expect(out[0].text).not.toContain('Total revenue');
    expect(stats.removedGlyphs).toBeGreaterThan(5);
    const remaining = out[0].runs.find((r) => r.text.includes('1,234,567'))!;
    expect(remaining).toBeTruthy();
    const origX = run.x + run.width - remaining.width;
    expect(remaining.x).toBeCloseTo(origX, 0);
  });

  it('keeps following text in place when removing glyphs from consecutive Tj operators', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 200]);
    const key = page.node.newFontDictionary('F', font.ref).decodeText();
    const stream = doc.context.flateStream(
      `BT /${key} 20 Tf 2 Tc 50 100 Td (Hello ) Tj (World) Tj ET`,
    );
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    const bytes = await doc.save();
    const before = await extractPdf(bytes);
    const loaded = await PDFDocument.load(bytes);
    const analysis = analyzePage(loaded, loaded.getPage(0));
    const glyphs = analysis.shows.flatMap((s) => s.parts.filter((p) => p.kind === 'glyph'));
    expect(glyphs).toHaveLength(11);
    const result = rewriteContent(
      analysis,
      (g) => g.cx < before[0].runs[0].x + font.widthOfTextAtSize('Hello ', 20) + 6 * 2,
      () => false,
    );
    expect(result.removedGlyphs).toBe(6);
    expect(result.content).toContain('TJ');

    const state = withObjects(await initialState(bytes), 0, [
      { id: 'e', type: 'erase', x: 40, y: 70, w: 75, h: 40, fill: null },
    ]);
    const exported = (await exportPdf(bytes, state, new Map())).bytes;
    const out = await extractPdf(exported);
    expect(out[0].text).toBe('World');
    // "World" still starts after "Hello " plus 2pt of character spacing for each of its 6 glyphs.
    // (Checked with the spec-following interpreter: pdf.js text extraction adds Tc to leading TJ numbers.)
    const expectedX = 50 + font.widthOfTextAtSize('Hello ', 20) + 6 * 2;
    const reloaded = await PDFDocument.load(exported);
    const kept = analyzePage(reloaded, reloaded.getPage(0)).shows.flatMap((s) =>
      s.parts.flatMap((p) => (p.kind === 'glyph' ? [p.glyph] : [])),
    );
    expect(kept.map((g) => g.bytes).join('')).toBe('World');
    expect(kept[0].rect.x).toBeCloseTo(expectedX, 1);
  });

  it('deletes existing images, falling back to a cover when nothing matches', async () => {
    const src = await createSamplePdf();
    const before = await extractPdf(src);
    expect(before[0].imageCount).toBe(1);
    const loaded = await PDFDocument.load(src);
    const img = analyzePage(loaded, loaded.getPage(0)).images[0];
    expect(img.rect.w).toBeCloseTo(160);
    const state = withObjects(await initialState(src), 0, [
      { id: 'd1', type: 'imageDelete', rect: img.rect, cover: '#ffffff' },
      { id: 'd2', type: 'imageDelete', rect: { x: 0, y: 0, w: 5, h: 5 }, cover: '#ffffff' },
    ]);
    const { bytes, stats } = await exportPdf(src, state, new Map());
    const out = await extractPdf(bytes);
    expect(out[0].imageCount).toBe(0);
    expect(stats.removedImages).toBe(1);
    expect(stats.coveredRegions).toBe(1);
  });

  it('adds text, shapes and images', async () => {
    const src = await createSamplePdf();
    // 1x1 PNG
    const pngBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const assets = new Map<string, Asset>([
      ['a1', { bytes: pngBytes, mime: 'image/png', url: '', width: 1, height: 1 }],
    ]);
    const state = withObjects(await initialState(src), 1, [
      { id: 'n1', type: 'text', x: 60, baseline: 300, text: 'Line one\nLine two (Ünïcødé → ok)', style: { ...style, fontFamily: 'Times', italic: true } },
      { id: 's1', type: 'rect', x: 50, y: 400, w: 100, h: 50, stroke: '#ff0000', fill: '#00ff00', strokeWidth: 2 },
      { id: 's2', type: 'ellipse', x: 200, y: 400, w: 100, h: 50, stroke: null, fill: '#0000ff', strokeWidth: 0 },
      { id: 's3', type: 'line', x1: 0, y1: 0, x2: 100, y2: 100, stroke: '#000000', strokeWidth: 1 },
      { id: 'i1', type: 'image', x: 300, y: 300, w: 50, h: 50, assetId: 'a1' },
    ]);
    const { bytes } = await exportPdf(src, state, assets);
    const out = await extractPdf(bytes);
    expect(out[1].text).toContain('Line one');
    expect(out[1].text).toContain('Line two (Ünïcødé ? ok)');
    expect(out[1].imageCount).toBe(1);
    const lineOne = out[1].runs.find((r) => r.text === 'Line one')!;
    expect(lineOne.x).toBeCloseTo(60, 1);
    expect(lineOne.baseline).toBeCloseTo(300, 1);
  });

  it('reorders, rotates, deletes and inserts pages', async () => {
    const src = await createSamplePdf();
    const base = await initialState(src);
    const state: DocState = {
      pages: [
        { ...base.pages[2], rotation: 90 },
        { id: 'blank', srcIndex: null, rotation: 0, width: 300, height: 400, objects: [
          { id: 'bt', type: 'text', x: 20, baseline: 40, text: 'Blank page note', style },
        ] },
        base.pages[0],
      ],
    };
    const { bytes } = await exportPdf(src, state, new Map());
    const out = await extractPdf(bytes);
    expect(out).toHaveLength(3);
    expect(out[0].text).toContain('Page Three');
    expect(out[0].rotation).toBe(90);
    expect(out[1].text).toBe('Blank page note');
    expect(out[1].width).toBe(300);
    expect(out[2].text).toContain('Quarterly Report');
    expect(out.some((p) => p.text.includes('Page Two'))).toBe(false);
  });

  it('places edits correctly on pages that already have a /Rotate', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 600]);
    page.drawText('Rotated source', { x: 50, y: 500, size: 14, font });
    page.setRotation({ type: 'degrees', angle: 90 } as never);
    const src = await doc.save();
    const [p] = await extractPdf(src);
    // On a page rotated by 90 the text runs vertically in view space and is not editable,
    // but new objects are placed in view coordinates.
    expect(p.width).toBe(600);
    const state = withObjects(await initialState(src), 0, [
      { id: 'x', type: 'text', x: 100, baseline: 80, text: 'Upright note', style },
    ]);
    const out = await extractPdf((await exportPdf(src, state, new Map())).bytes);
    const run = out[0].runs.find((r) => r.text === 'Upright note')!;
    expect(run).toBeTruthy();
    expect(run.x).toBeCloseTo(100, 1);
    expect(run.baseline).toBeCloseTo(80, 1);
  });
});
