import { createContext, useContext, type Dispatch } from 'react';
import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from '../pdf/pdfjs';
import type { ImageHit } from '../lib/pdfAnalysis';
import type { TextRun } from '../lib/textRuns';
import type { FontFamily } from '../lib/fonts';
import type { HistoryAction } from '../state/reducer';
import type { Asset, DocState, TextStyle } from '../state/types';

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'erase' | 'image';

export type Selection =
  | { kind: 'object'; pageId: string; objectId: string }
  | { kind: 'srcImage'; pageId: string; index: number }
  | null;

export interface LoadedDoc {
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  lib: PDFDocument;
  encrypted: boolean;
}

export interface PageData {
  runs: TextRun[];
  images: ImageHit[];
  /** Run id -> font style guessed from the PDF font used by the run's glyphs. */
  runFonts: Map<string, { family: FontFamily; bold: boolean; italic: boolean }>;
}

export interface Defaults {
  text: TextStyle;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  eraseFill: string | null;
}

export interface EditorContextValue {
  doc: LoadedDoc;
  state: DocState;
  dispatch: Dispatch<HistoryAction>;
  canUndo: boolean;
  canRedo: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection;
  setSelection: (s: Selection) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  zoom: number;
  assets: Map<string, Asset>;
  defaults: Defaults;
  setDefaults: (d: Defaults) => void;
  getPageData: (srcIndex: number) => Promise<PageData>;
  /** Canvas for each rendered page, used to sample colors. */
  canvases: Map<string, HTMLCanvasElement>;
  deleteSelection: () => void;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used inside EditorContext');
  return ctx;
}

let counter = 0;
export function uid(prefix = 'o'): string {
  counter++;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}
