import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildTextRuns, type RawTextItem, type TextRun } from '../src/lib/textRuns';
import type { Matrix } from '../src/lib/matrix';

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = join(pdfjsRoot, 'standard_fonts') + '/';

export interface ExtractedPage {
  text: string;
  items: RawTextItem[];
  runs: TextRun[];
  rotation: number;
  width: number;
  height: number;
  viewTransform: Matrix;
  imageCount: number;
}

/** Loads a PDF with pdf.js (as the browser app does) and extracts text per page. */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const task = getDocument({ data: bytes.slice(), useWorkerFetch: false, standardFontDataUrl });
  const pdf = await task.promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter((it) => 'str' in it) as RawTextItem[];
    const ops = await page.getOperatorList();
    const imageOps = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
    const imageCount = ops.fnArray.filter((fn) => imageOps.has(fn)).length;
    pages.push({
      text: items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim(),
      items,
      runs: buildTextRuns(items, viewport.transform as Matrix, `p${i}`),
      rotation: page.rotate,
      width: viewport.width,
      height: viewport.height,
      viewTransform: viewport.transform as Matrix,
      imageCount,
    });
  }
  await task.destroy();
  return pages;
}
