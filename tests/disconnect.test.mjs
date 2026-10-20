import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {flatGraph, connectFlat} from '../src/graph/flat.ts';
import {compactGraph, shareRules} from '../src/graph/sharing.ts';
import {disconnectEdge, lowerDisconnected, visibleEdges} from '../src/graph/disconnect.ts';
import {captureGraph} from '../src/graph/document.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {parseWorkspace, compileWorkspace} from '../src/workspace.ts';
const graph = w => compactGraph(w, flatGraph(w));
test('shared feature cut retains authoring nodes, affects only that actor and roundtrips', () => {
  const base = s4sample();
  for (const a of base.actions.filter(a => !a.pair)) a.config.rotationLocked = true;
  const w = shareRules(base),
    g = graph(w),
    edge = g.edges.find(e => e.target.includes('|rotate'));
  assert.ok(edge);
  const cut = disconnectEdge(w, edge),
    lower = lowerDisconnected(cut);
  assert.deepEqual(cut.actions, w.actions);
  assert.equal(graph(cut).nodes.length, g.nodes.length);
  assert.ok(!visibleEdges(cut, graph(cut).edges).some(e => e.id === edge.id));
  const owner = edge.origins[0].target.split(':')[1].split('|')[0];
  assert.equal(lower.actions.find(a => a.uid === owner).config.rotationLocked, false);
  assert.ok(lower.actions.filter(a => !a.pair && a.uid !== owner).every(a => a.config.rotationLocked));
  const loaded = parseWorkspace(JSON.stringify(captureGraph(cut)));
  assert.deepEqual(loaded.disconnections, cut.disconnections);
  const restored = connectFlat(cut, edge.source, edge.target, edge.pin);
  assert.equal(compileWorkspace(restored), compileWorkspace(w));
});
test('start binding clears trigger, not action or input data', () => {
  const w = s4sample(),
    g = graph(w),
    edge = g.edges.find(e => e.source === 'entry');
  const cut = disconnectEdge(w, edge),
    lower = lowerDisconnected(cut),
    owner = flatGraph(w).nodes.find(n => n.id === edge.origins[0].target).action;
  assert.equal(lower.actions.find(a => a.uid === owner).config.start.mode, 'none');
  assert.deepEqual(cut.actions, w.actions);
});
test('shared blend endpoint cut removes its runtime bindings and retains the authoring terminal', () => {
  const w = shareRules(s4sample()),
    g = graph(w),
    edge = g.edges.find(e => e.target === 'shared:outputPose');
  const cut = disconnectEdge(w, edge);
  assert.doesNotThrow(() => compileWorkspace(cut));
  assert.ok(graph(cut).nodes.some(n => n.id === 'shared:outputPose'));
  assert.equal(compileWorkspace(connectFlat(cut, edge.source, edge.target, edge.pin)), compileWorkspace(w));
});
test('partner output cut preserves initiator link and its blend', () => {
  const w = s4sample(),
    link = w.links.find(l => l.partnerTo);
  assert.ok(link);
  const g = graph(w),
    edge = g.edges.find(e => e.pin === 'partner' && e.origins?.some(b => b.source.startsWith('link:' + link.id + '|')));
  assert.ok(edge);
  const lower = lowerDisconnected(disconnectEdge(w, edge));
  const changed = lower.links.find(l => l.id === link.id);
  assert.ok(changed);
  assert.equal(changed.partnerTo, '');
  assert.equal(changed.to, link.to);
  assert.equal(changed.from, link.from);
});
test('deleting a condition route line empties that route in the document (stage 2), keeping the other', () => {
  const w = s4sample(),
    a = w.actions[0];
  a.flow = {
    entry: 'Alive',
    tests: [
      {
        id: 'Alive',
        kind: 'alive',
        subject: 'self',
        minimum: 0,
        pass: {action: a.uid},
        fail: {action: w.actions[1].uid},
      },
    ],
  };
  const g = graph(w),
    edge = g.edges.find(e => e.source === 'flow:' + a.uid + ':Alive' && e.pin === 'pass');
  const cut = disconnectEdge(w, edge);
  // Emptied in the document, not kept as a hidden line: the route is free for a new destination.
  assert.equal(cut.actions[0].flow.tests[0].pass, undefined);
  assert.deepEqual(cut.actions[0].flow.tests[0].fail, a.flow.tests[0].fail);
  assert.equal(cut.disconnections?.length ?? 0, 0);
  assert.ok(contextualAdds(cut, 'flow:' + a.uid + ':Alive').some(o => o.label === '통과 → HKX 재생 추가'));
});

test('grouping after disconnection preserves the cut and allows reconnection through the shared node', () => {
  const w = s4sample();
  for (const a of w.actions.filter(a => !a.pair)) a.config.rotationLocked = true;
  const original = graph(w),
    edge = original.edges.filter(e => e.target.includes('|rotate')).at(-1);
  const grouped = shareRules(disconnectEdge(w, edge)),
    g = graph(grouped);
  const route = g.edges.find(e => e.source === edge.source && e.origins.some(b => b.target === edge.origins[0].target));
  assert.ok(route);
  assert.ok(!visibleEdges(grouped, g.edges).some(e => e.id === route.id));
  const restored = connectFlat(grouped, route.source, route.target, route.pin);
  assert.equal(restored.disconnections.length, 0);
});
