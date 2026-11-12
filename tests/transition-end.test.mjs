import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {setLinkEnd} from '../src/graph/cardEdits.ts';
import {captureGraph} from '../src/graph/document.ts';
import {flatGraph, setDestination, transitionId} from '../src/graph/flat.ts';
import {checker, needsChecker} from './local.mjs';

// A transition that ends its HKX (runtime 1.0.8, <Transition end="true">): an event starts a loop, another ends it.
const LOOP = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="SelfService">
  <Start to="Loop" event="SELF_SelfService_0"/>
  <Action id="Loop" clip="Animations\\SelfService\\Loop.hkx" loop="true" maxHold="600">
    <Transition event="SELF_SelfService_End" end="true"/>
    <Transition to="Next" key="G"/>
  </Action>
  <Action id="Next" clip="Animations\\SelfService\\Next.hkx"/>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');

test('an ending transition reads in, writes back unchanged and is what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(LOOP);
  assert.deepEqual(errors(w), []);
  const [end, next] = w.links;
  assert.deepEqual(
    [end.end, end.to, end.card, end.mode, end.event],
    [true, '', undefined, 'event', 'SELF_SelfService_End']
  );
  assert.ok(!('end' in next) && next.to);
  const xml = compileWorkspace(w);
  assert.ok(xml.includes('<Transition event="SELF_SelfService_End" end="true"/>'), xml);
  assert.ok(xml.includes('<Transition to="Next" key="G"/>'), xml);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  // The saved project keeps it.
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).links[0].end, true);
  // The canvas names it; nothing leaves its card.
  const graph = flatGraph(w);
  assert.ok(graph.nodes.find(n => n.id === transitionId(end.id)).summary.endsWith('끝내기'));
  assert.ok(!graph.edges.some(e => e.source === transitionId(end.id)));
  mkdirSync('tests/generated/transition-end', {recursive: true});
  writeFileSync('tests/generated/transition-end/Loop.xml', xml);
  execFileSync(checker, ['tests/generated/transition-end/Loop.xml']);
});

test('turning it on lets go of the destination; connecting again turns it off', () => {
  const w = importWorkspaceXml(LOOP);
  const next = w.links[1],
    target = w.actions.find(a => a.config.actionId === 'Next').uid;
  let v = setLinkEnd(w, next.id, true);
  const ended = v.links.find(l => l.id === next.id);
  assert.deepEqual(
    [ended.end, ended.to, ended.partnerTo, ended.blend, ended.card],
    [true, '', '', undefined, undefined]
  );
  assert.deepEqual(errors(v), []);
  assert.ok(compileWorkspace(v).includes('<Transition key="G" end="true"/>'));
  // Off again: a transition with no destination yet, as a new one is.
  const off = setLinkEnd(v, next.id, false);
  assert.ok(!('end' in off.links.find(l => l.id === next.id)));
  assert.ok(errors(off).some(e => /전환의 목적지/.test(e.message)));
  // Connected to a card: it goes on.
  v = setDestination(v, transitionId(next.id), undefined, {action: target});
  const again = v.links.find(l => l.id === next.id);
  assert.ok(!('end' in again) && again.to === target);
  assert.deepEqual(errors(v), []);
});

test('what an ending transition cannot be', () => {
  const w = importWorkspaceXml(LOOP);
  const end = w.links[0];
  // A destination or a blend left on it is an error, not written out silently.
  const stray = structuredClone(w);
  Object.assign(
    stray.links.find(l => l.id === end.id),
    {to: stray.actions[1].uid}
  );
  assert.ok(errors(stray).some(e => /끝내기 전환에는 목적지와 블렌드를 두지 않습니다/.test(e.message)));
  // The HKX's own end is no trigger for ending it.
  const atEnd = structuredClone(w);
  atEnd.actions[1].config.loop = undefined;
  Object.assign(atEnd.links[1], {from: atEnd.actions[1].uid, to: '', end: true, mode: 'end', input: '', window: false});
  assert.ok(errors(atEnd).some(e => /끝나면 전환은 끝내기로 둘 수 없습니다/.test(e.message)));
  // The file's own mistakes are refused with their reason.
  const bad = (from, to, pattern) => assert.throws(() => importWorkspaceXml(LOOP.replace(from, to)), pattern);
  bad('event="SELF_SelfService_End" end="true"', 'to="Next" event="SELF_SelfService_End" end="true"', /to와 조건 카드/);
  bad('end="true"', 'end="true" blend="0.2"', /blend와 partnerTo/);
  bad('end="true"', 'end="yes"', /true 또는 false/);
  bad('event="SELF_SelfService_End" end="true"', 'on="end" end="true"', /on="end"/);
  assert.throws(
    () =>
      importWorkspaceXml(
        `<AnimationSet version="6" id="P"><Pair id="Hug" clip="a.hkx"><FindPartner range="200" angle="90"/><Transition event="Stop" end="true"/></Pair></AnimationSet>`
      ),
    /일반 동작에만/
  );
});

test('「끝내기」 is the first choice of a transition’s destination list', async () => {
  const {pinRows, connectPin, routeDestination, END_TARGET} = await import('../src/graph/pinTargets.ts');
  const {checklistModel, checklistProjection} = await import('../src/graph/checklist.ts');
  const view = w => checklistProjection(w, checklistModel(w));
  let w = importWorkspaceXml(LOOP);
  const next = w.links[1],
    id = transitionId(next.id);
  const row = () => pinRows(w, view(w), id).find(r => r.pin === 'trigger');
  // Offered on an ordinary HKX's transition; the list names where it goes now.
  assert.equal(row().ending, true);
  assert.notEqual(row().current, END_TARGET);
  // Chosen: it lets go of its destination and the row says so.
  w = connectPin(w, view(w), id, 'trigger', END_TARGET);
  assert.deepEqual([w.links[1].end, w.links[1].to], [true, '']);
  assert.deepEqual([row().current, row().currentLabel], [END_TARGET, '끝내기']);
  assert.equal(routeDestination(w, id, 'trigger'), '끝내기');
  assert.deepEqual(errors(w), []);
  // 「연결 안 함」 and an HKX both turn it off.
  const cleared = connectPin(w, view(w), id, 'trigger', '');
  assert.ok(!('end' in cleared.links[1]) && !cleared.links[1].to);
  const target = view(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === w.actions[1].uid).id;
  const connected = connectPin(w, view(w), id, 'trigger', target);
  assert.ok(!('end' in connected.links[1]) && connected.links[1].to === w.actions[1].uid);
  // Not offered where the runtime refuses it: the transition that goes at the HKX's end.
  const atEnd = structuredClone(importWorkspaceXml(LOOP));
  atEnd.actions[0].config.loop = undefined;
  Object.assign(atEnd.links[1], {mode: 'end', input: '', window: false});
  assert.ok(!pinRows(atEnd, view(atEnd), transitionId(atEnd.links[1].id)).find(r => r.pin === 'trigger').ending);
});
