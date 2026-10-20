import {authorReducer, captureGraph, lowerGraph} from '../src/graph/document.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderGate} from '../src/viewport/renderGate.ts';
import {orbitDelta, panScale, wheelFactor, verticalFov} from '../src/viewport/cameraControls.ts';
import {documentReducer} from '../src/graph/state.ts';
import {emptyWorkspace} from '../src/workspace.ts';
test('stationary/hidden viewports stop scheduling; changes coalesce and disposal cancels', () => {
  let calls = 0,
    serial = 0;
  const queue = new Map();
  const g = createRenderGate(
    fn => {
      queue.set(++serial, fn);
      return serial;
    },
    id => queue.delete(id),
    () => calls++
  );
  const flush = () => {
    const jobs = [...queue.values()];
    queue.clear();
    jobs.forEach(f => f());
  };
  g.invalidate();
  g.invalidate();
  assert.equal(queue.size, 1);
  flush();
  assert.equal(calls, 1);
  assert.equal(queue.size, 0);
  g.setVisible(false);
  g.invalidate();
  assert.equal(queue.size, 0);
  g.setVisible(true);
  flush();
  assert.equal(calls, 2);
  g.invalidate();
  g.dispose();
  flush();
  assert.equal(calls, 2);
  g.invalidate();
  assert.equal(queue.size, 0);
});
test('HKX editor camera mapping preserves degree orbit and view-plane/zoom scaling', () => {
  const r = orbitDelta(0, 0, 10, 20);
  assert.ok(Math.abs(r.yaw + Math.PI / 18) < 1e-10);
  assert.ok(Math.abs(r.pitch - Math.PI / 9) < 1e-10);
  assert.ok(orbitDelta(0, 0, 0, 300).pitch < Math.PI / 2);
  assert.ok(Math.abs(panScale(320, 60, 800) - (320 * 2 * Math.tan(Math.PI / 6)) / 800) < 1e-10);
  assert.ok(wheelFactor(-120, 0) < 1);
  assert.ok(Math.abs(wheelFactor(120, 0) * wheelFactor(-120, 0) - 1) < 1e-10);
  assert.ok(Math.abs(verticalFov(60, 1) - 60) < 1e-10);
  assert.ok(verticalFov(60, 2) < 60);
});
test('history shares unchanged branches and preserves undo, redo and property deletion', () => {
  const w = emptyWorkspace();
  let s = {present: w, past: [], future: []};
  const next = structuredClone(w);
  next.name = 'Updated';
  s = documentReducer(s, {type: 'edit', next});
  assert.equal(s.present.actions, w.actions);
  assert.deepEqual(s.present, next);
  assert.equal(w.name, '새 애니메이션 묶음');
  const undo = documentReducer(s, {type: 'undo'});
  assert.equal(undo.present, w);
  assert.deepEqual(documentReducer(undo, {type: 'redo'}).present, next);
  assert.equal(documentReducer(s, {type: 'edit', next: structuredClone(s.present)}), s);
  const removed = structuredClone(s.present);
  delete removed.description;
  assert.deepEqual(documentReducer(s, {type: 'edit', next: removed}).present, removed);
});

test('production author history shares nodes while retaining exact edit and undo documents', () => {
  const w = emptyWorkspace(),
    graph = captureGraph(w),
    next = structuredClone(w);
  next.name = 'Renamed';
  const initial = {present: graph, past: [], future: []},
    edited = authorReducer(initial, {type: 'edit', next});
  assert.equal(edited.present.nodes, graph.nodes);
  assert.equal(edited.present.edges, graph.edges);
  assert.equal(lowerGraph(edited.present).name, 'Renamed');
  const restored = authorReducer(edited, {type: 'undo'});
  assert.equal(restored.present, graph);
  assert.deepEqual(authorReducer(restored, {type: 'redo'}).present, edited.present);
  assert.equal(authorReducer(edited, {type: 'edit', next: lowerGraph(edited.present)}), edited);
});
