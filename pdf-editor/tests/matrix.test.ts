import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyToPoint, invert, multiply, transformRect, viewportTransform, type Matrix } from '../src/lib/matrix';
import { getPageView } from '../src/lib/pdfAnalysis';
import { extractPdf } from './helpers';

describe('matrix', () => {
  it('multiplies in PDF order and inverts', () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const translate: Matrix = [1, 0, 0, 1, 10, 5];
    expect(applyToPoint(multiply(scale, translate), 1, 1)).toEqual([12, 7]);
    const m: Matrix = [0, 1, -1, 0, 30, 40];
    const p = applyToPoint(m, 3, 4);
    const back = applyToPoint(invert(m), p[0], p[1]);
    expect(back[0]).toBeCloseTo(3);
    expect(back[1]).toBeCloseTo(4);
  });

  it('computes transformed bounding boxes', () => {
    expect(transformRect([0, 1, -1, 0, 0, 0], 0, 0, 2, 1)).toEqual({ x: -1, y: 0, w: 1, h: 2 });
  });

  it('matches pdf.js viewports for every page rotation', async () => {
    const doc = await PDFDocument.create();
    for (const rot of [0, 90, 180, 270]) {
      const page = doc.addPage([300, 500]);
      page.setMediaBox(10, 20, 300, 500);
      page.setRotation({ type: 'degrees', angle: rot } as never);
    }
    const bytes = await doc.save();
    const pages = await extractPdf(bytes);
    const reloaded = await PDFDocument.load(bytes);
    pages.forEach((p, i) => {
      const view = getPageView(reloaded.getPage(i));
      expect(view.width).toBeCloseTo(p.width);
      expect(view.height).toBeCloseTo(p.height);
      view.transform.forEach((v, k) => expect(v).toBeCloseTo(p.viewTransform[k]));
    });
    expect(viewportTransform([0, 0, 100, 200], 90).width).toBe(200);
  });
});
