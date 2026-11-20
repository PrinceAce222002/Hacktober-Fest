import { StandardFonts } from 'pdf-lib';

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

export const FONT_FAMILIES: { value: FontFamily; label: string }[] = [
  { value: 'Helvetica', label: 'Sans (Helvetica)' },
  { value: 'Times', label: 'Serif (Times)' },
  { value: 'Courier', label: 'Mono (Courier)' },
];

export const LINE_HEIGHT = 1.2;

/** CSS font stacks that are metric-compatible with the PDF standard fonts. */
export const CSS_FONT: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** Ascent/descent (em) of the browser fonts above, used to align HTML text with PDF baselines. */
const CSS_METRICS: Record<FontFamily, { ascent: number; descent: number }> = {
  Helvetica: { ascent: 0.905, descent: 0.212 },
  Times: { ascent: 0.891, descent: 0.216 },
  Courier: { ascent: 0.833, descent: 0.3 },
};

/** Distance from the top of a CSS line box (line-height 1.2) to the text baseline. */
export function baselineOffset(family: FontFamily, size: number): number {
  const { ascent, descent } = CSS_METRICS[family];
  return ((LINE_HEIGHT - (ascent + descent)) / 2 + ascent) * size;
}

export function standardFontName(family: FontFamily, bold: boolean, italic: boolean): StandardFonts {
  switch (family) {
    case 'Times':
      return bold
        ? italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold
        : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
    case 'Courier':
      return bold
        ? italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold
        : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
    default:
      return bold
        ? italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold
        : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
  }
}

/**
 * Guesses the closest standard family and style for an embedded PDF font,
 * from its PostScript name (e.g. "ABCDEF+TimesNewRomanPS-BoldItalicMT") and
 * the generic CSS family pdf.js reports.
 */
export function matchFont(
  fontName: string,
  genericFamily?: string,
): { family: FontFamily; bold: boolean; italic: boolean } {
  const name = fontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|[-,]bd\b|\bcmbx/.test(name);
  const italic = /italic|oblique|[-,]it\b|\bcmti|\bcmsl/.test(name);
  let family: FontFamily = 'Helvetica';
  if (/courier|mono|consol|menlo|cmtt|inconsolata|code|typewriter/.test(name)) family = 'Courier';
  else if (
    /times|serif(?!.*sans)|roman|georgia|garamond|cambria|minion|palatino|book|cmr|cmbx|cmti|nimbusrom|caslon|baskerville|charter|tinos|liberationserif/.test(
      name,
    ) &&
    !/sans/.test(name)
  )
    family = 'Times';
  else if (!/sans|arial|helvetica|verdana|calibri|segoe|roboto|open|lato|inter/.test(name)) {
    if (genericFamily === 'serif') family = 'Times';
    else if (genericFamily === 'monospace') family = 'Courier';
  }
  return { family, bold, italic };
}
