import { degrees, PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { Asset, DocState, EditorObject, PageState, TextObject } from '../state/types';
import { hexToRgb } from './color';
import { formatNumber } from './contentStream';
import { LINE_HEIGHT, standardFontName } from './fonts';
import { intersectionArea, invert, rectContainsPoint, type Rect } from './matrix';
import { analyzePage, getPageView, rewriteContent, setPageContent, type PageView } from './pdfAnalysis';

const n = formatNumber;
const KAPPA = 0.5522847498;

function colorOps(hex: string, stroke: boolean): string {
  const [r, g, b] = hexToRgb(hex);
  return `${n(r / 255)} ${n(g / 255)} ${n(b / 255)} ${stroke ? 'RG' : 'rg'}`;
}

function ellipsePath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `${n(cx - rx)} ${n(cy)} m`,
    `${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)} c`,
    `${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)} c`,
    'h',
  ].join('\n');
}

function paintOp(fill: string | null, stroke: string | null, strokeWidth: number): string | null {
  const hasStroke = !!stroke && strokeWidth > 0;
  if (fill && hasStroke) return 'B';
  if (fill) return 'f';
  if (hasStroke) return 'S';
  return null;
}

export interface OverlayResources {
  font(style: TextObject['style']): { name: string; encode(text: string): string };
  image(assetId: string): string | null;
}

/**
 * Builds content-stream operators for editor objects. Coordinates are in view
 * space (y down); the caller wraps the result in a `cm` that maps view space
 * to PDF user space, so text uses a flipped text matrix to stay upright.
 */
export function buildOverlayOps(objects: EditorObject[], res: OverlayResources, covers: Rect[] = [], coverColors: string[] = []): string {
  const out: string[] = [];
  covers.forEach((r, i) => {
    out.push(`q ${colorOps(coverColors[i] ?? '#ffffff', false)} ${n(r.x)} ${n(r.y)} ${n(r.w)} ${n(r.h)} re f Q`);
  });
  for (const o of objects) {
    switch (o.type) {
      case 'erase':
        if (o.fill) out.push(`q ${colorOps(o.fill, false)} ${n(o.x)} ${n(o.y)} ${n(o.w)} ${n(o.h)} re f Q`);
        break;
      case 'rect':
      case 'ellipse': {
        const op = paintOp(o.fill, o.stroke, o.strokeWidth);
        if (!op) break;
        const path = o.type === 'rect' ? `${n(o.x)} ${n(o.y)} ${n(o.w)} ${n(o.h)} re` : ellipsePath(o.x, o.y, o.w, o.h);
        const parts = ['q'];
        if (o.fill) parts.push(colorOps(o.fill, false));
        if (o.stroke) parts.push(colorOps(o.stroke, true), `${n(o.strokeWidth)} w`);
        parts.push(path, op, 'Q');
        out.push(parts.join('\n'));
        break;
      }
      case 'line':
        if (o.strokeWidth > 0) {
          out.push(
            `q ${colorOps(o.stroke, true)} ${n(o.strokeWidth)} w 1 J ${n(o.x1)} ${n(o.y1)} m ${n(o.x2)} ${n(o.y2)} l S Q`,
          );
        }
        break;
      case 'image': {
        const name = res.image(o.assetId);
        if (name) out.push(`q ${n(o.w)} 0 0 ${n(-o.h)} ${n(o.x)} ${n(o.y + o.h)} cm /${name} Do Q`);
        break;
      }
      case 'text': {
        if (!o.text) break;
        const font = res.font(o.style);
        const size = o.style.fontSize;
        const lines = o.text.split('\n');
        const parts = ['q', colorOps(o.style.color, false), 'BT', `/${font.name} ${n(size)} Tf`];
        lines.forEach((line, i) => {
          if (!line) return;
          parts.push(`1 0 0 -1 ${n(o.x)} ${n(o.baseline + i * size * LINE_HEIGHT)} Tm`, `${font.encode(line)} Tj`);
        });
        parts.push('ET', 'Q');
        out.push(parts.join('\n'));
        break;
      }
      case 'imageDelete':
        break;
    }
  }
  return out.join('\n');
}

/** Rectangles whose underlying glyphs should be removed from the original content. */
export function removalRegions(objects: EditorObject[]): Rect[] {
  const regions: Rect[] = [];
  for (const o of objects) {
    if (o.type === 'text' && o.replaces) regions.push(o.replaces.rect);
    if (o.type === 'erase') regions.push({ x: o.x, y: o.y, w: o.w, h: o.h });
  }
  return regions;
}

export function imageMatchesDeletion(img: Rect, target: Rect): boolean {
  const inter = intersectionArea(img, target);
  const union = img.w * img.h + target.w * target.h - inter;
  return union > 0 && inter / union > 0.9;
}

export function imageInsideErase(img: Rect, erase: Rect): boolean {
  const area = img.w * img.h;
  return area > 0 && intersectionArea(img, erase) / area >= 0.9;
}

export interface ExportStats {
  removedGlyphs: number;
  removedImages: number;
  /** Regions that fell back to cover-and-replace because no content could be removed. */
  coveredRegions: number;
}

function sanitizeForFont(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (supported.has(cp)) out += ch;
    else if (cp === 0x2019 || cp === 0x2018) out += "'";
    else if (cp === 0x201c || cp === 0x201d) out += '"';
    else if (cp === 0xa0 || cp === 0x09) out += ' ';
    else out += '?';
  }
  return out;
}

async function applyPageEdits(
  doc: PDFDocument,
  page: PDFPage,
  state: PageState,
  view: PageView,
  assets: Map<string, Asset>,
  fontCache: Map<string, PDFFont>,
  imageCache: Map<string, PDFImage>,
  stats: ExportStats,
): Promise<void> {
  const objects = state.objects;
  const regions = removalRegions(objects);
  const deletions = objects.filter((o) => o.type === 'imageDelete');
  const erases = objects.filter((o) => o.type === 'erase');

  let content: string;
  const regionHits = new Array(regions.length).fill(0);
  const deletionHits = new Array(deletions.length).fill(0);
  try {
    const analysis = analyzePage(doc, page);
    const result = rewriteContent(
      analysis,
      (g) => {
        let hit = false;
        regions.forEach((r, i) => {
          if (rectContainsPoint(r, g.cx, g.cy)) {
            regionHits[i]++;
            hit = true;
          }
        });
        return hit;
      },
      (img) => {
        let hit = false;
        deletions.forEach((d, i) => {
          if (imageMatchesDeletion(img.rect, d.rect)) {
            deletionHits[i]++;
            hit = true;
          }
        });
        return hit || erases.some((e) => imageInsideErase(img.rect, e));
      },
    );
    content = result.content;
    stats.removedGlyphs += result.removedGlyphs;
    stats.removedImages += result.removedImages;
  } catch (err) {
    console.warn('Content stream rewrite failed; falling back to covering', err);
    content = readOriginalSafe(doc, page);
  }

  // Cover-and-replace fallback for edits whose original content could not be removed.
  const covers: Rect[] = [];
  const coverColors: string[] = [];
  let regionIdx = 0;
  for (const o of objects) {
    if (o.type === 'text' && o.replaces) {
      if (regionHits[regionIdx] === 0) {
        covers.push(o.replaces.rect);
        coverColors.push(o.replaces.cover);
      }
      regionIdx++;
    } else if (o.type === 'erase') {
      regionIdx++;
    }
  }
  deletions.forEach((d, i) => {
    if (deletionHits[i] === 0) {
      covers.push(d.rect);
      coverColors.push(d.cover);
    }
  });
  stats.coveredRegions += covers.length;

  const fontKeys = new Map<string, string>();
  const imageKeys = new Map<string, string>();
  const resources: OverlayResources = {
    font: (style) => {
      const std = standardFontName(style.fontFamily, style.bold, style.italic);
      const font = fontCache.get(std)!;
      let key = fontKeys.get(std);
      if (!key) {
        key = page.node.newFontDictionary('PE' + std.replace(/[^A-Za-z]/g, ''), font.ref).decodeText();
        fontKeys.set(std, key);
      }
      return { name: key, encode: (text) => font.encodeText(sanitizeForFont(font, text)).toString() };
    },
    image: (assetId) => {
      const img = imageCache.get(assetId);
      if (!img) return null;
      let key = imageKeys.get(assetId);
      if (!key) {
        key = page.node.newXObject('PEImg', img.ref).decodeText();
        imageKeys.set(assetId, key);
      }
      return key;
    },
  };
  for (const o of objects) {
    if (o.type === 'text') {
      const std = standardFontName(o.style.fontFamily, o.style.bold, o.style.italic);
      if (!fontCache.has(std)) fontCache.set(std, await doc.embedFont(std));
    }
    if (o.type === 'image' && !imageCache.has(o.assetId)) {
      const asset = assets.get(o.assetId);
      if (asset) {
        imageCache.set(
          o.assetId,
          asset.mime === 'image/png' ? await doc.embedPng(asset.bytes) : await doc.embedJpg(asset.bytes),
        );
      }
    }
  }
  const overlay = buildOverlayOps(objects, resources, covers, coverColors);
  const toUser = invert(view.transform).map(n).join(' ');
  setPageContent(doc, page, `q\n${content}\nQ\nq ${toUser} cm\n${overlay}\nQ\n`);
}

function readOriginalSafe(doc: PDFDocument, page: PDFPage): string {
  try {
    return analyzePage(doc, page).content;
  } catch {
    return '';
  }
}

/**
 * Applies all edits to the source PDF and returns the bytes of the edited
 * document. Pages are reordered/rotated/deleted in place so document-level
 * features (metadata, outlines, forms) are preserved.
 */
export async function exportPdf(
  srcBytes: Uint8Array,
  state: DocState,
  assets: Map<string, Asset>,
): Promise<{ bytes: Uint8Array; stats: ExportStats }> {
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
  const original = doc.getPages();
  const stats: ExportStats = { removedGlyphs: 0, removedImages: 0, coveredRegions: 0 };
  const fontCache = new Map<string, PDFFont>();
  const imageCache = new Map<string, PDFImage>();

  const finalPages: { page: PDFPage; state: PageState }[] = [];
  for (const ps of state.pages) {
    let page: PDFPage;
    if (ps.srcIndex === null) {
      page = doc.addPage([ps.width, ps.height]);
    } else {
      page = original[ps.srcIndex];
      if (!page) continue;
    }
    finalPages.push({ page, state: ps });
  }

  for (const { page, state: ps } of finalPages) {
    if (ps.objects.length > 0) {
      const view = getPageView(page);
      await applyPageEdits(doc, page, ps, view, assets, fontCache, imageCache, stats);
    }
  }

  // Rebuild the page tree in the new order.
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  for (const { page, state: ps } of finalPages) {
    if (ps.rotation) page.setRotation(degrees((page.getRotation().angle + ps.rotation) % 360));
    doc.addPage(page);
  }
  doc.setModificationDate(new Date());
  doc.setProducer('PDF Editor (pdf-lib)');
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, stats };
}

