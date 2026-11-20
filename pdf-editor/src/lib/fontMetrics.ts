import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';

/** Width/encoding information for a PDF font, enough to lay out glyph positions. */
export interface FontInfo {
  /** Bytes per character code (1 for simple fonts, 2 for Identity CMaps). */
  bytesPerCode: 1 | 2;
  /** Glyph advance for a character code, in text space units per 1pt font size. */
  widthOf(code: number): number;
  /** False when widths are guessed (e.g. unusual CMaps or missing metrics). */
  reliable: boolean;
  /** PostScript name from /BaseFont (may be empty). */
  baseFont: string;
}

const winAnsiCodeToName = new Map<number, string>();
for (const cp of Encodings.WinAnsi.supportedCodePoints) {
  const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
  if (!winAnsiCodeToName.has(code)) winAnsiCodeToName.set(code, name);
}

const standardFontCache = new Map<string, Font>();

/** Maps a PDF BaseFont name (possibly subset-prefixed or a common alias) to a standard 14 font. */
export function standardFontFor(baseFont: string): FontNames | null {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '');
  const lower = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(lower);
  const italic = /italic|oblique/.test(lower);
  if (lower.startsWith('symbol')) return FontNames.Symbol;
  if (lower.startsWith('zapfdingbats')) return FontNames.ZapfDingbats;
  if (/courier/.test(lower)) {
    return bold
      ? italic ? FontNames.CourierBoldOblique : FontNames.CourierBold
      : italic ? FontNames.CourierOblique : FontNames.Courier;
  }
  if (/times/.test(lower)) {
    return bold
      ? italic ? FontNames.TimesRomanBoldItalic : FontNames.TimesRomanBold
      : italic ? FontNames.TimesRomanItalic : FontNames.TimesRoman;
  }
  if (/helvetica|arial/.test(lower)) {
    return bold
      ? italic ? FontNames.HelveticaBoldOblique : FontNames.HelveticaBold
      : italic ? FontNames.HelveticaOblique : FontNames.Helvetica;
  }
  return null;
}

function loadStandardFont(name: FontNames): Font {
  let font = standardFontCache.get(name);
  if (!font) {
    font = Font.load(name);
    standardFontCache.set(name, font);
  }
  return font;
}

function num(doc: PDFDocument, obj: PDFObject | undefined, fallback = 0): number {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

function arr(doc: PDFDocument, obj: PDFObject | undefined): PDFArray | undefined {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFArray ? v : undefined;
}

function dict(doc: PDFDocument, obj: PDFObject | undefined): PDFDict | undefined {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFDict ? v : undefined;
}

function nameOf(doc: PDFDocument, obj: PDFObject | undefined): string | undefined {
  const v = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  return v instanceof PDFName ? v.decodeText() : undefined;
}

const FALLBACK_FONT: FontInfo = { bytesPerCode: 1, widthOf: () => 0.5, reliable: false, baseFont: '' };

export function loadFontInfo(doc: PDFDocument, fontObj: PDFObject | undefined): FontInfo {
  const font = dict(doc, fontObj);
  if (!font) return FALLBACK_FONT;
  const subtype = nameOf(doc, font.get(PDFName.of('Subtype')));
  const baseFont = nameOf(doc, font.get(PDFName.of('BaseFont'))) ?? '';

  if (subtype === 'Type0') {
    const encoding = nameOf(doc, font.get(PDFName.of('Encoding')));
    const descendants = arr(doc, font.get(PDFName.of('DescendantFonts')));
    const cid = descendants ? dict(doc, descendants.get(0)) : undefined;
    const dw = cid ? num(doc, cid.get(PDFName.of('DW')), 1000) : 1000;
    const widths = new Map<number, number>();
    const w = cid ? arr(doc, cid.get(PDFName.of('W'))) : undefined;
    if (w) {
      let i = 0;
      while (i < w.size()) {
        const first = num(doc, w.get(i));
        const next = w.get(i + 1);
        const nextArr = arr(doc, next);
        if (nextArr) {
          for (let k = 0; k < nextArr.size(); k++) widths.set(first + k, num(doc, nextArr.get(k)));
          i += 2;
        } else {
          const last = num(doc, next);
          const width = num(doc, w.get(i + 2));
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, width);
          i += 3;
        }
      }
    }
    return {
      bytesPerCode: 2,
      widthOf: (code) => (widths.get(code) ?? dw) / 1000,
      reliable: encoding === 'Identity-H' || encoding === 'Identity-V',
      baseFont,
    };
  }

  const isType3 = subtype === 'Type3';
  let scale = 0.001;
  if (isType3) {
    const fm = arr(doc, font.get(PDFName.of('FontMatrix')));
    scale = fm ? num(doc, fm.get(0), 0.001) : 0.001;
  }

  const widthsArr = arr(doc, font.get(PDFName.of('Widths')));
  if (widthsArr) {
    const firstChar = num(doc, font.get(PDFName.of('FirstChar')));
    const widths: number[] = [];
    for (let i = 0; i < widthsArr.size(); i++) widths.push(num(doc, widthsArr.get(i)));
    const descriptor = dict(doc, font.get(PDFName.of('FontDescriptor')));
    const missing = descriptor ? num(doc, descriptor.get(PDFName.of('MissingWidth'))) : 0;
    return {
      bytesPerCode: 1,
      widthOf: (code) => {
        const w = widths[code - firstChar];
        return (w ?? missing) * scale;
      },
      reliable: true,
      baseFont,
    };
  }

  const std = standardFontFor(baseFont);
  if (std) {
    const metrics = loadStandardFont(std);
    let codeToName = winAnsiCodeToName;
    if (std === FontNames.Symbol || std === FontNames.ZapfDingbats) {
      const enc = std === FontNames.Symbol ? Encodings.Symbol : Encodings.ZapfDingbats;
      codeToName = new Map();
      for (const cp of enc.supportedCodePoints) {
        const { code, name } = enc.encodeUnicodeCodePoint(cp);
        codeToName.set(code, name);
      }
    }
    return {
      bytesPerCode: 1,
      widthOf: (code) => {
        const glyph = codeToName.get(code);
        const w = glyph ? metrics.getWidthOfGlyph(glyph) : undefined;
        return (typeof w === 'number' ? w : 500) / 1000;
      },
      reliable: true,
      baseFont,
    };
  }
  return { ...FALLBACK_FONT, baseFont };
}
