import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {flatGraph, addFlat, deleteFlat, connectFlat, flatId} from '../src/graph/flat.ts';
test('repeated additions are distinct disconnected nodes and do not alter runtime XML', () => {
  let w = s4sample();
  const xml = compileWorkspace(w),
    a = w.actions[0];
  for (const kind of ['hkxPlay', 'keyInput', 'stateCondition', 'notify:rotate'])
    for (let i = 0; i < 2; i++) {
      const r = addFlat(w, a.uid, kind, {x: 100 + i * 200, y: 300});
      w = r.workspace;
      const g = flatGraph(w);
      assert.ok(g.nodes.some(n => n.id === r.id));
      assert.ok(!g.edges.some(e => e.source === r.id || e.target === r.id));
    }
  assert.equal(w.drafts.length, 8);
  assert.equal(compileWorkspace(w), xml);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).drafts, w.drafts);
});
test('deleting the HKX removes its action, including the last one', () => {
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  const a = w.actions[0];
  w = deleteFlat(w, flatId({kind: 'anim', action: a.uid}, 'clip_' + a.config.entry));
  assert.equal(w.actions.length, 0);
  assert.ok(!flatGraph(w).nodes.some(n => n.kind === 'hkxPlay'));
  assert.equal(parseWorkspace(JSON.stringify(w)).actions.length, 0);
  assert.throws(() => compileWorkspace(w));
});
test('state creation aliases standalone HKX; deleting playback preserves the input and blend', () => {
  let r = addFlat(emptyWorkspace(), '', 'state', {x: 30, y: 40}),
    w = r.workspace;
  // The event registry node is always there; the state became one HKX node.
  const nodes = flatGraph(w).nodes.filter(n => n.kind !== 'eventRegistry');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'hkxPlay');
  const hkx = r.id,
    a = w.actions[0];
  // A new HKX starts with no start and no input (graph/flat.ts makePlaybackAction): a start key brings one.
  assert.deepEqual(a.config.inputs, []);
  a.config.inputs.push({id: 'use', label: '사용', key: 'Num0', gamepad: 0});
  a.config.start.mode = 'input';
  a.config.start.input = 'use';
  w.blends = [{id: 'blend:test', source: `start:${a.uid}|keyInput`, target: hkx, seconds: 0.2}];
  const next = deleteFlat(w, hkx),
    graph = flatGraph(next);
  assert.ok(graph.nodes.some(n => n.kind === 'keyInput'));
  assert.ok(graph.nodes.some(n => n.id === 'blend:test'));
  assert.equal(next.blends[0].target, '');
  assert.ok(!graph.nodes.some(n => n.kind === 'hkxPlay'));
  assert.equal(parseWorkspace(JSON.stringify(next)).blends[0].target, '');
});

test('legacy container deletion keeps independently authored input and blend nodes', () => {
  const w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace,
    a = w.actions[0];
  a.nodeAuthored = false;
  a.config.steps = [];
  a.config.entry = '';
  a.config.start.mode = 'input';
  w.blends = [{id: 'blend:old', source: `start:${a.uid}|keyInput`, target: a.uid, seconds: 0.2}];
  const next = deleteFlat(w, a.uid),
    g = flatGraph(next);
  assert.ok(!g.nodes.some(n => n.id === a.uid));
  assert.ok(g.nodes.some(n => n.kind === 'keyInput'));
  assert.ok(g.nodes.some(n => n.id === 'blend:old'));
  assert.equal(next.blends[0].target, '');
});

test('draft condition connects to exactly the chosen HKX and retains its settings', () => {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
  const before = structuredClone(w.actions[0].config);
  const r = addFlat(w, '', 'stateCondition', {x: 0, y: 200});
  w = r.workspace;
  w.drafts[0].value.config.air = 'allow';
  w.drafts[0].value.config.cooldown = 2.3;
  w = connectFlat(w, r.id, 'anim:a2:|clip_A1');
  assert.equal(w.actions[1].config.cooldown, 2.3);
  assert.deepEqual(w.actions[0].config, before);
  assert.ok(flatGraph(w).edges.some(e => e.source === 'start:a2|stateCondition' && e.target === 'anim:a2:|clip_A1'));
  assert.equal(w.drafts.length, 0);
});

test('draft fields transfer on attach; invalid attachment leaves original unchanged', () => {
  let w = s4sample(),
    a = w.actions[2];
  let r = addFlat(w, a.uid, 'notify:cost', {x: 1, y: 2});
  w = r.workspace;
  w.drafts[0].value.config.cost.stamina = 37;
  w = connectFlat(w, a.uid, r.id);
  assert.equal(w.actions[2].config.cost.stamina, 37);
  r = addFlat(w, a.uid, 'hkxPlay', {x: 2, y: 3});
  w = r.workspace;
  const before = JSON.stringify(w);
  assert.throws(() => connectFlat(w, a.uid, r.id), /하나/);
  assert.equal(JSON.stringify(w), before);
  assert.equal(deleteFlat(w, r.id).drafts.length, 0);
});
