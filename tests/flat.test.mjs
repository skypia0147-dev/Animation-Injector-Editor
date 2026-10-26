import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {flatGraph, flatId, addFlat, deleteFlat, connectFlat, hkxId} from '../src/graph/flat.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {moveNodes} from '../src/graph/projection.ts';
test('flat canvas exposes start, HKX, pair and transition cards with valid pins without changing XML', () => {
  const w = s4sample(),
    xml = compileWorkspace(w),
    g = flatGraph(w);
  assert.ok(g.nodes.some(n => n.kind === 'hkxPlay'));
  assert.ok(g.nodes.some(n => n.kind === 'pairedPlay'));
  assert.ok(g.nodes.some(n => n.kind === 'startCard'));
  assert.ok(g.nodes.some(n => n.kind === 'transition'));
  assert.ok(g.nodes.every(n => !n.open));
  assert.ok(g.nodes.every(n => !['animMotion', 'distanceMotion', 'detectionWindow'].includes(n.kind)));
  assert.equal(new Set(g.nodes.map(n => n.id)).size, g.nodes.length);
  for (const e of g.edges) {
    assert.ok(g.nodes.find(n => n.id === e.source)?.outputs.includes(e.pin), e.id);
    assert.ok(g.nodes.find(n => n.id === e.target)?.inputs.includes(e.targetPin ?? e.pin), e.id);
  }
  assert.equal(compileWorkspace(w), xml);
});
test('an item added to an HKX card is its action at once (format 6), survives save and goes with delete', () => {
  const w = s4sample(),
    a = w.actions.find(a => !a.pair),
    r = addFlat(w, a.uid, 'notify:rotate', {x: 77, y: 99});
  assert.equal(flatGraph(r.workspace).nodes.find(n => n.id === r.id)?.kind, 'notify');
  const loaded = parseWorkspace(JSON.stringify(r.workspace));
  assert.ok(flatGraph(loaded).nodes.some(n => n.id === r.id));
  assert.notEqual(compileWorkspace(loaded), compileWorkspace(w));
  assert.match(compileWorkspace(loaded), /<Rotate/);
  const gone = deleteFlat(loaded, r.id);
  assert.ok(!flatGraph(gone).nodes.some(n => n.id === r.id));
  assert.equal(compileWorkspace(gone), compileWorkspace(w));
});
test('flat feature delete and a drawn transition are executable domain edits', () => {
  const w = s4sample(),
    a = w.actions[0],
    id = flatId({kind: 'anim', action: a.uid}, 'blendIn');
  const n = deleteFlat(w, id);
  assert.equal(n.actions[0].enterBlendEnabled, false);
  const moved = moveNodes(n, {kind: 'root'}, {[flatId({kind: 'anim', action: a.uid}, 'blendOut')]: {x: 888, y: 222}});
  assert.deepEqual(
    flatGraph(moved).nodes.find(n => n.id === flatId({kind: 'anim', action: a.uid}, 'blendOut')).position,
    {
      x: 888,
      y: 222,
    }
  );
  // HKX onto HKX: a transition card between them.
  const linked = connectFlat(w, hkxId(w, w.actions[0].uid), hkxId(w, w.actions[1].uid));
  assert.equal(linked.links.length, w.links.length + 1);
  assert.deepEqual([linked.links.at(-1).from, linked.links.at(-1).to], [w.actions[0].uid, w.actions[1].uid]);
});
