import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {addDetachedCondition, addFlat, flatGraph, connectFlat} from '../src/graph/flat.ts';
import {tableProjection, groupConditions} from '../src/graph/conditionTables.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {compileWorkspace, validateWorkspace, parseWorkspace} from '../src/workspace.ts';
import {deleteCondition} from '../src/graph/conditionCommands.ts';
import {captureGraph, lowerGraph} from '../src/graph/document.ts';
const view = w => tableProjection(w, compactGraph(w, flatGraph(w)));
test('canvas condition remains disconnected and can be explicitly connected from its start input', () => {
  const w = s4sample(),
    before = structuredClone(w);
  const r = addDetachedCondition(w, 'a1', {x: 123, y: 456});
  assert.ok(view(r.workspace).nodes.some(n => n.id === r.id));
  assert.ok(!view(r.workspace).edges.some(e => e.source === r.id || e.target === r.id));
  assert.deepEqual(w, before);
  assert.deepEqual(view(r.workspace).edges, view(w).edges);
  let next = connectFlat(r.workspace, 'start:a1|keyInput', r.id, 'trigger');
  next = connectFlat(next, r.id, 'anim:a1:|clip_A1', 'pass');
  assert.equal(next.actions[0].flow.entry, r.id.split(':').at(-1));
  assert.ok(flatGraph(next).edges.some(e => e.source === r.id));
});
test('adding a condition preserves existing grouped routes and leaves the new node outside the group', () => {
  let w = addFlat(s4sample(), 'a1', 'conditionBranch', {x: 0, y: 0}).workspace;
  w = groupConditions(w);
  const before = structuredClone(w.actions[0].flow);
  const r = addDetachedCondition(w, 'a1', {x: 123, y: 456}),
    v = view(r.workspace);
  assert.deepEqual(r.workspace.actions[0].flow.tests.slice(0, -1), before.tests);
  assert.equal(r.workspace.actions[0].flow.entry, before.entry);
  assert.ok(v.nodes.some(n => n.id === 'conditionTable:a1'));
  assert.ok(v.nodes.some(n => n.id === r.id));
  assert.ok(!v.edges.some(e => e.source === r.id || e.target === r.id));
});

test('unconnected condition drafts survive project saving without changing the exported action', () => {
  const base = s4sample(),
    r = addDetachedCondition(base, 'a1', {x: 100, y: 150});
  const t = r.workspace.actions[0].flow.tests[0];
  t.kind = 'magicEffect';
  const saved = lowerGraph(captureGraph(parseWorkspace(JSON.stringify(r.workspace))));
  assert.equal(saved.actions[0].flow.detached, true);
  assert.equal(saved.actions[0].flow.tests[0].kind, 'magicEffect');
  assert.equal(compileWorkspace(saved), compileWorkspace(base));
  assert.ok(validateWorkspace(saved).some(i => i.level === 'warning' && i.node === r.id));
  const connected = connectFlat(saved, 'start:a1|keyInput', r.id, 'trigger');
  assert.equal(connected.actions[0].flow.detached, undefined);
  assert.throws(() => compileWorkspace(connected), /Form ID/);
});

test('unreachable drafts are excluded but deleted entries and broken reachable references still fail', () => {
  const first = addFlat(s4sample(), 'a1', 'conditionBranch', {x: 0, y: 0});
  const r = addDetachedCondition(first.workspace, 'a1', {x: 100, y: 100}),
    f = r.workspace.actions[0].flow;
  f.tests[1].kind = 'magicEffect';
  assert.equal(compileWorkspace(r.workspace), compileWorkspace(first.workspace));
  assert.throws(() => compileWorkspace(deleteCondition(r.workspace, 'a1', f.entry)), /시작 조건/);
  f.tests[0].fail = {node: f.tests[1].id};
  assert.throws(() => compileWorkspace(r.workspace), /Form ID/);
  f.tests[0].fail = {node: 'Missing'};
  assert.throws(() => compileWorkspace(r.workspace), /연결된 조건/);
});
