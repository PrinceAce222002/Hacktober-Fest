import type { FontFamily } from '../lib/fonts';
import type { Rect } from '../lib/matrix';

export interface TextStyle {
  fontFamily: FontFamily;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

interface Base {
  id: string;
}

/** New text, or replacement text for an existing run when `replaces` is set. */
export interface TextObject extends Base {
  type: 'text';
  x: number;
  /** Baseline of the first line, in view space. */
  baseline: number;
  text: string;
  style: TextStyle;
  replaces?: {
    runId: string;
    /** Area of the original text whose glyphs are removed from the content stream. */
    rect: Rect;
    /** Background color used to cover the original if it cannot be removed. */
    cover: string;
  };
}

export interface ImageObject extends Base {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  assetId: string;
}

export interface ShapeObject extends Base {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
}

export interface LineObject extends Base {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

/** Eraser / whiteout region: removes underlying text & images and optionally paints a fill. */
export interface EraseObject extends Base {
  type: 'erase';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
}

/** Deletion of an image that exists in the original PDF. */
export interface ImageDeleteObject extends Base {
  type: 'imageDelete';
  rect: Rect;
  cover: string;
}

export type EditorObject = TextObject | ImageObject | ShapeObject | LineObject | EraseObject | ImageDeleteObject;

export interface PageState {
  id: string;
  /** Index of the page in the source PDF, or null for an inserted blank page. */
  srcIndex: number | null;
  /** Rotation added by the user, in degrees (multiple of 90). */
  rotation: number;
  /** Page size in view space (before user rotation). */
  width: number;
  height: number;
  objects: EditorObject[];
}

export interface DocState {
  pages: PageState[];
}

export interface Asset {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  url: string;
  width: number;
  height: number;
}
