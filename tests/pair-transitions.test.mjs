import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, emptyWorkspace} from '../src/workspace.ts';
import {switchPlaybackKind} from '../src/actionTypes.ts';
import {parseXml} from '../src/xml.ts';
import {captureGraph} from '../src/graph/document.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {addFlat, connectFlat, flatGraph} from '../src/graph/flat.ts';
import {checklistModel, checklistProjection} from '../src/graph/checklist.ts';
import {checker, needsChecker} from './local.mjs';

// Stage 1 of the UI rework: transitions from and to pairs (runtime Connect with partnerTo), transition events
// on any single HKX, and a key transition's own detection window. Built through the same calls the canvas makes.
const out = resolve('tests/generated/pair-transitions');
mkdirSync(out, {recursive: true});
const runtime = (...args) => {
  const r = spawnSync(checker, args, {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
};
const SOURCE = `<AnimationSet version="4" id="PairLinks">
  <Inputs><Input id="use" key="E"/></Inputs>
  <Pair id="Grab" clip="Animations\\Test\\Grab.hkx"><Start input="use"/></Pair>
  <Pair id="Carry" clip="Animations\\Test\\Carry.hkx"></Pair>
  <Action id="Attacker" clip="Animations\\Test\\Attacker.hkx"/>
  <Action id="Victim" clip="Animations\\Test\\Victim.hkx"/>
  <Action id="Chain" clip="Animations\\Test\\S1.hkx"/>
</AnimationSet>`;
// a1 Grab (pair), a2 Carry (pair), a3 Attacker, a4 Victim, a5 Chain
const hkx = (uid, step = 'A1') => `anim:${uid}:|clip_${step}`;
const base = () => importWorkspaceXml(SOURCE);
const connects = xml =>
  parseXml(xml)
    .children.filter(n => n.name !== 'Inputs' && n.name !== 'EventRegistry')
    .flatMap(a => a.children.filter(c => c.name === 'Connect').map(c => ({from: a.attrs.id, ...c.attrs})));
const check = (name, w) => {
  const xml = compileWorkspace(w),
    file = resolve(out, name + '.xml'),
    again = resolve(out, name + '-again.xml');
  writeFileSync(file, xml);
  runtime(file);
  // Import and save again: the runtime reads the same declarations.
  writeFileSync(again, compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(importWorkspaceXml(xml))))));
  runtime('--compare', file, again);
  return xml;
};
/** "전환 이벤트 추가" on an HKX card, named like its details do, then dragged to the destination HKX. */
function eventTransition(w, from, to, event) {
  const added = addConnected(w, hkx(from), {kind: 'markerReceive', label: '전환 이벤트 추가'}, {x: 0, y: 0});
  const next = added.workspace;
  next.drafts.find(d => d.id === added.id).value.config.start.event = event;
  return connectFlat(next, added.id, to);
}
/** "전환 키 입력 추가", its key set, then dragged to the destination HKX. */
function keyTransition(w, from, to, key) {
  const added = addConnected(w, hkx(from), {kind: 'keyInput', label: '전환 키 입력 추가'}, {x: 0, y: 0});
  const next = added.workspace,
    q = next.drafts.find(d => d.id === added.id).value.config;
  q.inputs.find(i => i.id === q.start.input).key = key;
  return connectFlat(next, added.id, to);
}
const linkNode = l => `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`;

test('a pair card offers transition keys and events; an ordinary card offers transition events', () => {
  const w = base();
  for (const uid of ['a1', 'a3', 'a5']) {
    const adds = contextualAdds(w, hkx(uid));
    assert.ok(
      adds.some(o => o.kind === 'markerReceive' && !o.before),
      uid + ' transition event'
    );
    assert.ok(
      adds.some(o => o.kind === 'keyInput' && !o.before),
      uid + ' transition key'
    );
  }
});

test('a pair event transition starts the attacker and, on its partner pin, the victim', needsChecker, () => {
  let w = eventTransition(base(), 'a1', hkx('a3'), 'Stage1_Attack');
  const l = w.links.at(-1);
  assert.deepEqual(
    [l.from, l.to, l.partnerTo, l.mode, l.event, l.window],
    ['a1', 'a3', '', 'event', 'Stage1_Attack', false]
  );
  assert.equal(w.drafts?.length ?? 0, 0);
  // The partner pin is there before it is connected, and it is labeled on the card by role.
  const node = flatGraph(w).nodes.find(n => n.id === linkNode(l));
  assert.deepEqual(node.outputs, ['trigger', 'partner']);
  assert.equal(node.title, '전환 이벤트');
  w = connectFlat(w, linkNode(l), hkx('a4'), 'partner');
  assert.equal(w.links.at(-1).partnerTo, 'a4');
  const view = checklistProjection(w, checklistModel(w));
  assert.ok(view.edges.some(e => e.source === linkNode(l) && e.target === hkx('a3') && e.pin === 'trigger'));
  assert.ok(view.edges.some(e => e.source === linkNode(l) && e.target === hkx('a4') && e.pin === 'partner'));
  const xml = check('pair-event', w);
  assert.deepEqual(connects(xml), [{from: 'Grab', to: 'Attacker', partnerTo: 'Victim', event: 'Stage1_Attack'}]);
});

test(
  'pair to pair, pair to ordinary and ordinary to pair by key; the partner pin only where the runtime allows',
  needsChecker,
  () => {
    let w = keyTransition(base(), 'a1', hkx('a2'), 'R');
    const toPair = w.links.at(-1);
    assert.equal(toPair.to, 'a2');
    assert.ok(
      !flatGraph(w)
        .nodes.find(n => n.id === linkNode(toPair))
        .outputs.includes('partner')
    );
    assert.throws(() => connectFlat(w, linkNode(toPair), hkx('a4'), 'partner'), /양쪽 일반/);
    // A pair's key transition keeps its own window (only an ordinary HKX shares one).
    assert.equal(toPair.window, true);
    assert.equal(w.actions[0].clipWindows, undefined);
    w = keyTransition(w, 'a2', hkx('a5'), 'T');
    w = connectFlat(w, linkNode(w.links.at(-1)), hkx('a4'), 'partner');
    w = keyTransition(w, 'a3', hkx('a1'), 'G');
    const ordinary = w.links.at(-1);
    assert.deepEqual([ordinary.from, ordinary.to], ['a3', 'a1']);
    assert.equal(w.actions.find(a => a.uid === 'a3').config.kind, 'single', 'the source stays one HKX, not a combo');
    assert.throws(() => connectFlat(w, linkNode(ordinary), hkx('a4'), 'partner'), /페어에서 나가는/);
    const xml = check('pair-keys', w);
    assert.deepEqual(
      connects(xml).map(c => [c.from, c.to, c.partnerTo ?? '']),
      [
        ['Grab', 'Carry', ''],
        ['Carry', 'Chain', 'Victim'],
        ['Attacker', 'Grab', ''],
      ]
    );
  }
);

test(
  'partner mistakes are refused: the attacker again, a pair, or moving the attacker to a pair clears it',
  needsChecker,
  () => {
    let w = eventTransition(base(), 'a1', hkx('a3'), 'Go');
    const l = w.links.at(-1);
    assert.throws(() => connectFlat(w, linkNode(l), hkx('a3'), 'partner'), /다른 동작/);
    assert.throws(() => connectFlat(w, linkNode(l), hkx('a2'), 'partner'), /양쪽 일반/);
    w = connectFlat(w, linkNode(l), hkx('a4'), 'partner');
    w = connectFlat(w, linkNode(l), hkx('a2'));
    assert.deepEqual([w.links.at(-1).to, w.links.at(-1).partnerTo], ['a2', '']);
    check('pair-retarget', w);
  }
);

test('an ordinary HKX gets transition events too, and a duplicate event from one HKX is refused', needsChecker, () => {
  let w = eventTransition(base(), 'a3', hkx('a4'), 'Chain_Go');
  assert.deepEqual(connects(check('ordinary-event', w)), [{from: 'Attacker', to: 'Victim', event: 'Chain_Go'}]);
  assert.throws(() => eventTransition(w, 'a3', hkx('a1'), 'Chain_Go'), /이미 연결된 이벤트/);
});

test('a key transition keeps its own detection window when asked, through save and XML', needsChecker, () => {
  let w = base();
  for (const a of w.actions) if (!a.pair) a.nodeAuthored = true;
  w = keyTransition(w, 'a3', hkx('a4'), 'H');
  w = keyTransition(w, 'a3', hkx('a1'), 'J');
  const [shared, own] = w.links.slice(-2);
  own.ownWindow = true;
  own.open = {...own.open, seconds: 0.1};
  const saved = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(saved.links.find(l => l.id === own.id).ownWindow, true);
  assert.equal(saved.links.find(l => l.id === shared.id).ownWindow, undefined);
  const windows = parseXml(check('own-window', saved))
    .children.find(n => n.attrs.id === 'Attacker')
    .children.filter(c => c.name === 'Connect')
    .map(c => [c.attrs.to, c.children.find(x => x.name === 'Window').attrs.from]);
  assert.deepEqual(windows, [
    ['Victim', '0.45'],
    ['Grab', '0.1'],
  ]);
  const bad = captureGraph(w);
  bad.nodes.find(n => n.id === 'link:' + own.id).data.ownWindow = false;
  assert.throws(() => parseWorkspace(JSON.stringify(bad)), /감지 구간/);
});

test('on cards made in the editor the partner line reaches the victim HKX and the pin stays', () => {
  // Cards made with "＋ HKX 재생" are node-authored: an action shows as its HKX only (no state node).
  let w = emptyWorkspace();
  for (let i = 0; i < 4; i++) w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
  w = switchPlaybackKind(w, 'a1', 'pair');
  w = switchPlaybackKind(w, 'a2', 'pair');
  w = keyTransition(w, 'a1', hkx('a2'), 'R');
  w = keyTransition(w, 'a1', hkx('a3'), 'T');
  const l = w.links.at(-1);
  w = connectFlat(w, linkNode(l), hkx('a4'), 'partner');
  assert.equal(w.links.at(-1).partnerTo, 'a4');
  for (const graph of [flatGraph(w), checklistProjection(w, checklistModel(w))]) {
    assert.deepEqual(graph.nodes.find(n => n.id === linkNode(l)).outputs, ['trigger', 'partner']);
    assert.ok(graph.edges.some(e => e.source === linkNode(l) && e.target === hkx('a4') && e.pin === 'partner'));
  }
});
