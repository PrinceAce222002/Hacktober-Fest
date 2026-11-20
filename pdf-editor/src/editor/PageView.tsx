import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sampleColors } from '../lib/color';
import { imageMatchesDeletion } from '../lib/exportPdf';
import { baselineOffset } from '../lib/fonts';
import { normalizeRect, type Rect } from '../lib/matrix';
import type { TextRun } from '../lib/textRuns';
import type { EditorObject, PageState, TextObject } from '../state/types';
import { uid, useEditor, type PageData } from './context';
import { rotatedSize, rotationTransform, unrotatePoint } from './geometry';
import { ObjectView, type HandleKind } from './ObjectView';

type Gesture =
  | { type: 'draw'; x0: number; y0: number }
  | {
      type: 'edit';
      handle: HandleKind;
      x0: number;
      y0: number;
      orig: EditorObject;
      key: string;
      moved: boolean;
      wasSelected: boolean;
    };

const DRAW_TOOLS = new Set(['rect', 'ellipse', 'line', 'erase']);

function sampleRegion(canvas: HTMLCanvasElement | undefined, pageWidth: number, r: Rect) {
  if (!canvas || !canvas.width) return { background: '#ffffff', foreground: '#000000' };
  const s = canvas.width / pageWidth;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { background: '#ffffff', foreground: '#000000' };
  const x = Math.max(0, Math.floor(r.x * s));
  const y = Math.max(0, Math.floor(r.y * s));
  const w = Math.max(2, Math.min(canvas.width - x, Math.ceil(r.w * s)));
  const h = Math.max(2, Math.min(canvas.height - y, Math.ceil(r.h * s)));
  try {
    const img = ctx.getImageData(x, y, w, h);
    return sampleColors(img, 0, 0, w - 1, h - 1);
  } catch {
    return { background: '#ffffff', foreground: '#000000' };
  }
}

function resizeBox(orig: { x: number; y: number; w: number; h: number }, handle: HandleKind, dx: number, dy: number, keepAspect: boolean): Rect {
  const right = orig.x + orig.w;
  const bottom = orig.y + orig.h;
  let anchor: [number, number];
  let moving: [number, number];
  switch (handle) {
    case 'nw':
      anchor = [right, bottom];
      moving = [orig.x + dx, orig.y + dy];
      break;
    case 'ne':
      anchor = [orig.x, bottom];
      moving = [right + dx, orig.y + dy];
      break;
    case 'sw':
      anchor = [right, orig.y];
      moving = [orig.x + dx, bottom + dy];
      break;
    default:
      anchor = [orig.x, orig.y];
      moving = [right + dx, bottom + dy];
  }
  const r = normalizeRect(anchor[0], anchor[1], moving[0], moving[1]);
  r.w = Math.max(r.w, 2);
  r.h = Math.max(r.h, 2);
  if (keepAspect && orig.w > 0) {
    r.h = (r.w * orig.h) / orig.w;
    if (moving[1] < anchor[1]) r.y = anchor[1] - r.h;
  }
  return r;
}

export function PageView({ page, index }: { page: PageState; index: number }) {
  const {
    doc,
    zoom: z,
    tool,
    setTool,
    selection,
    setSelection,
    editingId,
    setEditingId,
    dispatch,
    defaults,
    getPageData,
    canvases,
  } = useEditor();
  const outerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [visible, setVisible] = useState(index < 2);
  const [data, setData] = useState<PageData | null>(null);
  const [draft, setDraft] = useState<EditorObject | null>(null);
  const [rendering, setRendering] = useState(page.srcIndex !== null);

  const W = page.width * z;
  const H = page.height * z;
  const rot = page.rotation;
  const display = rotatedSize(W, H, rot);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || page.srcIndex === null) return;
    let cancelled = false;
    getPageData(page.srcIndex).then((d) => !cancelled && setData(d)).catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [visible, page.srcIndex, getPageData]);

  useEffect(() => {
    if (!visible || page.srcIndex === null) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    setRendering(true);
    (async () => {
      const p = await doc.pdf.getPage(page.srcIndex! + 1);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: z * dpr });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = p.render({ canvas: off, viewport });
      await task.promise;
      if (cancelled) return;
      const c = canvasRef.current;
      if (!c) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
      canvases.set(page.id, c);
      setRendering(false);
    })().catch((err) => {
      if (!cancelled && err?.name !== 'RenderingCancelledException') console.error(err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, z, page.srcIndex, page.id, doc, canvases]);

  const toPage = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = outerRef.current!.getBoundingClientRect();
    const [x, y] = unrotatePoint(e.clientX - r.left, e.clientY - r.top, W, H, rot);
    return [x / z, y / z];
  };

  const select = (objectId: string) => setSelection({ kind: 'object', pageId: page.id, objectId });

  const createText = (x: number, y: number) => {
    const style = defaults.text;
    const obj: TextObject = {
      id: uid('text'),
      type: 'text',
      x,
      baseline: y + baselineOffset(style.fontFamily, style.fontSize) - (style.fontSize * 1.2) / 2,
      text: '',
      style: { ...style },
    };
    setTool('select');
    dispatch({ type: 'addObject', pageId: page.id, object: obj });
    select(obj.id);
    setEditingId(obj.id);
  };

  const editRun = (run: TextRun) => {
    const existing = page.objects.find(
      (o): o is TextObject => o.type === 'text' && o.replaces?.runId === run.id,
    );
    if (existing) {
      select(existing.id);
      setEditingId(existing.id);
      return;
    }
    const pad = Math.max(1, run.fontSize * 0.08);
    const area: Rect = { x: run.rect.x - pad, y: run.rect.y - pad, w: run.rect.w + pad * 2, h: run.rect.h + pad * 2 };
    const colors = sampleRegion(canvases.get(page.id), page.width, area);
    const font = data?.runFonts.get(run.id) ?? { family: 'Helvetica' as const, bold: false, italic: false };
    const obj: TextObject = {
      id: uid('edit'),
      type: 'text',
      x: run.x,
      baseline: run.baseline,
      text: run.text,
      style: {
        fontFamily: font.family,
        fontSize: Math.round(run.fontSize * 10) / 10,
        color: colors.foreground,
        bold: font.bold,
        italic: font.italic,
      },
      replaces: { runId: run.id, rect: area, cover: colors.background },
    };
    dispatch({ type: 'addObject', pageId: page.id, object: obj });
    select(obj.id);
    setEditingId(obj.id);
  };

  const makeDraft = (x0: number, y0: number, x1: number, y1: number): EditorObject => {
    const r = normalizeRect(x0, y0, x1, y1);
    const id = 'draft';
    switch (tool) {
      case 'line':
        return { id, type: 'line', x1: x0, y1: y0, x2: x1, y2: y1, stroke: defaults.stroke, strokeWidth: defaults.strokeWidth };
      case 'erase':
        return { id, type: 'erase', ...r, fill: defaults.eraseFill };
      case 'ellipse':
        return { id, type: 'ellipse', ...r, stroke: defaults.stroke, fill: defaults.fill, strokeWidth: defaults.strokeWidth };
      default:
        return { id, type: 'rect', ...r, stroke: defaults.stroke, fill: defaults.fill, strokeWidth: defaults.strokeWidth };
    }
  };

  const onOverlayDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (editingId) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    const [x, y] = toPage(e);
    if (tool === 'text') {
      createText(x, y);
      e.preventDefault();
      return;
    }
    if (DRAW_TOOLS.has(tool)) {
      gesture.current = { type: 'draw', x0: x, y0: y };
      overlayRef.current?.setPointerCapture(e.pointerId);
      setDraft(makeDraft(x, y, x, y));
      e.preventDefault();
      return;
    }
    setSelection(null);
  };

  const onObjectDown = (e: ReactPointerEvent, o: EditorObject, handle: HandleKind) => {
    if (e.button !== 0) return;
    const textTool = tool === 'text' && o.type === 'text';
    if (tool !== 'select' && !textTool) return;
    e.stopPropagation();
    e.preventDefault();
    if (editingId && editingId !== o.id) (document.activeElement as HTMLElement | null)?.blur?.();
    const wasSelected = selection?.kind === 'object' && selection.objectId === o.id;
    select(o.id);
    const [x, y] = toPage(e);
    gesture.current = { type: 'edit', handle, x0: x, y0: y, orig: o, key: uid('g'), moved: false, wasSelected };
    overlayRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const [x, y] = toPage(e);
    if (g.type === 'draw') {
      setDraft(makeDraft(g.x0, g.y0, x, y));
      return;
    }
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (!g.moved && Math.hypot(dx, dy) * z < 3) return;
    g.moved = true;
    const o = g.orig;
    let patch: Partial<EditorObject> | null = null;
    if (o.type === 'text') {
      patch = { x: o.x + dx, baseline: o.baseline + dy };
    } else if (o.type === 'line') {
      if (g.handle === 'p1') patch = { x1: x, y1: y };
      else if (g.handle === 'p2') patch = { x2: x, y2: y };
      else patch = { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    } else if (o.type === 'image' || o.type === 'rect' || o.type === 'ellipse' || o.type === 'erase') {
      if (g.handle === 'move') patch = { x: o.x + dx, y: o.y + dy };
      else patch = resizeBox(o, g.handle, dx, dy, o.type === 'image' && !e.shiftKey);
    }
    if (patch) dispatch({ type: 'updateObject', pageId: page.id, id: o.id, patch, coalesceKey: g.key });
  };

  const onUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.type === 'draw') {
      const [x, y] = toPage(e);
      let obj = makeDraft(g.x0, g.y0, x, y);
      const tiny = Math.hypot(x - g.x0, y - g.y0) < 4;
      if (tiny) {
        obj = obj.type === 'line'
          ? { ...obj, x2: g.x0 + 120, y2: g.y0 }
          : makeDraft(g.x0, g.y0, g.x0 + (tool === 'erase' ? 120 : 100), g.y0 + (tool === 'erase' ? 30 : 70));
      }
      obj = { ...obj, id: uid(obj.type) };
      setDraft(null);
      dispatch({ type: 'addObject', pageId: page.id, object: obj });
      select(obj.id);
      return;
    }
    if (!g.moved && g.orig.type === 'text' && (g.wasSelected || g.orig.replaces || tool === 'text')) {
      setEditingId(g.orig.id);
    }
  };

  const replacedRuns = new Set(
    page.objects.flatMap((o) => (o.type === 'text' && o.replaces ? [o.replaces.runId] : [])),
  );
  const deletedImages = page.objects.filter((o) => o.type === 'imageDelete');
  const showHits = tool === 'select' || tool === 'text';
  const selectedSrcImage = selection?.kind === 'srcImage' && selection.pageId === page.id ? selection.index : -1;

  return (
    <div className="page-shell" data-page-index={index} data-testid="page">
      <div
        ref={outerRef}
        className={`page tool-${tool}`}
        style={{ width: display.w, height: display.h }}
        data-page-id={page.id}
      >
        <div
          className="page-inner"
          style={{ width: W, height: H, transform: rotationTransform(W, H, rot) }}
        >
          {page.srcIndex !== null && <canvas ref={canvasRef} className="page-canvas" style={{ width: W, height: H }} />}
          {rendering && page.srcIndex !== null && <div className="page-loading">Rendering…</div>}
          <div
            ref={overlayRef}
            className="overlay"
            data-testid="overlay"
            onPointerDown={onOverlayDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              gesture.current = null;
              setDraft(null);
            }}
          >
            {showHits &&
              data?.images.map((img, i) =>
                deletedImages.some((d) => imageMatchesDeletion(img.rect, d.rect)) ? null : (
                  <div
                    key={`img-${i}`}
                    className={`src-image-hit${selectedSrcImage === i ? ' selected' : ''}`}
                    data-testid="src-image"
                    style={{ left: img.rect.x * z, top: img.rect.y * z, width: img.rect.w * z, height: img.rect.h * z }}
                    onPointerDown={(e) => {
                      if (tool !== 'select' || e.button !== 0) return;
                      e.stopPropagation();
                      setSelection({ kind: 'srcImage', pageId: page.id, index: i });
                    }}
                  />
                ),
              )}
            {showHits &&
              data?.runs.map((run) =>
                replacedRuns.has(run.id) ? null : (
                  <div
                    key={run.id}
                    className="run-hit"
                    data-testid="text-run"
                    data-text={run.text}
                    title="Click to edit text"
                    style={{ left: run.rect.x * z, top: run.rect.y * z, width: run.rect.w * z, height: run.rect.h * z }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      e.preventDefault();
                      if (editingId) (document.activeElement as HTMLElement | null)?.blur?.();
                      editRun(run);
                    }}
                  />
                ),
              )}
            {page.objects.map((o) => (
              <ObjectView
                key={o.id}
                object={o}
                pageId={page.id}
                zoom={z}
                selected={selection?.kind === 'object' && selection.objectId === o.id}
                interactive={tool === 'select'}
                onPointerDown={onObjectDown}
              />
            ))}
            {draft && (
              <ObjectView object={draft} pageId={page.id} zoom={z} selected={false} interactive={false} onPointerDown={() => undefined} />
            )}
          </div>
        </div>
      </div>
      <div className="page-label">
        Page {index + 1}
        {page.srcIndex === null ? ' · blank' : ''}
      </div>
    </div>
  );
}
