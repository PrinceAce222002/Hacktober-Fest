import { matchFont, type FontFamily } from './fonts';
import { rectContainsPoint } from './matrix';
import type { TextShow } from './pdfAnalysis';
import type { TextRun } from './textRuns';

export type RunFont = { family: FontFamily; bold: boolean; italic: boolean };

/**
 * Determines the PDF font behind each text run (by majority of glyphs whose
 * centers fall inside the run) and maps it to the closest standard font.
 */
export function matchRunFonts(
  runs: TextRun[],
  shows: TextShow[],
  genericFamilies: Map<string, string | undefined> = new Map(),
): Map<string, RunFont> {
  const result = new Map<string, RunFont>();
  for (const run of runs) {
    const votes = new Map<string, number>();
    for (const show of shows) {
      for (const part of show.parts) {
        if (part.kind === 'glyph' && rectContainsPoint(run.rect, part.glyph.cx, part.glyph.cy)) {
          votes.set(show.fontName, (votes.get(show.fontName) ?? 0) + 1);
        }
      }
    }
    let best = '';
    let bestCount = 0;
    for (const [name, count] of votes) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    result.set(run.id, matchFont(best, genericFamilies.get(run.fontName)));
  }
  return result;
}
