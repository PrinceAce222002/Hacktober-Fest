import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { exportPdf } from '../src/lib/exportPdf';
import { analyzePage, getPageView } from '../src/lib/pdfAnalysis';
import { matchRunFonts } from '../src/lib/runFonts';
import type { DocState, TextObject } from '../src/state/types';
import { extractPdf } from './helpers';

// Printed from HTML by headless Chrome: subset TrueType fonts with Identity-H (CID) encoding.
const fixture = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'chrome-invoice.pdf')));

describe('real-world PDF (Chrome print-to-PDF, CID fonts)', () => {
  it('detects fonts of existing runs', async () => {
    const [page] = await extractPdf(fixture);
    const doc = await PDFDocument.load(fixture);
    const analysis = analyzePage(doc, doc.getPage(0));
    expect(analysis.shows.every((s) => s.reliable)).toBe(true);
    const fonts = matchRunFonts(page.runs, analysis.shows);
    const title = page.runs.find((r) => r.text.includes('Invoice'))!;
    expect(fonts.get(title.id)).toMatchObject({ family: 'Helvetica', bold: true });
    const ref = page.runs.find((r) => r.text.includes('ABC-123'))!;
    expect(fonts.get(ref.id)?.family).toBe('Courier');
    const name = page.runs.find((r) => r.text.includes('Jane Smith'))!;
    expect(fonts.get(name.id)).toMatchObject({ family: 'Times', bold: true });
  });

  it('truly removes edited CID-encoded text while leaving the rest of the line in place', async () => {
    const [page] = await extractPdf(fixture);
    const run = page.runs.find((r) => r.text.includes('Jane Smith'))!;
    const neighbour = page.runs.find((r) => r.text.includes('42 Elm Street'))!;
    const lib = await PDFDocument.load(fixture);
    const state: DocState = {
      pages: lib.getPages().map((p, i) => {
        const v = getPageView(p);
        return { id: `p${i}`, srcIndex: i, rotation: 0, width: v.width, height: v.height, objects: [] };
      }),
    };
    const edit: TextObject = {
      id: 'e',
      type: 'text',
      x: run.x,
      baseline: run.baseline,
      text: 'John Doe',
      style: { fontFamily: 'Times', fontSize: run.fontSize, color: '#000000', bold: true, italic: false },
      replaces: { runId: run.id, rect: run.rect, cover: '#ffffff' },
    };
    state.pages[0].objects.push(edit);
    const { bytes, stats } = await exportPdf(fixture, state, new Map());
    expect(stats.coveredRegions).toBe(0);
    expect(stats.removedGlyphs).toBeGreaterThanOrEqual('JaneSmith'.length);
    const [out] = await extractPdf(bytes);
    expect(out.text).not.toContain('Jane');
    expect(out.text).toContain('John Doe');
    expect(out.text).toContain('Invoice #2024-117');
    expect(out.text).toContain('Amount due:');
    const after = out.runs.find((r) => r.text.includes('42 Elm Street'))!;
    expect(after.x).toBeCloseTo(neighbour.x, 1);
  });
});
