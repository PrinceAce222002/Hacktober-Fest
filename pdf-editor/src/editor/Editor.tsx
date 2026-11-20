import {
  Circle,
  Download,
  Eraser,
  FileUp,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Slash,
  Square,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { exportPdf } from '../lib/exportPdf';
import { analyzePage } from '../lib/pdfAnalysis';
import { matchRunFonts } from '../lib/runFonts';
import { buildTextRuns, type RawTextItem } from '../lib/textRuns';
import type { Matrix } from '../lib/matrix';
import { canRedo, canUndo, createHistory } from '../state/history';
import { historyReducer } from '../state/reducer';
import type { Asset, DocState } from '../state/types';
import {
  EditorContext,
  uid,
  type Defaults,
  type EditorContextValue,
  type LoadedDoc,
  type PageData,
  type Selection,
  type Tool,
} from './context';
import { PageView } from './PageView';
import { PropertiesPanel } from './PropertiesPanel';
import { Sidebar } from './Sidebar';

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select / edit text', key: 'v', icon: <MousePointer2 size={18} /> },
  { id: 'text', label: 'Add text', key: 't', icon: <Type size={18} /> },
  { id: 'image', label: 'Add image', key: 'i', icon: <ImagePlus size={18} /> },
  { id: 'rect', label: 'Rectangle', key: 'r', icon: <Square size={18} /> },
  { id: 'ellipse', label: 'Ellipse', key: 'o', icon: <Circle size={18} /> },
  { id: 'line', label: 'Line', key: 'l', icon: <Slash size={18} /> },
  { id: 'erase', label: 'Eraser / whiteout', key: 'e', icon: <Eraser size={18} /> },
];

async function fileToAsset(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mime: Asset['mime'] = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') {
    // Convert other formats (webp, gif, svg, bmp...) to PNG, which pdf-lib can embed.
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG conversion failed'))), 'image/png'));
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = 'image/png';
  }
  return { bytes, mime, url, width: img.naturalWidth, height: img.naturalHeight };
}

interface Props {
  doc: LoadedDoc;
  initial: DocState;
  onClose: () => void;
}

export function Editor({ doc, initial, onClose }: Props) {
  const [history, dispatch] = useReducer(historyReducer, initial, createHistory);
  const state = history.present;
  const [tool, setToolState] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [defaults, setDefaults] = useState<Defaults>({
    text: { fontFamily: 'Helvetica', fontSize: 14, color: '#111827', bold: false, italic: false },
    stroke: '#2563eb',
    fill: null,
    strokeWidth: 2,
    eraseFill: '#ffffff',
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const assets = useRef(new Map<string, Asset>()).current;
  const canvases = useRef(new Map<string, HTMLCanvasElement>()).current;
  const pageDataCache = useRef(new Map<number, Promise<PageData>>()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fit page width on load.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxW = Math.max(...initial.pages.map((p) => p.width));
    const fit = (el.clientWidth - 64) / maxW;
    setZoom(Math.max(0.5, Math.min(1.5, Math.round(fit * 20) / 20)));
  }, [initial]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const getPageData = useCallback(
    (srcIndex: number): Promise<PageData> => {
      let p = pageDataCache.get(srcIndex);
      if (!p) {
        p = (async () => {
          const page = await doc.pdf.getPage(srcIndex + 1);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          const items = content.items.filter((i) => 'str' in i) as RawTextItem[];
          const runs = buildTextRuns(items, viewport.transform as Matrix, `s${srcIndex}`);
          let images: PageData['images'] = [];
          let runFonts: PageData['runFonts'] = new Map();
          try {
            const analysis = analyzePage(doc.lib, doc.lib.getPage(srcIndex));
            images = analysis.images.filter((im) => im.rect.w > 2 && im.rect.h > 2);
            const generics = new Map(Object.entries(content.styles).map(([k, v]) => [k, v.fontFamily]));
            runFonts = matchRunFonts(runs, analysis.shows, generics);
          } catch (err) {
            console.warn('Could not analyze page content', err);
          }
          return { runs, images, runFonts };
        })();
        pageDataCache.set(srcIndex, p);
      }
      return p;
    },
    [doc, pageDataCache],
  );

  const setTool = useCallback((t: Tool) => {
    if (t === 'image') {
      fileInputRef.current?.click();
      return;
    }
    setToolState(t);
    setSelection(null);
  }, []);

  const currentPageIndex = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    const shells = Array.from(el.querySelectorAll<HTMLElement>('.page-shell'));
    const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
    let best = 0;
    shells.forEach((s, i) => {
      if (s.getBoundingClientRect().top <= mid) best = i;
    });
    return best;
  };

  const insertImage = async (file: File) => {
    try {
      const asset = await fileToAsset(file);
      const assetId = uid('asset');
      assets.set(assetId, asset);
      const page = state.pages[currentPageIndex()];
      const maxW = page.width * 0.5;
      const maxH = page.height * 0.4;
      const scale = Math.min(1, maxW / asset.width, maxH / asset.height);
      const w = asset.width * scale;
      const h = asset.height * scale;
      const id = uid('image');
      dispatch({
        type: 'addObject',
        pageId: page.id,
        object: { id, type: 'image', x: (page.width - w) / 2, y: (page.height - h) / 3, w, h, assetId },
      });
      setToolState('select');
      setSelection({ kind: 'object', pageId: page.id, objectId: id });
    } catch (err) {
      console.error(err);
      setToast('Could not read that image file.');
    }
  };

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'srcImage') {
      getPageData(state.pages.find((p) => p.id === selection.pageId)?.srcIndex ?? -1)
        .then((data) => {
          const img = data.images[selection.index];
          if (!img) return;
          const canvas = canvases.get(selection.pageId);
          let cover = '#ffffff';
          if (canvas) {
            const page = state.pages.find((p) => p.id === selection.pageId)!;
            const s = canvas.width / page.width;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const px = ctx?.getImageData(Math.max(0, Math.floor((img.rect.x - 3) * s)), Math.max(0, Math.floor((img.rect.y - 3) * s)), 1, 1).data;
            if (px) cover = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
          }
          dispatch({ type: 'addObject', pageId: selection.pageId, object: { id: uid('imgdel'), type: 'imageDelete', rect: img.rect, cover } });
        })
        .catch(console.error);
    } else {
      dispatch({ type: 'removeObject', pageId: selection.pageId, id: selection.objectId });
    }
    setSelection(null);
    setEditingId(null);
  }, [selection, state.pages, getPageData, canvases]);

  // Drop selection if its object disappeared (e.g. after undo).
  useEffect(() => {
    if (selection?.kind !== 'object') return;
    const page = state.pages.find((p) => p.id === selection.pageId);
    if (!page || !page.objects.some((o) => o.id === selection.objectId)) {
      setSelection(null);
      setEditingId(null);
    }
  }, [state, selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection) {
          e.preventDefault();
          const page = state.pages.find((p) => p.id === selection.pageId);
          const obj = selection.kind === 'object' ? page?.objects.find((o) => o.id === selection.objectId) : undefined;
          if (obj?.type === 'text' && obj.replaces) {
            dispatch({ type: 'updateObject', pageId: selection.pageId, id: obj.id, patch: { text: '' } });
          } else {
            deleteSelection();
          }
        }
      } else if (e.key === 'Escape') {
        setSelection(null);
        setToolState('select');
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, state.pages, deleteSelection, setTool]);

  const download = async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const { bytes, stats } = await exportPdf(doc.bytes, state, assets);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = doc.name.replace(/\.pdf$/i, '') + '-edited.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const parts = [`Saved ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}`];
      if (stats.removedGlyphs) parts.push(`${stats.removedGlyphs} original characters removed`);
      if (stats.removedImages) parts.push(`${stats.removedImages} image${stats.removedImages === 1 ? '' : 's'} removed`);
      if (stats.coveredRegions) parts.push(`${stats.coveredRegions} area${stats.coveredRegions === 1 ? '' : 's'} covered (fallback)`);
      setToast(parts.join(' · '));
    } catch (err) {
      console.error(err);
      setToast(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const jumpTo = (i: number) => {
    const el = scrollRef.current?.querySelectorAll<HTMLElement>('.page-shell')[i];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const ctx: EditorContextValue = useMemo(
    () => ({
      doc,
      state,
      dispatch,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      tool,
      setTool,
      selection,
      setSelection,
      editingId,
      setEditingId,
      zoom,
      assets,
      defaults,
      setDefaults,
      getPageData,
      canvases,
      deleteSelection,
    }),
    [doc, state, history, tool, setTool, selection, editingId, zoom, assets, defaults, getPageData, canvases, deleteSelection],
  );

  const totalEdits = state.pages.reduce((n, p) => n + p.objects.length, 0);

  return (
    <EditorContext.Provider value={ctx}>
      <div className="editor">
        <header className="topbar">
          <div className="brand">
            <div className="logo">P</div>
            <div className="file-meta">
              <strong title={doc.name}>{doc.name}</strong>
              <span className="muted small">
                {state.pages.length} pages · {totalEdits} edit{totalEdits === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="tools" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`tool${tool === t.id ? ' active' : ''}`}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key.toUpperCase()})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                data-tool={t.id}
              >
                {t.icon}
              </button>
            ))}
            <span className="divider" />
            <button className="tool" onClick={() => dispatch({ type: 'undo' })} disabled={!ctx.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 size={18} />
            </button>
            <button className="tool" onClick={() => dispatch({ type: 'redo' })} disabled={!ctx.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Redo2 size={18} />
            </button>
            <span className="divider" />
            <button className="tool" onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 10) / 10))} title="Zoom out" aria-label="Zoom out">
              <Minus size={18} />
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="tool" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10))} title="Zoom in" aria-label="Zoom in">
              <Plus size={18} />
            </button>
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose} title="Open another PDF">
              <FileUp size={16} /> Open
            </button>
            <button className="btn btn-primary" onClick={download} disabled={busy} data-testid="download">
              {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />} Download PDF
            </button>
          </div>
        </header>
        {doc.encrypted && (
          <div className="banner">This PDF is encrypted. Rendering works, but saved edits may not open correctly.</div>
        )}
        <div className="workspace">
          <Sidebar onJump={jumpTo} />
          <main className="canvas-area" ref={scrollRef}>
            <div className="pages">
              {state.pages.map((p, i) => (
                <PageView key={p.id} page={p} index={i} />
              ))}
            </div>
          </main>
          <PropertiesPanel />
        </div>
        {toast && (
          <div className="toast" role="status" data-testid="toast">
            {toast}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="image-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) insertImage(f);
            e.target.value = '';
          }}
        />
      </div>
    </EditorContext.Provider>
  );
}
