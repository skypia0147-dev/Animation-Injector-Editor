import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {addDetachedCondition, connectFlat, deleteFlat, flatGraph} from '../src/graph/flat.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {disconnectEdge} from '../src/graph/disconnect.ts';
import {conditionStarts, isLoose} from '../src/graph/conditionBinding.ts';
import {makeDraft} from '../src/graph/drafts.ts';

// docs/mockup-free-conditions: a condition belongs to the lines. One made while another action was chosen (a3, a
// single) is loose there; a1's start drawn into it takes it, with what follows.
const scene = () => {
  let w = s4sample();
  const r = addDetachedCondition(w, 'a3', {x: 400, y: 600});
  w = connectFlat(r.workspace, r.id, 'anim:a1:|clip_A1', 'pass');
  return {w, card: r.id};
};
// The start's line reaches its first condition through its enter blend card.
const edge = (w, target) =>
  compactGraph(w, flatGraph(w)).edges.find(e => e.source === 'anim:a1:|blendIn' && e.target === target);

test('a loose condition takes any destination and moves to the start drawn into it', () => {
  const {w, card} = scene();
  assert.equal(isLoose(w, 'a3', card.split(':')[2]), true, 'made beside a3, judged by nothing');
  assert.equal(w.actions.find(a => a.uid === 'a3').config.start.mode, 'input', 'a3 keeps its start');
  const next = connectFlat(w, 'start:a1|keyInput', card);
  const a1 = next.actions.find(a => a.uid === 'a1').flow;
  assert.ok(a1.tests.some(t => t.id === a1.entry && t.pass?.action === 'a1'));
  assert.equal(next.actions.find(a => a.uid === 'a3').flow, undefined, 'nothing left beside a3');
  const moved = `flow:a1:${a1.entry}`;
  assert.ok(conditionStarts(next).get(moved).length >= 1);
  assert.deepEqual(
    flatGraph(next).nodes.find(n => n.id === moved).position,
    flatGraph(w).nodes.find(n => n.id === card).position,
    'the card stays where it was'
  );
  assert.match(compileWorkspace(next), /<Flow entry="/);
});

test('cutting the start line leaves the start going nowhere and its conditions loose; drawing it again restores', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card),
    entry = bound.actions.find(a => a.uid === 'a1').flow.entry,
    cond = `flow:a1:${entry}`;
  const cut = disconnectEdge(bound, edge(bound, cond));
  const f = cut.actions.find(a => a.uid === 'a1').flow;
  assert.equal(f.unlinked, true);
  assert.equal(f.entry, '');
  assert.equal(cut.disconnections, undefined, 'a document edit, not a hidden cut');
  assert.equal(isLoose(cut, 'a1', entry), true);
  assert.ok(
    !flatGraph(cut).edges.some(e => ['a1', 'anim:a1:|clip_A1'].includes(e.target) && e.source === 'anim:a1:|blendIn')
  );
  const issues = validateWorkspace(cut);
  assert.ok(!issues.some(i => i.level === 'error'), JSON.stringify(issues.filter(i => i.level === 'error')));
  assert.ok(issues.some(i => /이어진 곳이 없어/.test(i.message)));
  assert.ok(issues.some(i => /판단되지 않는 조건/.test(i.message)));
  const again = connectFlat(cut, 'start:a1|keyInput', cond);
  assert.equal(again.actions.find(a => a.uid === 'a1').flow.entry, entry);
  assert.equal(again.actions.find(a => a.uid === 'a1').flow.unlinked, undefined);
  // Drawn to its own HKX instead: it plays it directly, the condition loose.
  const direct = connectFlat(cut, 'start:a1|keyInput', 'anim:a1:|clip_A1');
  assert.equal(direct.actions.find(a => a.uid === 'a1').flow.detached, true);
  assert.ok(
    flatGraph(direct).edges.some(e => e.source === 'anim:a1:|blendIn' && ['a1', 'anim:a1:|clip_A1'].includes(e.target))
  );
});

test('deleting the first condition leaves the start going nowhere; deleting the start card frees its conditions', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card),
    entry = bound.actions.find(a => a.uid === 'a1').flow.entry;
  const gone = deleteFlat(bound, `flow:a1:${entry}`);
  assert.deepEqual(gone.actions.find(a => a.uid === 'a1').flow, {entry: '', tests: [], unlinked: true});
  assert.ok(!validateWorkspace(gone).some(i => i.level === 'error'));
  const noStart = deleteFlat(bound, 'start:a1|keyInput');
  assert.equal(noStart.actions.find(a => a.uid === 'a1').config.start.mode, 'none');
  assert.ok(!(conditionStarts(noStart).get(`flow:a1:${entry}`) ?? []).includes('use'));
});

test('a loose condition linked after another flow`s condition joins that flow', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card),
    entry = bound.actions.find(a => a.uid === 'a1').flow.entry;
  const r = addDetachedCondition(bound, 'a3', {x: 800, y: 600});
  const joined = connectFlat(r.workspace, `flow:a1:${entry}`, r.id, 'fail');
  const f = joined.actions.find(a => a.uid === 'a1').flow,
    fail = f.tests.find(t => t.id === entry).fail;
  assert.ok(fail && 'node' in fail && f.tests.some(t => t.id === fail.node));
  assert.equal(isLoose(joined, 'a1', fail.node), false, 'judged by a1 now');
});

test('a room check measures at the pair its pass leads to; no field, none reached is an error', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card),
    a1 = bound.actions.find(a => a.uid === 'a1'),
    t = a1.flow.tests.find(t => t.id === a1.flow.entry);
  Object.assign(t, {
    kind: 'space',
    subject: 'partner',
    space: {candidate: 'a5', distance: 250, direction: 'partnerBack'},
  });
  t.pass = {action: 'a2'};
  const xml = compileWorkspace(bound),
    a2 = bound.actions.find(a => a.uid === 'a2').config.actionId;
  assert.match(xml, new RegExp(`kind="space"[^>]*candidate="${a2}"`), 'the stored a5 is not used');
  t.pass = {action: 'a4'};
  assert.ok(
    validateWorkspace(bound).some(i => i.level === 'error' && /통과 쪽에 페어가 없어/.test(i.message)),
    'a single action on the pass side gives nowhere to measure'
  );
});

// The split at save (docs/mockup-free-conditions ④): an action that judges itself and is also played by another
// judgement is written as its HKX alone plus a selecting action holding its start and conditions.
test('a second start on a condition that plays its own action is written as two selecting actions', () => {
  const {w, card} = scene();
  let next = connectFlat(w, 'start:a1|keyInput', card);
  const entry = next.actions.find(a => a.uid === 'a1').flow.entry;
  const key = makeDraft(next, 'a1', 'markerReceive', {x: -300, y: 900});
  key.workspace.drafts.find(d => d.id === key.id).value.config.start.event = 'Other_Contact';
  next = connectFlat(key.workspace, key.id, `flow:a1:${entry}`);
  assert.deepEqual(next.actions.at(-1).flow.follow, {owner: 'a1', test: entry});
  assert.ok(!validateWorkspace(next).some(i => i.level === 'error'));
  const xml = compileWorkspace(next),
    id = next.actions.find(a => a.uid === 'a1').config.actionId,
    block = name => xml.slice(xml.indexOf(`id="${name}"`)).split(/<\/(?:Action|Pair)>/)[0];
  assert.doesNotMatch(block(id), /<Start|<Flow/, 'the HKX alone');
  assert.match(block(id), /clip="/);
  assert.match(block(id + '_Select'), /<Start [^>]*input|<Start [^>]*key/);
  assert.match(block(id + '_Select'), new RegExp(`<Play [^>]*action="${id}"`));
  assert.doesNotMatch(block(id + '_Select'), /clip=/);
  const other = next.actions.at(-1).config.actionId;
  assert.equal(other, 'Other_Contact_Select');
  assert.match(block(other), /<Start event="Other_Contact"/);
  assert.match(block(other), new RegExp(`<Play [^>]*action="${id}"`));
  // The transition into a1 is judged still: it goes to the selecting action.
  assert.match(xml, new RegExp(`<Connect [^>]*to="${id}_Select"`));
});

test('another judgement may play an action that judges itself; it is written split', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card);
  // A new event's own judgement (a selecting pair, as it picks a pair) that plays a1, which judges itself.
  const r = addDetachedCondition(bound, 'a3', {x: 800, y: 600});
  const played = connectFlat(r.workspace, r.id, 'anim:a1:|clip_A1', 'pass');
  const key = makeDraft(played, 'a3', 'markerReceive', {x: -300, y: 1200});
  key.workspace.drafts.find(d => d.id === key.id).value.config.start.event = 'Second_Contact';
  const next = connectFlat(key.workspace, key.id, r.id);
  const errors = validateWorkspace(next).filter(i => i.level === 'error');
  assert.deepEqual(errors, [], 'no "목적지는 다른 분기가 없는 HKX"');
  const id = next.actions.find(a => a.uid === 'a1').config.actionId;
  assert.match(compileWorkspace(next), new RegExp(`id="${id}_Select"`));
});

// docs/mockup-space-sentence: room checks measure at the actor's own spot, turned from its own heading (runtime
// 0.12.280); older ones (the partner's spot or heading) are kept as they are and flagged.
test('room checks write self directions; older partner ones are kept and flagged', () => {
  const {w, card} = scene();
  const bound = connectFlat(w, 'start:a1|keyInput', card),
    a1 = bound.actions.find(a => a.uid === 'a1'),
    t = a1.flow.tests.find(t => t.id === a1.flow.entry);
  Object.assign(t, {kind: 'space', subject: 'self', space: {candidate: '', distance: 250, direction: 'selfBack'}});
  t.pass = {action: 'a2'};
  assert.match(compileWorkspace(bound), /kind="space" subject="self"[^>]*direction="selfBack"/);
  assert.ok(!validateWorkspace(bound).some(i => /예전 방식/.test(i.message)));
  Object.assign(t, {subject: 'partner', space: {candidate: '', distance: 250, direction: 'partnerBack'}});
  assert.match(compileWorkspace(bound), /subject="partner"[^>]*direction="partnerBack"/, 'kept as written');
  assert.ok(validateWorkspace(bound).some(i => i.level === 'warning' && /예전 방식/.test(i.message)));
});

// 10-24 (Dynamic Dodge Shot): a selecting action's start line cut, its conditions drawn into another start's flow and
// its start card deleted left an action with no HKX, no start and no conditions, which asked for an HKX path.
test('a selecting action emptied of its start and its conditions leaves the XML, with or without its start card', async () => {
  const {importWorkspaceXml} = await import('../src/importXml.ts');
  const {disconnectEdge} = await import('../src/graph/disconnect.ts');
  const w0 = importWorkspaceXml(`<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="4" id="Pick">
  <Action id="Right">
    <Start key="Mouse2"/>
    <Flow entry="sneak">
      <Test id="sneak" kind="sneaking" subject="self" pass="p1"/>
      <Play id="p1" action="A"/>
    </Flow>
  </Action>
  <Action id="A" clip="Animations\\T\\a.hkx"/>
  <Action id="B" clip="Animations\\T\\b.hkx"/>
  <Action id="EKey">
    <Start key="E"/>
    <Flow entry="back">
      <Test id="back" kind="movementDirection" subject="self" option="back" pass="p2"/>
      <Play id="p2" action="B"/>
    </Flow>
  </Action>
</AnimationSet>`);
  const right = w0.actions.find(a => a.config.actionId === 'Right'),
    e = w0.actions.find(a => a.config.actionId === 'EKey');
  const first = `flow:${e.uid}:back`;
  const line = compactGraph(w0, flatGraph(w0)).edges.find(
    x => x.target === first && x.source.startsWith(`start:${e.uid}`)
  );
  let w = disconnectEdge(w0, line);
  w = connectFlat(w, `flow:${right.uid}:sneak`, first, 'fail');
  assert.ok(!validateWorkspace(w).some(i => i.level === 'error'), 'its start card still there');
  w = deleteFlat(w, flatGraph(w).nodes.find(n => n.id.startsWith(`start:${e.uid}|`)).id);
  const issues = validateWorkspace(w);
  assert.deepEqual(
    issues.filter(i => i.level === 'error'),
    [],
    'its start card deleted'
  );
  assert.ok(issues.some(i => i.node === e.uid && /고르기 동작입니다/.test(i.message)));
  const xml = compileWorkspace(w);
  assert.doesNotMatch(xml, /id="EKey"/);
  assert.match(xml, /<Test id="sneak"[^>]*fail="back"/);
  assert.match(xml, /<Play [^>]*action="B"/);
});
