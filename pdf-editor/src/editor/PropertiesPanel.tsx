import { Bold, Italic, RotateCcw, Trash2 } from 'lucide-react';
import { FONT_FAMILIES, type FontFamily } from '../lib/fonts';
import type { EditorObject, TextStyle } from '../state/types';
import { useEditor, type Tool } from './context';

function ColorField({
  label,
  value,
  onChange,
  allowNone,
  testId,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  testId?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="color-row">
        <input
          type="color"
          data-testid={testId}
          value={value ?? '#ffffff'}
          disabled={value === null}
          onChange={(e) => onChange(e.target.value)}
        />
        <code>{value ?? 'none'}</code>
        {allowNone && (
          <button
            type="button"
            className={`chip${value === null ? ' active' : ''}`}
            onClick={() => onChange(value === null ? '#ffffff' : null)}
          >
            None
          </button>
        )}
      </div>
    </label>
  );
}

function TextStyleFields({ style, onChange }: { style: TextStyle; onChange: (s: Partial<TextStyle>) => void }) {
  return (
    <>
      <label className="field">
        <span>Font</span>
        <select
          data-testid="font-family"
          value={style.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value as FontFamily })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Size</span>
          <input
            type="number"
            data-testid="font-size"
            min={4}
            max={200}
            step={0.5}
            value={style.fontSize}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v >= 1 && v <= 400) onChange({ fontSize: v });
            }}
          />
        </label>
        <div className="field">
          <span>Style</span>
          <div className="toggle-group">
            <button
              type="button"
              data-testid="bold"
              className={`toggle${style.bold ? ' active' : ''}`}
              aria-pressed={style.bold}
              title="Bold"
              onClick={() => onChange({ bold: !style.bold })}
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              data-testid="italic"
              className={`toggle${style.italic ? ' active' : ''}`}
              aria-pressed={style.italic}
              title="Italic"
              onClick={() => onChange({ italic: !style.italic })}
            >
              <Italic size={16} />
            </button>
          </div>
        </div>
      </div>
      <ColorField label="Color" value={style.color} onChange={(v) => v && onChange({ color: v })} testId="text-color" />
    </>
  );
}

function ShapeFields({
  stroke,
  fill,
  strokeWidth,
  showFill,
  onChange,
}: {
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
  showFill: boolean;
  onChange: (p: { stroke?: string | null; fill?: string | null; strokeWidth?: number }) => void;
}) {
  return (
    <>
      <ColorField label="Stroke" value={stroke} allowNone={showFill} onChange={(v) => onChange({ stroke: v })} />
      {showFill && <ColorField label="Fill" value={fill} allowNone onChange={(v) => onChange({ fill: v })} />}
      <label className="field">
        <span>Stroke width: {strokeWidth}pt</span>
        <input
          type="range"
          min={0.5}
          max={20}
          step={0.5}
          value={strokeWidth}
          onChange={(e) => onChange({ strokeWidth: parseFloat(e.target.value) })}
        />
      </label>
    </>
  );
}

const TOOL_HINTS: Record<Tool, string> = {
  select: 'Click existing text to edit it in place. Click images to select and delete them. Drag objects to move; use the handles to resize.',
  text: 'Click anywhere on a page to add a text box, or click existing text to edit it.',
  rect: 'Drag on a page to draw a rectangle.',
  ellipse: 'Drag on a page to draw an ellipse.',
  line: 'Drag on a page to draw a line.',
  erase: 'Drag over content to erase it. Text and images under the eraser are removed from the PDF and the area is painted with the fill color.',
  image: 'Choose an image file to place it on the current page.',
};

export function PropertiesPanel() {
  const { state, selection, dispatch, tool, defaults, setDefaults, deleteSelection } = useEditor();
  const page = selection ? state.pages.find((p) => p.id === selection.pageId) : undefined;
  const obj = selection?.kind === 'object' ? page?.objects.find((o) => o.id === selection.objectId) : undefined;

  const update = (patch: Partial<EditorObject>) => {
    if (!page || !obj) return;
    dispatch({ type: 'updateObject', pageId: page.id, id: obj.id, patch });
  };

  let body: React.ReactNode;
  if (selection?.kind === 'srcImage') {
    body = (
      <>
        <h3>Image</h3>
        <p className="muted">This image is part of the original PDF.</p>
        <button className="btn btn-danger" data-testid="delete-selection" onClick={deleteSelection}>
          <Trash2 size={16} /> Delete image
        </button>
      </>
    );
  } else if (obj) {
    const title: Record<EditorObject['type'], string> = {
      text: obj.type === 'text' && obj.replaces ? 'Edited text' : 'Text',
      image: 'Image',
      rect: 'Rectangle',
      ellipse: 'Ellipse',
      line: 'Line',
      erase: 'Eraser',
      imageDelete: 'Deleted image',
    };
    body = (
      <>
        <h3>{title[obj.type]}</h3>
        {obj.type === 'text' && (
          <>
            <TextStyleFields style={obj.style} onChange={(s) => update({ style: { ...obj.style, ...s } })} />
            {obj.replaces && (
              <>
                <ColorField
                  label="Cover color (fallback)"
                  value={obj.replaces.cover}
                  onChange={(v) => v && update({ replaces: { ...obj.replaces!, cover: v } })}
                />
                <p className="muted small">
                  Original text is removed from the PDF. If it cannot be removed, it is covered with this color.
                </p>
              </>
            )}
          </>
        )}
        {(obj.type === 'rect' || obj.type === 'ellipse') && (
          <ShapeFields stroke={obj.stroke} fill={obj.fill} strokeWidth={obj.strokeWidth} showFill onChange={update} />
        )}
        {obj.type === 'line' && (
          <ShapeFields
            stroke={obj.stroke}
            fill={null}
            strokeWidth={obj.strokeWidth}
            showFill={false}
            onChange={(p) => update({ ...(p.stroke ? { stroke: p.stroke } : {}), ...(p.strokeWidth ? { strokeWidth: p.strokeWidth } : {}) })}
          />
        )}
        {obj.type === 'erase' && (
          <>
            <ColorField label="Fill" value={obj.fill} allowNone onChange={(v) => update({ fill: v })} />
            <p className="muted small">With no fill, content is removed but nothing is painted over it.</p>
          </>
        )}
        <div className="panel-actions">
          {obj.type === 'text' && obj.replaces ? (
            <>
              <button
                className="btn btn-danger"
                data-testid="delete-selection"
                onClick={() => update({ text: '' })}
                title="Remove this text from the page"
              >
                <Trash2 size={16} /> Delete text
              </button>
              <button className="btn btn-ghost" onClick={deleteSelection} title="Discard edits and restore the original text">
                <RotateCcw size={16} /> Revert
              </button>
            </>
          ) : (
            <button className="btn btn-danger" data-testid="delete-selection" onClick={deleteSelection}>
              <Trash2 size={16} /> Delete
            </button>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h3>{tool === 'select' ? 'Select & edit' : 'Tool options'}</h3>
        <p className="muted small">{TOOL_HINTS[tool]}</p>
        {(tool === 'text' || tool === 'select') && (
          <>
            <h4>New text defaults</h4>
            <TextStyleFields style={defaults.text} onChange={(s) => setDefaults({ ...defaults, text: { ...defaults.text, ...s } })} />
          </>
        )}
        {(tool === 'rect' || tool === 'ellipse' || tool === 'line') && (
          <ShapeFields
            stroke={defaults.stroke}
            fill={defaults.fill}
            strokeWidth={defaults.strokeWidth}
            showFill={tool !== 'line'}
            onChange={(p) =>
              setDefaults({
                ...defaults,
                ...(p.stroke !== undefined ? { stroke: p.stroke ?? '#000000' } : {}),
                ...(p.fill !== undefined ? { fill: p.fill } : {}),
                ...(p.strokeWidth !== undefined ? { strokeWidth: p.strokeWidth } : {}),
              })
            }
          />
        )}
        {tool === 'erase' && (
          <ColorField
            label="Eraser fill"
            value={defaults.eraseFill}
            allowNone
            onChange={(v) => setDefaults({ ...defaults, eraseFill: v })}
          />
        )}
      </>
    );
  }

  return (
    <aside className="props" aria-label="Properties" onPointerDown={(e) => e.stopPropagation()}>
      {body}
      <div className="shortcuts">
        <h4>Shortcuts</h4>
        <ul>
          <li><kbd>V</kbd> select · <kbd>T</kbd> text · <kbd>E</kbd> eraser</li>
          <li><kbd>R</kbd> rectangle · <kbd>O</kbd> ellipse · <kbd>L</kbd> line</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo</li>
          <li><kbd>Del</kbd> delete · <kbd>Esc</kbd> deselect</li>
        </ul>
      </div>
    </aside>
  );
}
