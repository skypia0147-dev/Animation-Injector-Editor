import {test} from 'node:test';
import {addComment, editComment, duplicateGraphNode} from '../src/graph/projection.ts';

test('comments survive move, save and reopen without changing XML', () => {
  const w = s4sample(),
    g = {kind: 'root'},
    xml = compileWorkspace(w);
  const created = addComment(w, g, {x: 15, y: -20});
  const edited = editComment(created.workspace, g, created.id, '페어 전환 설명');
  const moved = moveNodes(edited, g, {[created.id]: {x: 200, y: 100}});
  const reopened = parseWorkspace(JSON.stringify(moved));
  assert.equal(projectGraph(reopened, g).nodes.find(n => n.id === created.id).summary, '페어 전환 설명');
  assert.equal(compileWorkspace(reopened), xml);
  assert.ok(!projectGraph(deleteGraphNode(reopened, g, created.id), g).nodes.some(n => n.id === created.id));
});
test('duplicating a state preserves optional feature flags but generates new identity', () => {
  const w = s4sample(),
    a = w.actions[0];
  a.enterBlendEnabled = false;
  a.exitBlendEnabled = false;
  const next = duplicateGraphNode(w, {kind: 'root'}, a.uid),
    copy = next.actions.at(-1);
  assert.notEqual(copy.uid, a.uid);
  assert.notEqual(copy.config.actionId, a.config.actionId);
  assert.equal(copy.enterBlendEnabled, false);
  assert.equal(copy.exitBlendEnabled, false);
  assert.deepEqual(copy.pair, a.pair);
});
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {graphId, uiReducer, initialUI, documentReducer} from '../src/graph/state.ts';
import {
  projectGraph,
  moveNodes,
  graphExists,
  mutateGraph,
  deleteGraphNode,
  connectGraph,
  addGraphItem,
} from '../src/graph/projection.ts';
test('projecting every layer preserves XML and gives edges concrete endpoints', () => {
  const w = s4sample(),
    before = JSON.stringify(w),
    xml = compileWorkspace(w);
  const refs = [
    {kind: 'root'},
    ...w.actions.flatMap(a => [
      {kind: 'anim', action: a.uid},
      {kind: 'start', action: a.uid},
    ]),
    ...w.links.map(l => ({kind: 'link', link: l.id})),
  ];
  for (const g of refs) {
    const p = projectGraph(w, g);
    for (const e of p.edges) {
      assert.ok(p.nodes.some(n => n.id === e.source));
      assert.ok(p.nodes.some(n => n.id === e.target));
      assert.ok(p.nodes.find(n => n.id === e.source).outputs.includes(e.pin), e.source + ' output');
    }
  }
  assert.equal(JSON.stringify(w), before);
  assert.equal(compileWorkspace(w), xml);
});
test('subgraph layouts roundtrip in schema 7 without changing executable XML', () => {
  const w = s4sample(),
    g = {kind: 'anim', action: w.actions[0].uid};
  const xml = compileWorkspace(w);
  const next = moveNodes(w, g, {blendIn: {x: 234, y: -45}});
  assert.deepEqual(projectGraph(next, g).nodes.find(n => n.id === 'blendIn').position, {x: 234, y: -45});
  const loaded = parseWorkspace(JSON.stringify(next));
  assert.deepEqual(projectGraph(loaded, g), projectGraph(next, g));
  assert.equal(compileWorkspace(loaded), xml);
  assert.equal(graphId({kind: 'anim', action: 'x'}), graphId({action: 'x', kind: 'anim'}));
});
test('shared undo spans graphs, branches clear redo, no-op does not add a step', () => {
  const w = s4sample();
  let s = {present: w, past: [], future: []};
  const anim = {kind: 'anim', action: w.actions[0].uid};
  s = documentReducer(s, {type: 'edit', next: mutateGraph(s.present, anim, 'blendIn', true)});
  const changed = s.present;
  s = documentReducer(s, {type: 'edit', next: moveNodes(s.present, {kind: 'root'}, {entry: {x: 100, y: 200}})});
  assert.equal(s.past.length, 2);
  s = documentReducer(s, {type: 'undo'});
  assert.deepEqual(s.present, changed);
  s = documentReducer(s, {type: 'undo'});
  assert.deepEqual(s.present, w);
  s = documentReducer(s, {type: 'redo'});
  assert.deepEqual(s.present, changed);
  s = documentReducer(s, {type: 'edit', next: s.present});
  assert.equal(s.future.length, 1);
  s = documentReducer(s, {type: 'edit', next: mutateGraph(s.present, anim, 'blendOut', true)});
  assert.equal(s.future.length, 0);
});
test('unsupported wiring and required-node deletion fail without mutating input', () => {
  const w = s4sample(),
    a = w.actions[0],
    g = {kind: 'anim', action: a.uid},
    before = JSON.stringify(w);
  assert.throws(() => connectGraph(w, g, 'findPartner', 'outputPose'));
  assert.throws(() => deleteGraphNode(w, g, 'outputPose'));
  assert.equal(JSON.stringify(w), before);
});
test('graph tabs are deduplicated and closing the active graph returns to root', () => {
  const graph = {kind: 'anim', action: 'action1'};
  let s = uiReducer(initialUI, {type: 'open', graph});
  s = uiReducer(s, {type: 'open', graph});
  assert.equal(s.tabs.length, 2);
  s = uiReducer(s, {type: 'close', graph});
  assert.equal(s.graph.kind, 'root');
  assert.equal(uiReducer(s, {type: 'close', graph: {kind: 'root'}}), s);
});
