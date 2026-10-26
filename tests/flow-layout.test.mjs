import {test} from 'node:test';
import assert from 'node:assert/strict';
import {regionLayout} from '../src/graph/navigation.ts';
import {arrangeLayout} from '../src/graph/arrange.ts';
import {cardWidth, cardHeight, summaryHeight} from '../src/graph/cardPresentation.ts';
const n = (id, kind, action = 'a') => ({
  id,
  kind,
  action,
  position: {x: 0, y: 0},
  inputs: ['trigger'],
  outputs: kind === 'conditionBranch' ? ['pass', 'fail'] : ['trigger'],
});
const e = (source, target, pin = 'trigger') => ({id: `${source}:${target}:${pin}`, source, target, pin});
function fixture() {
  const nodes = [
    n('entry', 'entry', ''),
    n('event', 'markerReceive'),
    n('startBlend', 'blend'),
    n('ready', 'conditionBranch'),
    n('main', 'conditionBranch'),
    n('female', 'conditionBranch'),
    n('weapon', 'conditionBranch'),
    n('alternative', 'conditionBranch'),
    n('femaleAgain', 'conditionBranch'),
    n('femalePlay', 'hkxPlay', 'f'),
    n('normalPlay', 'hkxPlay', 'n'),
    n('weaponPlay', 'hkxPlay', 'w'),
    n('settings', 'stateCondition'),
    n('exitBlend', 'blend'),
    n('output', 'outputPose'),
  ];
  const edges = [
    e('entry', 'event'),
    e('event', 'startBlend'),
    e('startBlend', 'ready'),
    e('ready', 'main', 'pass'),
    e('main', 'female', 'pass'),
    e('main', 'weapon', 'fail'),
    e('female', 'femalePlay', 'pass'),
    e('female', 'normalPlay', 'fail'),
    e('weapon', 'weaponPlay', 'pass'),
    e('weapon', 'alternative', 'fail'),
    e('alternative', 'femaleAgain', 'pass'),
    e('femaleAgain', 'femalePlay', 'pass'),
    e('femaleAgain', 'normalPlay', 'fail'),
    e('settings', 'ready', 'condition'),
    ...['femalePlay', 'normalPlay', 'weaponPlay'].map(id => e(id, 'exitBlend')),
    e('exitBlend', 'output'),
  ];
  return {nodes, edges};
}
function noOverlap(g, p) {
  assert.equal(Object.keys(p).length, g.nodes.length);
  for (let i = 0; i < g.nodes.length; i++)
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i],
        b = g.nodes[j],
        u = p[a.id],
        v = p[b.id];
      assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y));
      assert.ok(
        u.x + cardWidth(a) <= v.x ||
          v.x + cardWidth(b) <= u.x ||
          u.y + cardHeight(a) <= v.y ||
          v.y + cardHeight(b) <= u.y,
        `${a.id} overlaps ${b.id}`
      );
    }
}
test('entry and nested decisions run horizontally; candidates share their playback rows', () => {
  const g = fixture(),
    p = regionLayout(g);
  const chain = ['entry', 'event', 'startBlend', 'ready', 'main', 'female', 'femalePlay'];
  for (let i = 1; i < chain.length; i++) {
    assert.ok(p[chain[i - 1]].x < p[chain[i]].x);
    assert.equal(p[chain[i]].y, p[chain[0]].y);
  }
  // The HKX the conditions play share one column (10-26), in the order of the lines into them; one stands at its
  // condition's height unless an HKX above it in the column is in the way.
  assert.equal(p.normalPlay.x, p.femalePlay.x);
  assert.equal(p.weaponPlay.x, p.femalePlay.x);
  assert.ok(p.femalePlay.y < p.normalPlay.y && p.normalPlay.y < p.weaponPlay.y);
  assert.ok(p.weaponPlay.y >= p.weapon.y);
  assert.ok(p.weapon.x < p.weaponPlay.x);
  assert.ok(p.exitBlend.x > p.weaponPlay.x);
  assert.ok(p.output.x > p.exitBlend.x);
  noOverlap(g, p);
});
test('layout is independent of previous coordinates and leaves graph data unchanged', () => {
  const g = fixture(),
    before = structuredClone(g),
    p = regionLayout(g);
  assert.deepEqual(g, before);
  const moved = {...g, nodes: g.nodes.map(n => ({...n, position: p[n.id]}))};
  assert.deepEqual(regionLayout(moved), p);
  assert.deepEqual(regionLayout({...g, edges: [...g.edges].reverse()}), p);
});

test('independent entries get separate workflow areas without duplicating a shared result', () => {
  const g = fixture();
  g.nodes.push(n('secondEvent', 'markerReceive', 'b'), n('secondPlay', 'hkxPlay', 'b'));
  g.edges.push(e('entry', 'secondEvent'), e('secondEvent', 'secondPlay'));
  const p = regionLayout(g);
  assert.ok(p.secondPlay.y > p.weaponPlay.y);
  noOverlap(g, p);
});
test('combo transitions sit between successive playbacks and cyclic returns terminate', () => {
  const g = {
    nodes: [
      n('entry', 'entry', ''),
      n('a', 'hkxPlay'),
      n('key', 'keyInput'),
      n('b', 'hkxPlay', 'b'),
      n('back', 'markerReceive', 'b'),
    ],
    edges: [e('entry', 'a'), e('a', 'key'), e('key', 'b'), e('b', 'back'), e('back', 'a')],
  };
  const p = regionLayout(g);
  assert.ok(p.a.x < p.key.x && p.key.x < p.b.x);
  noOverlap(g, p);
});
test('large condition tables and disconnected drafts remain visible and non-overlapping', () => {
  const g = fixture();
  g.nodes.push(
    {...n('table', 'conditionTable'), outputs: Array.from({length: 30}, (_, i) => `choice:${i}:pass`)},
    n('draft', 'blend', '')
  );
  g.edges.push(e('event', 'table'), e('table', 'weaponPlay', 'choice:0:pass'));
  noOverlap(g, regionLayout(g));
  const partial = {
    nodes: [n('input', 'keyInput'), n('blend', 'blend'), n('draft', 'conditionBranch')],
    edges: [e('input', 'blend')],
  };
  noOverlap(partial, regionLayout(partial));
  assert.deepEqual(regionLayout({nodes: [], edges: []}), {});
});

// Arrange B (docs/mockup-arrange): lanes, packed blocks, the registry at the far left, summary HKX cards.
test('a route reads left to right on one row; its second branch starts the row below', () => {
  const g = fixture(),
    p = regionLayout(g);
  const route = ['event', 'startBlend', 'ready', 'main', 'female', 'femalePlay'];
  for (let i = 1; i < route.length; i++) {
    assert.ok(p[route[i - 1]].x < p[route[i]].x, route[i]);
    assert.equal(p[route[i]].y, p.event.y, route[i]);
  }
  // main's fail and female's fail: the next rows, in the column of their pass siblings.
  assert.equal(p.weapon.x, p.female.x);
  assert.ok(p.weapon.y > p.female.y);
  assert.equal(p.normalPlay.x, p.femalePlay.x);
  assert.ok(p.normalPlay.y >= p.femalePlay.y + cardHeight(g.nodes.find(n => n.id === 'femalePlay')));
  noOverlap(g, p);
});
test("an HKX's transition continues its row", () => {
  const g = {
    nodes: [
      n('key', 'keyInput'),
      n('a', 'hkxPlay'),
      n('next', 'keyInput', 'b'),
      n('blend', 'blend', 'b'),
      n('b', 'hkxPlay', 'b'),
    ],
    edges: [e('key', 'a'), e('a', 'next'), e('next', 'blend'), e('blend', 'b')],
  };
  const p = regionLayout(g);
  for (const [l, r] of [
    ['key', 'a'],
    ['a', 'next'],
    ['next', 'blend'],
    ['blend', 'b'],
  ]) {
    assert.ok(p[l].x < p[r].x, r);
    assert.equal(p[r].y, p.key.y, r);
  }
  noOverlap(g, p);
});
test('the entry and the event registry are a column at the far left; a tall registry overlaps nothing', () => {
  const g = fixture();
  g.nodes.push({...n('eventRegistry', 'eventRegistry', ''), inputs: [], outputs: [], measured: {height: 2400}});
  const p = regionLayout(g);
  for (const other of g.nodes.filter(x => !['entry', 'eventRegistry'].includes(x.id)))
    assert.ok(p[other.id].x >= p.eventRegistry.x + cardWidth(g.nodes.at(-1)) + 100, other.id);
  assert.equal(p.entry.x, p.eventRegistry.x);
  assert.ok(p.entry.y < p.eventRegistry.y);
  noOverlap(g, p);
});
test('summary view places HKX cards at their summary height; full view at the measured one', () => {
  const g = fixture();
  for (const x of g.nodes) if (x.kind === 'hkxPlay') x.measured = {height: 800};
  const full = arrangeLayout(g).positions,
    summary = arrangeLayout(g, {summary: true}).positions;
  assert.ok(full.normalPlay.y - full.femalePlay.y >= 800);
  const short = g.nodes.find(x => x.id === 'femalePlay');
  assert.ok(summary.normalPlay.y - summary.femalePlay.y < 800);
  assert.ok(summary.normalPlay.y - summary.femalePlay.y >= summaryHeight(short));
  noOverlap(g, full);
});
test('unconnected workflows fill the pane shape: side by side when wide, stacked when tall', () => {
  const nodes = [],
    edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(n('key' + i, 'keyInput', 'a' + i), n('play' + i, 'hkxPlay', 'a' + i));
    edges.push(e('key' + i, 'play' + i));
  }
  const g = {nodes, edges};
  const wide = arrangeLayout(g, {view: {w: 4000, h: 300}}).positions,
    tall = arrangeLayout(g, {view: {w: 300, h: 4000}}).positions;
  assert.equal(new Set(nodes.filter(x => x.kind === 'hkxPlay').map(x => wide[x.id].y)).size, 1);
  assert.equal(new Set(nodes.filter(x => x.kind === 'hkxPlay').map(x => tall[x.id].x)).size, 1);
  noOverlap(g, wide);
  noOverlap(g, tall);
});
test("blocks list each workflow's cards, for arranging the chosen one alone", () => {
  const g = fixture();
  g.nodes.push(n('secondEvent', 'markerReceive', 'b'), n('secondPlay', 'hkxPlay', 'b'), n('loose', 'blend', ''));
  g.edges.push(e('entry', 'secondEvent'), e('secondEvent', 'secondPlay'));
  const {blocks} = arrangeLayout(g);
  const of = id => blocks.findIndex(b => b.includes(id));
  assert.equal(of('event'), of('weaponPlay'));
  assert.notEqual(of('secondPlay'), of('weaponPlay'));
  assert.equal(of('secondEvent'), of('secondPlay'));
  assert.equal(of('loose'), blocks.length - 1);
  assert.equal(new Set(blocks.flat()).size, blocks.flat().length);
});

// Arrange with a shared stage (docs/mockup-arrange-c, B).
const link = (id, action = 'x') => ({...n(id, 'markerReceive', action), scope: {kind: 'link', link: id}});
function stage({merged = true} = {}) {
  // Three actions started by their own events, each handing over to the same next HKX by the same transition.
  const nodes = [n('entry', 'entry', '')],
    edges = [];
  for (const a of ['a', 'b', 'c']) {
    nodes.push(n('start' + a, 'markerReceive', a), n('play' + a, 'hkxPlay', a));
    edges.push(e('entry', 'start' + a), e('start' + a, 'play' + a));
  }
  nodes.splice(3, 0, n('cond', 'conditionBranch', 'a'), n('rear', 'hkxPlay', 'a'));
  edges.splice(
    edges.findIndex(x => x.source === 'starta'),
    1,
    e('starta', 'cond'),
    e('cond', 'playa', 'pass'),
    e('cond', 'rear', 'fail')
  );
  nodes.push(n('next', 'hkxPlay', 'n'), n('nextOut', 'outputPose', 'n'), n('qte', 'qte', ''));
  edges.push(e('next', 'nextOut'));
  for (const from of ['playa', 'rear', 'playb', 'playc']) {
    const via = merged ? 'hand' : 'hand' + from;
    if (!nodes.some(x => x.id === via)) nodes.push(link(via, from));
    edges.push(e(from, via), e(via, 'next'), e(from, 'qte'));
  }
  return {nodes, edges};
}
const right = (g, p, id) => p[id].x + cardWidth(g.nodes.find(x => x.id === id));
test('transitions several start units share, and where they lead, are one block right of every unit', () => {
  const g = stage(),
    {positions: p, blocks, hub} = arrangeLayout(g);
  assert.deepEqual([...hub].sort(), ['hand', 'next', 'nextOut', 'qte']);
  const units = g.nodes.filter(x => !hub.includes(x.id) && x.kind !== 'entry').map(x => x.id);
  for (const id of hub) assert.ok(p[id].x >= Math.max(...units.map(u => right(g, p, u))) + 200, id);
  // The entrances and the shared QTE: one column, so the lines into the hub end at one bus.
  assert.equal(p.qte.x, p.hand.x);
  assert.ok(p.next.x > p.hand.x);
  // Each start is its own block; a route's conditions and both HKX it picks stay together.
  const of = id => blocks.findIndex(b => b.includes(id));
  assert.equal(of('starta'), of('rear'));
  assert.notEqual(of('starta'), of('startb'));
  assert.notEqual(of('startb'), of('startc'));
  assert.equal(of('hand'), of('next'));
  noOverlap(g, p);
});
test('a transition card per source keeps its row; the HKX they all reach goes to the hub', () => {
  const g = stage({merged: false}),
    {positions: p, hub} = arrangeLayout(g);
  assert.ok(hub.includes('next') && !hub.some(id => id.startsWith('hand')));
  assert.equal(p.handplayb.y, p.playb.y);
  assert.ok(p.handplayb.x > p.playb.x);
  noOverlap(g, p);
});
test('without a shared stage the lanes are unchanged: a transition one unit reaches continues its row', () => {
  const g = stage();
  g.nodes = g.nodes.filter(x => !['startb', 'playb', 'startc', 'playc'].includes(x.id));
  g.edges = g.edges.filter(x => g.nodes.some(m => m.id === x.source) && g.nodes.some(m => m.id === x.target));
  const {positions: p, hub} = arrangeLayout(g);
  assert.deepEqual(hub, []);
  assert.equal(p.hand.y, p.playa.y);
  assert.ok(p.next.x > p.hand.x);
  noOverlap(g, p);
});
// Grapple (10-19): RKO is the failure of Pounding's room check and of GiantSwing's. Placed after the first, the
// second action's line ran back through three cards; a merge between actions now sits right of its last source.
test("a card two actions' flows lead to sits right of both", () => {
  const g = {
    nodes: [
      n('sprint', 'markerReceive', 'pound'),
      n('poundRoom', 'conditionBranch', 'pound'),
      n('pound', 'hkxPlay', 'pound'),
      n('contact', 'markerReceive', 'front'),
      n('mode', 'conditionBranch', 'front'),
      n('resist', 'hkxPlay', 'resist'),
      n('swingRoom', 'conditionBranch', 'front'),
      n('swing', 'hkxPlay', 'swing'),
      n('rko', 'hkxPlay', 'rko'),
      // Pounding goes on further (its QTE stages), so its flow is laid first.
      n('stage1', 'hkxPlay', 'stage1'),
      n('stage2', 'hkxPlay', 'stage2'),
      n('stage3', 'hkxPlay', 'stage3'),
    ],
    edges: [
      e('sprint', 'poundRoom'),
      e('poundRoom', 'pound', 'pass'),
      e('poundRoom', 'rko', 'fail'),
      e('contact', 'mode'),
      e('mode', 'resist', 'pass'),
      e('mode', 'swingRoom', 'fail'),
      e('swingRoom', 'swing', 'pass'),
      e('swingRoom', 'rko', 'fail'),
      e('pound', 'stage1'),
      e('stage1', 'stage2'),
      e('stage2', 'stage3'),
    ],
  };
  const {positions: p} = arrangeLayout(g);
  for (const s of ['poundRoom', 'swingRoom'])
    assert.ok(p.rko.x >= p[s].x + cardWidth(g.nodes.find(x => x.id === s)), s);
  noOverlap(g, p);
});
// Gap-filling (docs/mockup-arrange-pack, 10-19): rows of blocks left half of Grapple's graph empty. The tallest
// block goes first; small blocks fill the room beside it (and under the registry column when they fit there).
test('small blocks fill the room beside a tall block', () => {
  const g = {
    nodes: [{...n('eventRegistry', 'eventRegistry', ''), inputs: [], outputs: [], measured: {height: 400}}],
    edges: [],
  };
  // A tall block: a start with six routes stacked under each other.
  g.nodes.push(n('start', 'keyInput', 'tall'));
  for (let i = 0; i < 6; i++) {
    g.nodes.push(n('tall' + i, 'hkxPlay', 'tall'));
    g.edges.push(e('start', 'tall' + i));
  }
  // Eight small blocks: a start and its HKX.
  for (let i = 0; i < 8; i++) {
    g.nodes.push(n('key' + i, 'keyInput', 's' + i), n('play' + i, 'hkxPlay', 's' + i));
    g.edges.push(e('key' + i, 'play' + i));
  }
  const {positions: p} = arrangeLayout(g, {view: {w: 1600, h: 900}});
  noOverlap(g, p);
  const tallBottom = Math.max(
    ...[0, 1, 2, 3, 4, 5].map(i => p['tall' + i].y + cardHeight(g.nodes.find(x => x.id === 'tall' + i)))
  );
  const smalls = [0, 1, 2, 3, 4, 5, 6, 7].map(i => p['key' + i]);
  // Stacked in the room beside it: rows put one small block per column there and left the rest of its height empty.
  const beside = smalls.filter(s => s.y < tallBottom && s.x > p.tall0.x);
  assert.ok(
    beside.some(s => beside.some(o => o !== s && o.x === s.x)),
    'small blocks stacked beside the tall one'
  );
});
