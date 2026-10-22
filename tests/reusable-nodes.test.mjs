import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace, addLink} from '../src/workspace.ts';
import {addFlat, connectFlat, flatGraph, deleteFlat} from '../src/graph/flat.ts';
import {shareRules, shareNodeSettings, synchronizeRules, compactGraph} from '../src/graph/sharing.ts';
import {blendNodes, editBlend, lowerBlends, animId} from '../src/graph/blends.ts';
import {disconnectEdge, lowerDisconnected, visibleEdges} from '../src/graph/disconnect.ts';
import {captureGraph} from '../src/graph/document.ts';
import {nodeSettings} from '../src/graph/nodeSettings.ts';
import {shareCondition} from '../src/graph/reuseConnection.ts';
function sample() {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) w = addFlat(w, '', 'playNode', {x: i * 400, y: 200}).workspace;
  w.actions.forEach((a, i) => {
    a.config.steps[0].clip = `animations\\attack${i}.hkx`;
    a.config.recovery.enabled = i === 0;
    a.config.recovery.at.seconds = 0.5;
  });
  const [a, b] = w.actions,
    play = x => animId(x.uid, 'clip_' + x.config.entry);
  return {w, a, b, pa: play(a), pb: play(b)};
}
test('two playbacks directly reuse one recovery and one exit blend; edits, cuts and save retain each path', () => {
  let {w, a, b, pa, pb} = sample();
  w.blends = [{id: 'Blend', source: pa, target: animId(a.uid, 'outputPose'), seconds: 0.2}];
  w = connectFlat(w, pb, 'notify:' + a.uid + '|recovery');
  w = connectFlat(w, pb, 'Blend');
  let graph = compactGraph(w, flatGraph(w));
  assert.equal(graph.nodes.filter(n => n.kind === 'blend').length, 1);
  assert.equal(graph.nodes.filter(n => n.notify === 'recovery').length, 1);
  assert.ok(graph.edges.some(e => e.source === pb && e.target === 'Blend'));
  let lowered = lowerBlends(w);
  assert.ok(
    lowered.actions.every(
      a => a.config.exitBlend === 0.2 && a.config.recovery.at.seconds === 0.5 && a.config.recovery.enabled
    )
  );
  const changed = structuredClone(w);
  changed.actions[0].config.recovery.at.seconds = 0.7;
  w = synchronizeRules(w, changed);
  w = editBlend(w, 'Blend', {seconds: 0.4});
  assert.ok(lowerBlends(w).actions.every(a => a.config.exitBlend === 0.4 && a.config.recovery.at.seconds === 0.7));
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), compileWorkspace(w));
  graph = compactGraph(w, flatGraph(w));
  const edge = graph.edges.find(e => e.source === pb && e.target === 'notify:' + a.uid + '|recovery');
  assert.ok(edge);
  const cut = disconnectEdge(w, edge);
  lowered = lowerDisconnected(cut);
  assert.equal(lowered.actions[0].config.recovery.enabled, true);
  assert.equal(lowered.actions[1].config.recovery.enabled, false);
  assert.doesNotThrow(() => compileWorkspace(cut));
  assert.ok(!visibleEdges(cut, graph.edges).some(e => e.id === edge.id));
  assert.equal(compileWorkspace(connectFlat(cut, pb, edge.target)), compileWorkspace(w));
  const blendCut = disconnectEdge(
    w,
    graph.edges.find(e => e.source === pb && e.target === 'Blend')
  );
  lowered = lowerBlends(lowerDisconnected(blendCut));
  assert.equal(lowered.actions[0].exitBlendEnabled, true);
  assert.equal(lowered.actions[1].exitBlendEnabled, false);
  assert.doesNotThrow(() => compileWorkspace(blendCut));
  const removed = deleteFlat(w, 'notify:' + a.uid + '|recovery');
  synchronizeRules(w, removed);
  assert.equal(removed.actions[1].config.recovery.enabled, true);
});
test('multiple HKX connections before the output pose do not replace the first binding', () => {
  let {w, a, b, pa, pb} = sample();
  w.blends = [{id: 'Blend', source: pa, target: '', seconds: 0.2}];
  w = connectFlat(w, pb, 'Blend');
  assert.equal(blendNodes(w).length, 2);
  w = connectFlat(w, 'Blend', animId(a.uid, 'outputPose'));
  assert.ok(lowerBlends(w).actions.every(a => a.exitBlendEnabled && a.config.exitBlend === 0.2));
  assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.kind === 'blend').length, 1);
});
test('start blends share seconds while preserving separate input paths', () => {
  let {w, a, b, pa, pb} = sample();
  for (const [i, x] of w.actions.entries()) {
    x.config.start.mode = 'event';
    x.config.start.event = 'Start' + i;
  }
  w.blends = [{id: 'Blend', source: `start:${a.uid}|markerReceive`, target: pa, seconds: 0.2}];
  w = connectFlat(w, 'Blend', pb);
  const second = blendNodes(w).find(x => x.id !== 'Blend');
  assert.equal(second.source, `start:${b.uid}|markerReceive`);
  assert.equal(second.target, pb);
  assert.equal(w.actions[0].config.start.event, 'Start0');
  assert.equal(w.actions[1].config.start.event, 'Start1');
  assert.ok(lowerBlends(w).actions.every(a => a.enterBlendEnabled));
});
test('features, input, actor conditions and extension nodes are shared by direct attachment', () => {
  for (const kind of ['armor', 'iframe', 'rotate', 'cost']) {
    let {w, a, b, pb} = sample();
    if (kind === 'cost') a.config.cost.enabled = true;
    else a.config.slots[kind].enabled = true;
    const id = `notify:${a.uid}|${kind}`;
    w = connectFlat(w, pb, id);
    assert.deepEqual(nodeSettings(w, id), nodeSettings(w, `notify:${b.uid}|${kind}`));
    assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.notify === kind).length, 1);
  }
  for (const kind of ['suppress', 'fireArrow']) {
    let {w, a, b, pb} = sample();
    a.config[kind] =
      kind === 'suppress'
        ? {events: ['OldEvent'], when: 'startable'}
        : {at: {...a.config.recovery.at, basis: 'seconds'}, onRelease: true};
    const id = animId(a.uid, kind);
    w = connectFlat(w, pb, id);
    assert.deepEqual(nodeSettings(w, id), nodeSettings(w, animId(b.uid, kind)));
  }
  let {w, a, b, pb} = sample();
  a.config.start.mode = 'event';
  a.config.start.event = 'SharedStart';
  w = connectFlat(w, `start:${a.uid}|markerReceive`, pb);
  assert.equal(w.actions[1].config.start.event, 'SharedStart');
  w.actions[0].config.cooldown = 0.7;
  w = connectFlat(w, `start:${a.uid}|stateCondition`, pb);
  assert.equal(w.actions[1].config.cooldown, 0.7);
});
test('shared condition configuration preserves per-path destinations', () => {
  let {w, a, b} = sample();
  a.flow = {
    entry: 'Female',
    tests: [{id: 'Female', kind: 'female', subject: 'self', minimum: 0, pass: {action: a.uid}}],
  };
  // Shared only when chosen ("이 조건을 다른 동작에도 공유"); a drag changes the route (next test).
  w = shareCondition(w, `flow:${a.uid}:Female`, b.uid);
  assert.equal(w.actions[0].flow.tests[0].pass.action, a.uid);
  assert.equal(w.actions[1].flow.tests[0].pass.action, b.uid);
  const before = w,
    next = structuredClone(w);
  next.actions[0].flow.tests[0].negate = true;
  w = synchronizeRules(before, next);
  assert.ok(w.actions.every(a => a.flow.tests[0].negate));
  assert.equal(w.actions[1].flow.tests[0].pass.action, b.uid);
  assert.doesNotThrow(() => compileWorkspace(w));
});
test('dragging a condition route that is in use onto another HKX changes the route; it is not shared', () => {
  let {w, a, b, pb} = sample();
  a.flow = {
    entry: 'Female',
    tests: [{id: 'Female', kind: 'female', subject: 'self', minimum: 0, pass: {action: a.uid}}],
  };
  w = connectFlat(w, `flow:${a.uid}:Female`, pb, 'pass');
  assert.deepEqual(w.actions[0].flow.tests[0].pass, {action: b.uid});
  assert.equal(w.actions[1].flow, undefined);
  assert.equal(w.sharedRules?.length ?? 0, 0);
  assert.throws(() => shareCondition(w, `flow:${a.uid}:Female`, a.uid), /다른 동작/);
});
test('grouping retains XML and shares transition-independent settings without coupling routes', () => {
  let {w, a, b} = sample();
  a.config.steps[0].clip = b.config.steps[0].clip = 'animations\\same.hkx';
  const xml = compileWorkspace(w),
    shared = shareRules(w);
  assert.equal(compileWorkspace(shared), xml);
  assert.ok(shared.sharedRules.some(g => g.kind === 'node' && g.members.some(m => m.includes('|clip_'))));
});

test('a used transition blend attaches to another existing path without changing its destination', () => {
  let {w, a, b, pa, pb} = sample();
  for (let i = 0; i < 2; i++) w = addFlat(w, '', 'playNode', {x: 800, y: i * 250}).workspace;
  w.actions.forEach(x => (x.config.steps[0].clip = 'animations\\test.hkx'));
  const [first, second, third, fourth] = w.actions;
  const link1 = addLink(w, first.uid, second.uid);
  link1.mode = 'event';
  link1.event = 'Next1';
  w.links.push(link1);
  const link2 = addLink(w, third.uid, fourth.uid);
  link2.mode = 'event';
  link2.event = 'Next2';
  w.links.push(link2);
  w.blends = [{id: 'Blend', source: `link:${link1.id}|markerReceive`, target: pb, seconds: 0.2}];
  const original = structuredClone(w),
    play = animId(third.uid, 'clip_' + third.config.entry);
  w = connectFlat(w, play, 'Blend');
  assert.deepEqual(w.links, original.links);
  let lowered = lowerBlends(w);
  assert.equal(lowered.links[0].blend, 0.2);
  assert.equal(lowered.links[1].blend, 0.2);
  assert.deepEqual(w.blends[0], original.blends[0]);
  assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.kind === 'blend').length, 1);
  w = editBlend(w, 'Blend', {seconds: 0.35});
  assert.ok(lowerBlends(w).links.every(l => l.blend === 0.35));
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), compileWorkspace(w));
  const graph = compactGraph(w, flatGraph(w)),
    edge = graph.edges.find(e => e.target === 'Blend' && e.source === `link:${link2.id}|markerReceive`);
  assert.ok(edge);
  lowered = lowerBlends(lowerDisconnected(disconnectEdge(w, edge)));
  assert.equal(lowered.links[0].blend, 0.35);
  assert.equal(lowered.links[1].blend, undefined);
  const incoming = connectFlat(original, 'Blend', animId(fourth.uid, 'clip_' + fourth.config.entry));
  assert.deepEqual(incoming.links, original.links);
  assert.ok(lowerBlends(incoming).links.every(l => l.blend === 0.2));
});

test('one blend can share entry and exit seconds without rewriting either role', () => {
  let {w, a, b, pa, pb} = sample();
  a.config.start.mode = 'event';
  a.config.start.event = 'Start';
  w.blends = [{id: 'Blend', source: `start:${a.uid}|markerReceive`, target: pa, seconds: 0.2}];
  w = connectFlat(w, pb, 'Blend');
  assert.equal(w.blends[0].target, pa);
  let lowered = lowerBlends(w);
  assert.equal(lowered.actions[0].enterBlendEnabled, true);
  assert.equal(lowered.actions[1].exitBlendEnabled, true);
  w = connectFlat(w, 'Blend', animId(b.uid, 'outputPose'));
  assert.equal(w.blends[0].target, pa);
  w = editBlend(w, 'Blend', {seconds: 0.3});
  lowered = lowerBlends(w);
  assert.equal(lowered.actions[0].config.enterBlend, 0.3);
  assert.equal(lowered.actions[1].config.exitBlend, 0.3);
  assert.doesNotThrow(() => compileWorkspace(w));
});

test('exit blend connected before a new playback becomes its entry and keeps the original exit', () => {
  let {w, a, b, pa, pb} = sample();
  b.config.start.mode = 'event';
  b.config.start.event = 'StartB';
  w.blends = [{id: 'Blend', source: pa, target: animId(a.uid, 'outputPose'), seconds: 0.2}];
  w = connectFlat(w, 'Blend', pb);
  const lowered = lowerBlends(w);
  assert.equal(lowered.actions[0].exitBlendEnabled, true);
  assert.equal(lowered.actions[1].enterBlendEnabled, true);
  assert.equal(w.blends[0].source, pa);
  assert.equal(w.blends[0].target, animId(a.uid, 'outputPose'));
  assert.doesNotThrow(() => compileWorkspace(w));
});
