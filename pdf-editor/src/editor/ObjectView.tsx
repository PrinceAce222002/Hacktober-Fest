import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { baselineOffset, CSS_FONT, LINE_HEIGHT } from '../lib/fonts';
import type { EditorObject, TextObject } from '../state/types';
import { useEditor } from './context';

export type HandleKind = 'move' | 'se' | 'nw' | 'ne' | 'sw' | 'p1' | 'p2';

interface Props {
  object: EditorObject;
  pageId: string;
  zoom: number;
  selected: boolean;
  interactive: boolean;
  onPointerDown: (e: ReactPointerEvent, object: EditorObject, handle: HandleKind) => void;
  /** Static rendering (e.g. thumbnails): never shows the inline text editor. */
  preview?: boolean;
}

function Handles({ onDown, kinds }: { onDown: (e: ReactPointerEvent, h: HandleKind) => void; kinds: HandleKind[] }) {
  return (
    <>
      {kinds.map((k) => (
        <div key={k} className={`handle handle-${k}`} onPointerDown={(e) => onDown(e, k)} />
      ))}
    </>
  );
}

function TextEditor({ object, zoom, pageId }: { object: TextObject; zoom: number; pageId: string }) {
  const { dispatch, setEditingId } = useEditor();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = object.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (object.replaces || !object.text) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Only on mount: later text changes are owned by the DOM until blur.
  }, []);

  const finish = () => {
    const el = ref.current;
    if (!el) return;
    const text = (el.innerText ?? el.textContent ?? '').replace(/\r/g, '').replace(/\n$/, '');
    setEditingId(null);
    if (!text.trim() && !object.replaces) {
      dispatch({ type: 'removeObject', pageId, id: object.id });
    } else if (text !== object.text) {
      dispatch({ type: 'updateObject', pageId, id: object.id, patch: { text } });
    }
  };

  return (
    <div
      ref={ref}
      className="text-editable"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-testid="text-editor"
      style={textCss(object, zoom)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

/** Cover boxes are grown by a pixel so anti-aliased edges of the canvas underneath don't show. */
function coverStyle(r: { x: number; y: number; w: number; h: number }, z: number): React.CSSProperties {
  return { left: r.x * z - 1, top: r.y * z - 1, width: r.w * z + 2, height: r.h * z + 2 };
}

function textCss(o: TextObject, zoom: number): React.CSSProperties {
  const s = o.style;
  return {
    fontFamily: CSS_FONT[s.fontFamily],
    fontSize: s.fontSize * zoom,
    lineHeight: LINE_HEIGHT,
    color: s.color,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
  };
}

export function ObjectView({ object: o, pageId, zoom, selected, interactive, onPointerDown, preview }: Props) {
  const { editingId, assets } = useEditor();
  const z = zoom;
  const cls = `obj obj-${o.type}${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`;
  const down = (e: ReactPointerEvent, h: HandleKind = 'move') => onPointerDown(e, o, h);

  switch (o.type) {
    case 'text': {
      const editing = !preview && editingId === o.id;
      const top = o.baseline - baselineOffset(o.style.fontFamily, o.style.fontSize);
      return (
        <>
          {o.replaces && (
            <div
              className="text-cover"
              style={{ ...coverStyle(o.replaces.rect, z), background: o.replaces.cover }}
            />
          )}
          <div
            className={cls + (editing ? ' editing' : '')}
            data-testid="text-object"
            data-object-id={o.id}
            style={{ left: o.x * z, top: top * z }}
            onPointerDown={editing ? undefined : (e) => down(e)}
          >
            {editing ? (
              <TextEditor object={o} zoom={z} pageId={pageId} />
            ) : (
              <div className="text-display" style={textCss(o, z)}>
                {o.text || (o.replaces ? '' : ' ')}
              </div>
            )}
            {o.replaces && !o.text && selected && <div className="deleted-text-hint">text removed</div>}
          </div>
        </>
      );
    }
    case 'image': {
      const asset = assets.get(o.assetId);
      return (
        <div
          className={cls}
          data-object-id={o.id}
          style={{ left: o.x * z, top: o.y * z, width: o.w * z, height: o.h * z }}
          onPointerDown={(e) => down(e)}
        >
          {asset && <img src={asset.url} alt="" draggable={false} />}
          {selected && <Handles onDown={down} kinds={['nw', 'ne', 'sw', 'se']} />}
        </div>
      );
    }
    case 'rect':
    case 'ellipse': {
      const sw = o.stroke ? o.strokeWidth * z : 0;
      return (
        <div
          className={cls}
          data-object-id={o.id}
          style={{ left: o.x * z, top: o.y * z, width: o.w * z, height: o.h * z }}
          onPointerDown={(e) => down(e)}
        >
          <svg width="100%" height="100%" overflow="visible">
            {o.type === 'rect' ? (
              <rect
                x={0}
                y={0}
                width={o.w * z}
                height={o.h * z}
                fill={o.fill ?? 'none'}
                stroke={o.stroke ?? 'none'}
                strokeWidth={sw}
              />
            ) : (
              <ellipse
                cx={(o.w * z) / 2}
                cy={(o.h * z) / 2}
                rx={(o.w * z) / 2}
                ry={(o.h * z) / 2}
                fill={o.fill ?? 'none'}
                stroke={o.stroke ?? 'none'}
                strokeWidth={sw}
              />
            )}
          </svg>
          {selected && <Handles onDown={down} kinds={['nw', 'ne', 'sw', 'se']} />}
        </div>
      );
    }
    case 'line': {
      const minX = Math.min(o.x1, o.x2);
      const minY = Math.min(o.y1, o.y2);
      const pad = Math.max(6, o.strokeWidth * z);
      const w = Math.abs(o.x2 - o.x1) * z;
      const h = Math.abs(o.y2 - o.y1) * z;
      return (
        <div
          className={cls}
          data-object-id={o.id}
          style={{ left: minX * z - pad, top: minY * z - pad, width: w + pad * 2, height: h + pad * 2 }}
        >
          <svg width="100%" height="100%" overflow="visible">
            <line
              className="line-hit"
              x1={(o.x1 - minX) * z + pad}
              y1={(o.y1 - minY) * z + pad}
              x2={(o.x2 - minX) * z + pad}
              y2={(o.y2 - minY) * z + pad}
              stroke="transparent"
              strokeWidth={Math.max(12, o.strokeWidth * z)}
              onPointerDown={(e) => down(e)}
            />
            <line
              x1={(o.x1 - minX) * z + pad}
              y1={(o.y1 - minY) * z + pad}
              x2={(o.x2 - minX) * z + pad}
              y2={(o.y2 - minY) * z + pad}
              stroke={o.stroke}
              strokeWidth={o.strokeWidth * z}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </svg>
          {selected && (
            <>
              <div
                className="handle handle-point"
                style={{ left: (o.x1 - minX) * z + pad, top: (o.y1 - minY) * z + pad }}
                onPointerDown={(e) => down(e, 'p1')}
              />
              <div
                className="handle handle-point"
                style={{ left: (o.x2 - minX) * z + pad, top: (o.y2 - minY) * z + pad }}
                onPointerDown={(e) => down(e, 'p2')}
              />
            </>
          )}
        </div>
      );
    }
    case 'erase':
      return (
        <div
          className={cls + (o.fill ? '' : ' erase-nofill')}
          data-object-id={o.id}
          style={{ left: o.x * z, top: o.y * z, width: o.w * z, height: o.h * z, background: o.fill ?? undefined }}
          onPointerDown={(e) => down(e)}
        >
          {selected && <Handles onDown={down} kinds={['nw', 'ne', 'sw', 'se']} />}
        </div>
      );
    case 'imageDelete':
      return (
        <div
          className="obj obj-imageDelete"
          style={{ ...coverStyle(o.rect, z), background: o.cover }}
        />
      );
  }
}
