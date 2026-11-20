import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, createHistory, redo, undo } from '../src/state/history';
import { historyReducer } from '../src/state/reducer';
import type { DocState, PageState, ShapeObject } from '../src/state/types';

const page = (id: string): PageState => ({ id, srcIndex: 0, rotation: 0, width: 100, height: 100, objects: [] });
const rect: ShapeObject = { id: 'r1', type: 'rect', x: 1, y: 2, w: 3, h: 4, stroke: '#000000', fill: null, strokeWidth: 1 };

describe('history', () => {
  it('supports undo and redo', () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe(2);
    h = commit(h, 5);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([1, 2]);
  });

  it('coalesces changes sharing a key into a single undo step', () => {
    let h = createHistory(0);
    h = commit(h, 1, 'drag-a');
    h = commit(h, 2, 'drag-a');
    h = commit(h, 3, 'drag-a');
    h = commit(h, 4, 'drag-b');
    expect(h.past).toEqual([0, 3]);
    expect(undo(undo(h)).present).toBe(0);
  });
});

describe('document reducer', () => {
  const initial: DocState = { pages: [page('a'), page('b'), page('c')] };

  it('adds, updates (with coalescing) and removes objects with undo', () => {
    let h = createHistory(initial);
    h = historyReducer(h, { type: 'addObject', pageId: 'b', object: rect });
    h = historyReducer(h, { type: 'updateObject', pageId: 'b', id: 'r1', patch: { x: 10 }, coalesceKey: 'g1' });
    h = historyReducer(h, { type: 'updateObject', pageId: 'b', id: 'r1', patch: { x: 20 }, coalesceKey: 'g1' });
    expect((h.present.pages[1].objects[0] as ShapeObject).x).toBe(20);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.pages[1].objects[0]).toEqual(rect);
    h = historyReducer(h, { type: 'removeObject', pageId: 'b', id: 'r1' });
    expect(h.present.pages[1].objects).toHaveLength(0);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'undo' });
    expect(h.present).toBe(initial);
  });

  it('rotates, moves, deletes and inserts pages', () => {
    let h = createHistory(initial);
    h = historyReducer(h, { type: 'rotatePage', pageId: 'a', delta: -90 });
    expect(h.present.pages[0].rotation).toBe(270);
    h = historyReducer(h, { type: 'movePage', from: 0, to: 2 });
    expect(h.present.pages.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    h = historyReducer(h, { type: 'deletePage', pageId: 'c' });
    expect(h.present.pages.map((p) => p.id)).toEqual(['b', 'a']);
    h = historyReducer(h, { type: 'insertBlankPage', index: 1, page: { ...page('n'), srcIndex: null } });
    expect(h.present.pages.map((p) => p.id)).toEqual(['b', 'n', 'a']);
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.pages.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('never deletes the last page', () => {
    let h = createHistory<DocState>({ pages: [page('only')] });
    h = historyReducer(h, { type: 'deletePage', pageId: 'only' });
    expect(h.present.pages).toHaveLength(1);
    expect(canUndo(h)).toBe(false);
  });
});
