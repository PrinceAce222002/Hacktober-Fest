import { commit, createHistory, redo, undo, type History } from './history';
import type { DocState, EditorObject, PageState } from './types';

export type DocAction =
  | { type: 'addObject'; pageId: string; object: EditorObject }
  | { type: 'updateObject'; pageId: string; id: string; patch: Partial<EditorObject>; coalesceKey?: string }
  | { type: 'removeObject'; pageId: string; id: string }
  | { type: 'rotatePage'; pageId: string; delta: number }
  | { type: 'deletePage'; pageId: string }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'insertBlankPage'; index: number; page: PageState };

export type HistoryAction = DocAction | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; doc: DocState };

function mapPage(doc: DocState, pageId: string, fn: (p: PageState) => PageState): DocState {
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (p.id !== pageId) return p;
    const np = fn(p);
    if (np !== p) changed = true;
    return np;
  });
  return changed ? { ...doc, pages } : doc;
}

export function docReducer(doc: DocState, action: DocAction): DocState {
  switch (action.type) {
    case 'addObject':
      return mapPage(doc, action.pageId, (p) => ({ ...p, objects: [...p.objects, action.object] }));
    case 'updateObject':
      return mapPage(doc, action.pageId, (p) => {
        const idx = p.objects.findIndex((o) => o.id === action.id);
        if (idx < 0) return p;
        const objects = p.objects.slice();
        objects[idx] = { ...objects[idx], ...action.patch } as EditorObject;
        return { ...p, objects };
      });
    case 'removeObject':
      return mapPage(doc, action.pageId, (p) => {
        const objects = p.objects.filter((o) => o.id !== action.id);
        return objects.length === p.objects.length ? p : { ...p, objects };
      });
    case 'rotatePage':
      return mapPage(doc, action.pageId, (p) => ({
        ...p,
        rotation: (((p.rotation + action.delta) % 360) + 360) % 360,
      }));
    case 'deletePage': {
      if (doc.pages.length <= 1) return doc;
      const pages = doc.pages.filter((p) => p.id !== action.pageId);
      return pages.length === doc.pages.length ? doc : { ...doc, pages };
    }
    case 'movePage': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= doc.pages.length || to >= doc.pages.length) return doc;
      const pages = doc.pages.slice();
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
      return { ...doc, pages };
    }
    case 'insertBlankPage': {
      const pages = doc.pages.slice();
      pages.splice(Math.max(0, Math.min(action.index, pages.length)), 0, action.page);
      return { ...doc, pages };
    }
  }
}

export function historyReducer(h: History<DocState>, action: HistoryAction): History<DocState> {
  switch (action.type) {
    case 'undo':
      return undo(h);
    case 'redo':
      return redo(h);
    case 'reset':
      return createHistory(action.doc);
    default: {
      const next = docReducer(h.present, action);
      const key = action.type === 'updateObject' ? (action.coalesceKey ?? null) : null;
      return commit(h, next, key);
    }
  }
}
