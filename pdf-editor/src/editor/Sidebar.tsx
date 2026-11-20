import { ArrowDown, ArrowUp, FilePlus2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PageState } from '../state/types';
import { uid, useEditor } from './context';
import { rotatedSize, rotationTransform } from './geometry';
import { ObjectView } from './ObjectView';

const THUMB_W = 150;
const THUMB_H = 170;

function Thumbnail({ page }: { page: PageState }) {
  const { doc } = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const display = rotatedSize(page.width, page.height, page.rotation);
  const s = Math.min(THUMB_W / display.w, THUMB_H / display.h);
  const W = page.width * s;
  const H = page.height * s;

  useEffect(() => {
    if (page.srcIndex === null) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const p = await doc.pdf.getPage(page.srcIndex! + 1);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: (2 * Math.max(THUMB_W, THUMB_H)) / Math.max(base.width, base.height) });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = p.render({ canvas: off, viewport });
      await task.promise;
      const c = ref.current;
      if (cancelled || !c) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page.srcIndex]);

  return (
    <div className="thumb-page" style={{ width: display.w * s, height: display.h * s }}>
      <div className="page-inner" style={{ width: W, height: H, transform: rotationTransform(W, H, page.rotation) }}>
        {page.srcIndex !== null && <canvas ref={ref} className="thumb-canvas" style={{ width: W, height: H }} />}
        <div className="thumb-overlay">
          {page.objects.map((o) => (
            <ObjectView
              key={o.id}
              object={o}
              pageId={page.id}
              zoom={s}
              selected={false}
              interactive={false}
              preview
              onPointerDown={() => undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ onJump }: { onJump: (index: number) => void }) {
  const { state, dispatch } = useEditor();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const pages = state.pages;

  return (
    <aside className="sidebar" aria-label="Pages">
      <div className="sidebar-header">
        <span>Pages</span>
        <span className="muted">{pages.length}</span>
      </div>
      <ol className="thumbs">
        {pages.map((p, i) => (
          <li
            key={p.id}
            className={`thumb${dragOver === i && dragFrom !== i ? ' drag-over' : ''}${dragFrom === i ? ' dragging' : ''}`}
            data-testid="thumb"
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom ?? Number(e.dataTransfer.getData('text/plain'));
              if (!Number.isNaN(from)) dispatch({ type: 'movePage', from, to: i });
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
          >
            <button className="thumb-preview" onClick={() => onJump(i)} title={`Go to page ${i + 1}`}>
              <Thumbnail page={p} />
              {p.objects.length > 0 && <span className="thumb-badge" title="Page has edits">{p.objects.length}</span>}
            </button>
            <div className="thumb-footer">
              <span className="thumb-num">{i + 1}</span>
              <div className="thumb-actions">
                <button title="Move up" aria-label={`Move page ${i + 1} up`} disabled={i === 0} onClick={() => dispatch({ type: 'movePage', from: i, to: i - 1 })}>
                  <ArrowUp size={14} />
                </button>
                <button title="Move down" aria-label={`Move page ${i + 1} down`} disabled={i === pages.length - 1} onClick={() => dispatch({ type: 'movePage', from: i, to: i + 1 })}>
                  <ArrowDown size={14} />
                </button>
                <button title="Rotate left" aria-label={`Rotate page ${i + 1} left`} onClick={() => dispatch({ type: 'rotatePage', pageId: p.id, delta: -90 })}>
                  <RotateCcw size={14} />
                </button>
                <button title="Rotate right" aria-label={`Rotate page ${i + 1} right`} onClick={() => dispatch({ type: 'rotatePage', pageId: p.id, delta: 90 })}>
                  <RotateCw size={14} />
                </button>
                <button
                  title="Delete page"
                  aria-label={`Delete page ${i + 1}`}
                  className="danger"
                  disabled={pages.length <= 1}
                  onClick={() => dispatch({ type: 'deletePage', pageId: p.id })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button
        className="btn btn-ghost add-page"
        onClick={() => {
          const last = pages[pages.length - 1];
          dispatch({
            type: 'insertBlankPage',
            index: pages.length,
            page: {
              id: uid('page'),
              srcIndex: null,
              rotation: 0,
              width: last?.width ?? 612,
              height: last?.height ?? 792,
              objects: [],
            },
          });
          setTimeout(() => onJump(pages.length), 50);
        }}
      >
        <FilePlus2 size={16} /> Add blank page
      </button>
    </aside>
  );
}
