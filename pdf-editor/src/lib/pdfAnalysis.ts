import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import {
  binaryStringToBytes,
  bytesToBinaryString,
  formatNumber,
  parseContentStream,
  toHexString,
  type ContentOp,
  type Operand,
} from './contentStream';
import { loadFontInfo, type FontInfo } from './fontMetrics';
import { IDENTITY, multiply, transformRect, viewportTransform, type Matrix, type Rect } from './matrix';

/** A single glyph drawn by a text-showing operator, positioned in view space. */
export interface GlyphHit {
  /** Raw character code bytes. */
  bytes: string;
  /** Glyph bounding box in view space (pt, top-left origin). */
  rect: Rect;
  cx: number;
  cy: number;
  /** Equivalent TJ adjustment (thousandths of text space) to skip this glyph. */
  skip: number;
}

type ShowPart = { kind: 'glyph'; glyph: GlyphHit } | { kind: 'num'; value: number };

export interface TextShow {
  opIndex: number;
  parts: ShowPart[];
  /** Whether glyph geometry could be computed with real font metrics. */
  reliable: boolean;
  /** /BaseFont of the font used, e.g. "ABCDEF+Arial-BoldMT". */
  fontName: string;
  /** Effective font size in view space. */
  fontSize: number;
}

export interface ImageHit {
  opIndex: number;
  /** Bounding box in view space. */
  rect: Rect;
  inline: boolean;
}

export interface PageView {
  width: number;
  height: number;
  /** PDF user space -> view space (pdf.js viewport at scale 1). */
  transform: Matrix;
}

export interface PageAnalysis {
  view: PageView;
  content: string;
  ops: ContentOp[];
  shows: TextShow[];
  images: ImageHit[];
}

export function getPageView(page: PDFPage): PageView {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x1 = Math.max(media.x, crop.x);
  const y1 = Math.max(media.y, crop.y);
  const x2 = Math.min(media.x + media.width, crop.x + crop.width);
  const y2 = Math.min(media.y + media.height, crop.y + crop.height);
  const box: [number, number, number, number] =
    x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : [media.x, media.y, media.x + media.width, media.y + media.height];
  const { transform, width, height } = viewportTransform(box, page.getRotation().angle);
  return { transform, width, height };
}

function decodeStream(stream: PDFObject | undefined): string {
  if (stream instanceof PDFRawStream) return bytesToBinaryString(decodePDFRawStream(stream).decode());
  if (stream instanceof PDFStream) {
    const s = stream as PDFStream & { getUnencodedContents?: () => Uint8Array };
    if (typeof s.getUnencodedContents === 'function') return bytesToBinaryString(s.getUnencodedContents());
    return bytesToBinaryString(s.getContents());
  }
  return '';
}

/** Returns the page's decoded content (all content streams joined). */
export function readPageContent(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (resolved instanceof PDFArray) {
    const parts: string[] = [];
    for (let i = 0; i < resolved.size(); i++) parts.push(decodeStream(doc.context.lookup(resolved.get(i))));
    return parts.join('\n');
  }
  return decodeStream(resolved);
}

interface TextParams {
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  fontKey: string | null;
  fontSize: number;
  rise: number;
}

interface GState {
  ctm: Matrix;
  text: TextParams;
}

function numArg(args: Operand[], i: number): number {
  const a = args[i];
  return a && a.type === 'num' ? a.value : 0;
}

function lookupDict(doc: PDFDocument, obj: PDFObject | undefined): PDFDict | undefined {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFDict ? v : undefined;
}

/**
 * Interprets the page content stream, recording every glyph drawn by text
 * operators and every image painted directly on the page.
 */
export function analyzePage(doc: PDFDocument, page: PDFPage): PageAnalysis {
  const view = getPageView(page);
  const content = readPageContent(doc, page);
  const ops = parseContentStream(content);
  const resources = page.node.Resources();
  const fontsDict = resources ? lookupDict(doc, resources.get(PDFName.of('Font'))) : undefined;
  const xobjects = resources ? lookupDict(doc, resources.get(PDFName.of('XObject'))) : undefined;
  const fontCache = new Map<string, FontInfo>();
  const getFont = (key: string | null): FontInfo => {
    const k = key ?? '';
    let f = fontCache.get(k);
    if (!f) {
      f = loadFontInfo(doc, key && fontsDict ? fontsDict.get(PDFName.of(key)) : undefined);
      fontCache.set(k, f);
    }
    return f;
  };

  let gs: GState = {
    ctm: IDENTITY,
    text: { charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, fontKey: null, fontSize: 0, rise: 0 },
  };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  const shows: TextShow[] = [];
  const images: ImageHit[] = [];

  const toView = (m: Matrix) => multiply(m, view.transform);

  const showString = (bytes: string, parts: ShowPart[], font: FontInfo) => {
    const t = gs.text;
    const fs = t.fontSize;
    const step = font.bytesPerCode;
    for (let i = 0; i + step <= bytes.length; i += step) {
      const code = step === 2 ? (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1) : bytes.charCodeAt(i);
      const w0 = font.widthOf(code);
      const wordSpace = step === 1 && code === 32 ? t.wordSpacing : 0;
      const trm = multiply(multiply([fs * t.hScale, 0, 0, fs, 0, t.rise], tm), gs.ctm);
      const rect = transformRect(toView(trm), 0, -0.2, Math.max(w0, 0.05), 0.8);
      const tx = (w0 * fs + t.charSpacing + wordSpace) * t.hScale;
      parts.push({
        kind: 'glyph',
        glyph: {
          bytes: bytes.slice(i, i + step),
          rect,
          cx: rect.x + rect.w / 2,
          cy: rect.y + rect.h / 2,
          skip: fs !== 0 ? (-(w0 * fs + t.charSpacing + wordSpace) * 1000) / fs : 0,
        },
      });
      tm = multiply([1, 0, 0, 1, tx, 0], tm);
    }
  };

  const nextLine = () => {
    tlm = multiply([1, 0, 0, 1, 0, -gs.text.leading], tlm);
    tm = tlm;
  };

  ops.forEach((op, opIndex) => {
    const a = op.args;
    switch (op.op) {
      case 'q':
        stack.push({ ctm: gs.ctm, text: { ...gs.text } });
        break;
      case 'Q':
        if (stack.length) gs = stack.pop()!;
        break;
      case 'cm':
        gs.ctm = multiply(
          [numArg(a, 0), numArg(a, 1), numArg(a, 2), numArg(a, 3), numArg(a, 4), numArg(a, 5)],
          gs.ctm,
        );
        break;
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tc':
        gs.text.charSpacing = numArg(a, 0);
        break;
      case 'Tw':
        gs.text.wordSpacing = numArg(a, 0);
        break;
      case 'Tz':
        gs.text.hScale = numArg(a, 0) / 100;
        break;
      case 'TL':
        gs.text.leading = numArg(a, 0);
        break;
      case 'Ts':
        gs.text.rise = numArg(a, 0);
        break;
      case 'Tf': {
        const name = a[0];
        gs.text.fontKey = name && name.type === 'name' ? name.value : null;
        gs.text.fontSize = numArg(a, 1);
        break;
      }
      case 'Td':
        tlm = multiply([1, 0, 0, 1, numArg(a, 0), numArg(a, 1)], tlm);
        tm = tlm;
        break;
      case 'TD':
        gs.text.leading = -numArg(a, 1);
        tlm = multiply([1, 0, 0, 1, numArg(a, 0), numArg(a, 1)], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [numArg(a, 0), numArg(a, 1), numArg(a, 2), numArg(a, 3), numArg(a, 4), numArg(a, 5)];
        tm = tlm;
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj':
      case "'":
      case '"':
      case 'TJ': {
        if (op.op === '"') {
          gs.text.wordSpacing = numArg(a, 0);
          gs.text.charSpacing = numArg(a, 1);
        }
        if (op.op === "'" || op.op === '"') nextLine();
        const font = getFont(gs.text.fontKey);
        const parts: ShowPart[] = [];
        if (op.op === 'TJ') {
          const arr = a[0];
          if (arr && arr.type === 'arr') {
            for (const item of arr.items) {
              if (item.type === 'str') showString(item.value, parts, font);
              else if (item.type === 'num') {
                parts.push({ kind: 'num', value: item.value });
                tm = multiply([1, 0, 0, 1, (-item.value / 1000) * gs.text.fontSize * gs.text.hScale, 0], tm);
              }
            }
          }
        } else {
          const s = a[a.length - 1];
          if (s && s.type === 'str') showString(s.value, parts, font);
        }
        const scaleY = toView(multiply(tm, gs.ctm));
        shows.push({
          opIndex,
          parts,
          reliable: font.reliable,
          fontName: font.baseFont,
          fontSize: Math.abs(gs.text.fontSize) * Math.hypot(scaleY[2], scaleY[3]),
        });
        break;
      }
      case 'Do': {
        const name = a[0];
        if (!name || name.type !== 'name' || !xobjects) break;
        const xobj = doc.context.lookup(xobjects.get(PDFName.of(name.value)));
        const subtype = xobj instanceof PDFStream ? xobj.dict.get(PDFName.of('Subtype')) : undefined;
        if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
          images.push({ opIndex, rect: transformRect(toView(gs.ctm), 0, 0, 1, 1), inline: false });
        }
        break;
      }
      case 'BI':
        images.push({ opIndex, rect: transformRect(toView(gs.ctm), 0, 0, 1, 1), inline: true });
        break;
    }
  });

  return { view, content, ops, shows, images };
}

export interface RewriteResult {
  content: string;
  removedGlyphs: number;
  removedImages: number;
  /** Glyphs that matched a removal predicate but could not be removed safely. */
  skippedGlyphs: number;
}

/**
 * Produces a new content stream with the selected glyphs and images removed.
 * Removed glyphs are replaced with equivalent TJ position adjustments so that
 * the remaining text keeps its exact position.
 */
export function rewriteContent(
  analysis: PageAnalysis,
  shouldRemoveGlyph: (g: GlyphHit) => boolean,
  shouldRemoveImage: (img: ImageHit) => boolean,
): RewriteResult {
  const replacements = new Map<number, string>();
  let removedGlyphs = 0;
  let removedImages = 0;
  let skippedGlyphs = 0;

  for (const show of analysis.shows) {
    const marks = show.parts.map((p) => p.kind === 'glyph' && shouldRemoveGlyph(p.glyph));
    const count = marks.filter(Boolean).length;
    if (count === 0) continue;
    const canRewrite =
      show.reliable && show.parts.every((p) => p.kind !== 'glyph' || Number.isFinite(p.glyph.skip));
    if (!canRewrite) {
      skippedGlyphs += count;
      continue;
    }
    removedGlyphs += count;
    const op = analysis.ops[show.opIndex];
    const items: string[] = [];
    let pendingStr = '';
    let pendingNum = 0;
    const flushStr = () => {
      if (pendingStr) items.push(toHexString(pendingStr));
      pendingStr = '';
    };
    const flushNum = () => {
      if (pendingNum !== 0) items.push(formatNumber(pendingNum));
      pendingNum = 0;
    };
    show.parts.forEach((part, i) => {
      if (part.kind === 'num') {
        flushStr();
        pendingNum += part.value;
      } else if (marks[i]) {
        flushStr();
        pendingNum += part.glyph.skip;
      } else {
        flushNum();
        pendingStr += part.glyph.bytes;
      }
    });
    flushStr();
    flushNum();
    let prefix = '';
    if (op.op === "'") prefix = 'T* ';
    if (op.op === '"') prefix = `${formatNumber(numArg(op.args, 0))} Tw ${formatNumber(numArg(op.args, 1))} Tc T* `;
    replacements.set(show.opIndex, `${prefix}[${items.join(' ')}] TJ`);
  }

  for (const img of analysis.images) {
    if (shouldRemoveImage(img)) {
      replacements.set(img.opIndex, '');
      removedImages++;
    }
  }

  if (replacements.size === 0) {
    return { content: analysis.content, removedGlyphs, removedImages, skippedGlyphs };
  }
  let out = '';
  let cursor = 0;
  analysis.ops.forEach((op, i) => {
    const rep = replacements.get(i);
    if (rep === undefined) return;
    out += analysis.content.slice(cursor, op.start) + rep;
    cursor = op.end;
  });
  out += analysis.content.slice(cursor);
  return { content: out, removedGlyphs, removedImages, skippedGlyphs };
}

/** Replaces a page's content streams with a single (Flate-compressed) stream. */
export function setPageContent(doc: PDFDocument, page: PDFPage, content: string): void {
  const stream = doc.context.flateStream(binaryStringToBytes(content));
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
}
