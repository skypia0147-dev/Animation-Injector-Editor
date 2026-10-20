import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neighbors, actionFlow, regionLayout, fitsAt} from '../src/graph/navigation.ts';
import {beginFocus, retainFocus} from '../src/graph/focusSession.ts';
import {s4sample} from '../src/s4sample.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {moveNodes} from '../src/graph/projection.ts';
import {tableProjection} from '../src/graph/conditionTables.ts';
import {emptyWorkspace, addAction, compileWorkspace} from '../src/workspace.ts';
const n = (id, action, kind = 'hkxPlay') => ({
  id,
  action,
  kind,
  position: {x: 0, y: 0},
  inputs: ['trigger'],
  outputs: ['trigger'],
});
const e = (source, target) => ({id: source + '>' + target, source, target, pin: 'trigger'});

test('region arrangement follows nested pass/fail routes regardless of IDs and storage order', () => {
  const nodes = [
    n('a-fail', 'owner', 'conditionBranch'),
    n('unconnected', 'owner', 'conditionBranch'),
    n('z-first', 'owner', 'conditionBranch'),
    n('b-pass', 'owner', 'conditionBranch'),
    n('entry', '', 'entry'),
    n('anim-fail', 'f'),
    n('anim-pass', 'p'),
  ];
  const g = {
    nodes,
    edges: [
      e('entry', 'z-first'),
      {...e('z-first', 'a-fail'), pin: 'fail'},
      {...e('z-first', 'b-pass'), pin: 'pass'},
      {...e('a-fail', 'anim-fail'), pin: 'pass'},
      {...e('b-pass', 'anim-pass'), pin: 'pass'},
    ],
  };
  const before = structuredClone(g),
    p = regionLayout(g);
  assert.ok(p['z-first'].x < p['b-pass'].x);
  assert.equal(p['z-first'].y, p['b-pass'].y);
  assert.ok(p['b-pass'].y < p['a-fail'].y);
  assert.ok(p['a-fail'].y < p.unconnected.y);
  assert.ok(p['anim-pass'].y < p['anim-fail'].y);
  assert.deepEqual(g, before);
  assert.deepEqual(regionLayout({...g, edges: [...g.edges].reverse()}), p);
});

test('condition table ports and target placement use route order rather than stored test order', () => {
  const w = emptyWorkspace();
  for (let i = 0; i < 3; i++) w.actions.push(addAction(w, 'single'));
  const [a, b, c] = w.actions;
  for (const action of w.actions) {
    action.nodeAuthored = true;
    action.config.steps[0].clip = 'animations\\Test.hkx';
  }
  a.flow = {
    entry: 'Z',
    tests: [
      {id: 'A', kind: 'female', subject: 'self', minimum: 0, pass: {action: c.uid}},
      {id: 'Z', kind: 'combat', subject: 'self', minimum: 0, pass: {action: b.uid}, fail: {node: 'A'}},
    ],
  };
  w.conditionTables = [a.uid];
  const g = tableProjection(w, flatGraph(w)),
    table = g.nodes.find(n => n.kind === 'conditionTable');
  assert.ok(table.outputs.indexOf('choice:Z:pass') < table.outputs.indexOf('choice:A:pass'));
  const layout = regionLayout(g);
  assert.ok(layout[`anim:${b.uid}:|clip_A1`].y < layout[`anim:${c.uid}:|clip_A1`].y);
  assert.equal(compileWorkspace(moveNodes(w, {kind: 'root'}, layout)), compileWorkspace(w));
});

test('region arrangement terminates with shared destinations and cyclic combo routes without overlap', () => {
  const nodes = [n('entry', '', 'entry'), n('a', 'a'), n('b', 'b'), n('shared', 'a', 'notify')];
  const g = {nodes, edges: [e('entry', 'a'), e('a', 'b'), e('b', 'a'), e('a', 'shared'), e('b', 'shared')]};
  const p = regionLayout(g);
  assert.equal(Object.keys(p).length, nodes.length);
  assert.equal(new Set(Object.values(p).map(p => p.x + ',' + p.y)).size, nodes.length);
  assert.deepEqual(regionLayout(g), p);
});
test('neighbors include only immediate connections', () => {
  const g = {nodes: [n('a', 'a'), n('b', 'b'), n('c', 'c')], edges: [e('a', 'b'), e('b', 'c')]};
  assert.deepEqual(neighbors(g, 'a'), ['a', 'b']);
});
test('flow keeps selected playback routes, shows a sibling playback it hands over to and excludes shared users', () => {
  const g = {
    nodes: [
      n('entry', '', 'entry'),
      n('a', 'a'),
      n('b', 'b'),
      n('c', 'c'),
      n('fx', 'a', 'spellGroup'),
      n('input', 'a', 'keyInput'),
    ],
    edges: [
      e('entry', 'input'),
      e('input', 'a'),
      e('entry', 'c'),
      e('a', 'b'),
      e('b', 'a'),
      e('a', 'fx'),
      e('c', 'fx'),
    ],
  };
  const v = actionFlow(g, 'a');
  assert.deepEqual(new Set(v.nodes.map(n => n.id)), new Set(['entry', 'input', 'a', 'fx', 'b']));
  assert.ok(v.edges.every(e => v.nodes.some(n => n.id === e.source) && v.nodes.some(n => n.id === e.target)));
  // The playback it hands over to: one step, dimmed, not entered (its way back is not this flow).
  assert.deepEqual(
    v.nodes.filter(n => n.neighbor).map(n => n.id),
    ['b']
  );
  assert.ok(!v.edges.some(e => e.source === 'b'));
});
test('region arrangement is deterministic and changes layout only', () => {
  const w = s4sample(),
    g = compactGraph(w, flatGraph(w)),
    positions = regionLayout(g);
  assert.deepEqual(positions, regionLayout(g));
  const next = moveNodes(w, {kind: 'root'}, positions);
  assert.deepEqual(next.actions, w.actions);
  assert.deepEqual(next.links, w.links);
  assert.equal(Object.keys(positions).length, g.nodes.length);
  assert.equal(new Set(Object.values(positions).map(p => p.x + ',' + p.y)).size, g.nodes.length);
  const moved = compactGraph(next, flatGraph(next));
  for (const node of moved.nodes) assert.deepEqual(node.position, positions[node.id]);
});

test('focused flow includes complete camera exit, trims other candidates, shows its transition and never mutates full layout', () => {
  const nodes = [
    n('entry', '', 'entry'),
    n('event', 'dispatch', 'markerReceive'),
    n('table', 'dispatch', 'conditionTable'),
    n('condition', 'other', 'stateCondition'),
    n('a', 'a'),
    n('b', 'b'),
    n('camera', 'other', 'cameraRestore'),
    n('exit', 'a', 'blend'),
    n('otherExit', 'b', 'blend'),
    n('output', '', 'outputPose'),
    n('chain', 'a', 'markerReceive'),
  ];
  const g = {
    nodes,
    edges: [
      e('entry', 'event'),
      e('event', 'table'),
      e('table', 'a'),
      e('table', 'b'),
      e('condition', 'a'),
      e('condition', 'b'),
      e('a', 'camera'),
      e('b', 'camera'),
      e('camera', 'exit'),
      e('camera', 'otherExit'),
      e('exit', 'output'),
      e('otherExit', 'output'),
      e('a', 'chain'),
      e('chain', 'b'),
    ],
  };
  const before = structuredClone(g),
    v = actionFlow(g, 'a');
  assert.deepEqual(
    new Set(v.nodes.map(n => n.id)),
    new Set(['entry', 'event', 'table', 'condition', 'a', 'camera', 'exit', 'output', 'chain', 'b'])
  );
  // b is another candidate of the table and where a's transition leads: shown as the transition's destination.
  assert.ok(v.nodes.find(n => n.id === 'b').neighbor);
  assert.ok(!v.edges.some(e => e.source === 'table' && e.target === 'b'));
  assert.ok(v.edges.some(e => e.source === 'chain' && e.target === 'b'));
  assert.ok(v.edges.some(e => e.source === 'camera' && e.target === 'exit'));
  assert.deepEqual(g, before);
  assert.equal(new Set(v.nodes.map(n => n.position.x + ',' + n.position.y)).size, v.nodes.length);
  assert.ok(v.nodes.find(n => n.id === 'entry').position.x < v.nodes.find(n => n.id === 'a').position.x);
  assert.ok(v.nodes.find(n => n.id === 'a').position.x < v.nodes.find(n => n.id === 'output').position.x);
});
test('selected HKX isolates another clip belonging to the same action', () => {
  const g = {nodes: [n('a', 'owner'), n('b', 'owner')], edges: [e('a', 'b')]};
  assert.deepEqual(
    actionFlow(g, 'owner', 'b').nodes.map(n => n.id),
    ['b']
  );
});

test('incoming transitions remain visible when the previous playback is hidden', () => {
  const g = {nodes: [n('a', 'a'), n('b', 'b'), n('key', 'b', 'keyInput')], edges: [e('b', 'key'), e('key', 'a')]};
  assert.deepEqual(
    actionFlow(g, 'a').nodes.map(n => n.id),
    ['a', 'key']
  );
});

test('incoming shared events keep trigger and partner routes through an entry blend', () => {
  const nodes = [
    n('prior', 'p'),
    n('other', 'o'),
    n('event', 'p', 'markerReceive'),
    n('blend', 'a', 'blend'),
    n('a', 'a'),
    n('b', 'b'),
  ];
  const g = {
    nodes,
    edges: [
      e('prior', 'event'),
      e('other', 'event'),
      e('event', 'blend'),
      e('blend', 'a'),
      {...e('event', 'b'), pin: 'partner'},
    ],
  };
  const before = structuredClone(g),
    v = actionFlow(g, 'a');
  assert.deepEqual(new Set(v.nodes.map(n => n.id)), new Set(['event', 'blend', 'a']));
  assert.equal(v.edges.length, 2);
  assert.ok(v.nodes.find(n => n.id === 'event').summary.includes('이전 동작에서 전환'));
  assert.deepEqual(g, before);
  const partner = actionFlow(g, 'b');
  assert.deepEqual(new Set(partner.nodes.map(n => n.id)), new Set(['event', 'b']));
  assert.equal(partner.edges[0].pin, 'partner');
});

test('a neighbourhood too large for the smallest zoom is reported so the selected card is centred instead', () => {
  const card = (x, y) => ({x, y, w: 380, h: 1400});
  const pane = {w: 1000, h: 530};
  assert.equal(fitsAt([card(0, 0), card(500, 0)], pane, 0.22, 0.08), true);
  // A pair with fourteen tall destination cards stacked below it: 21000 units high at 8% would need 1680 px.
  const crowded = [card(0, 0), ...Array.from({length: 14}, (_, i) => card(1500, i * 1500))];
  assert.equal(fitsAt(crowded, pane, 0.22, 0.08), false);
  assert.equal(fitsAt([], pane, 0.22, 0.08), true);
});
test('a single-flow view keeps its neighbors dimmed and draws only the lines into them', () => {
  const g = {
    nodes: [
      n('start', 'a', 'markerReceive'),
      n('a', 'a'),
      n('hand', 'a', 'markerReceive'),
      n('b', 'b'),
      n('fx', 'a', 'qte'),
    ],
    edges: [e('start', 'a'), e('a', 'hand'), e('hand', 'b'), e('a', 'fx'), e('b', 'fx')],
  };
  const session = beginFocus(g, 'a'),
    {graph} = retainFocus(g, session);
  assert.deepEqual(session.neighbors, ['b']);
  assert.ok(graph.nodes.find(x => x.id === 'b').neighbor);
  assert.ok(!graph.nodes.find(x => x.id === 'a').neighbor);
  // b also uses the shared QTE card; that line belongs to b's own flow.
  assert.ok(graph.edges.some(x => x.source === 'hand' && x.target === 'b'));
  assert.ok(!graph.edges.some(x => x.source === 'b'));
});
test("a single-flow view shows the other HKX its own condition picks, not another action's candidates", () => {
  const g = {
    nodes: [
      n('start', 'a', 'markerReceive'),
      n('room', 'a', 'conditionBranch'),
      n('a', 'a'),
      n('fallback', 'f'),
      n('dispatch', 'd', 'conditionTable'),
      n('sibling', 's'),
    ],
    edges: [e('start', 'room'), e('room', 'a'), e('room', 'fallback'), e('dispatch', 'room'), e('dispatch', 'sibling')],
  };
  const v = actionFlow(g, 'a');
  assert.deepEqual(
    v.nodes.filter(x => x.neighbor).map(x => x.id),
    ['fallback']
  );
  assert.ok(v.edges.some(x => x.source === 'room' && x.target === 'fallback'));
  assert.ok(!v.nodes.some(x => x.id === 'sibling'));
  const at = id => v.nodes.find(x => x.id === id).position;
  assert.equal(at('fallback').x, at('a').x);
});

test('a carry putdown flow shows the lift that hands over to it and the lift start route', async () => {
  const {readFileSync} = await import('node:fs');
  const {importWorkspaceXml} = await import('../src/importXml.ts');
  const {checklistProjection} = await import('../src/graph/checklist.ts');
  const w = importWorkspaceXml(readFileSync(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url), 'utf8'));
  const g = checklistProjection(w),
    card = id =>
      g.nodes.find(n => n.kind === 'hkxPlay' && n.action === w.actions.find(a => a.config.actionId === id).uid);
  const lift = card('GrappleCarryLift'),
    lower = card('GrappleCarryLower');
  const flow = actionFlow(g, lower.action, lower.id);
  const shown = new Map(flow.nodes.map(n => [n.id, n]));
  assert.ok(shown.has(lift.id) && !shown.get(lift.id).neighbor);
  assert.ok(flow.edges.some(e => e.source === lift.id && e.target === lower.id));
  // The lift's start event comes too; the lift's other outputs do not.
  const start = g.edges.filter(e => e.target === lift.id).map(e => e.source);
  assert.ok(start.length && start.every(id => shown.has(id)));
  assert.ok(flow.nodes.every(n => n.id === lift.id || n.id === lower.id || n.kind !== 'hkxPlay'));
});
