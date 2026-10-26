import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, wrap, compileWorkspace, parseWorkspace, defaultPair} from '../src/workspace.ts';
import {createProject} from '../src/model.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {flatGraph, addFlat, connectFlat, deleteFlat} from '../src/graph/flat.ts';
import {disconnectEdge} from '../src/graph/commands.ts';
import {captureGraph} from '../src/graph/document.ts';
import {qteErrors, qteTypes, shownTo} from '../src/qte.ts';
import {previewInitial, previewAdvance, previewInput, qteTarget} from '../src/qtePreview.ts';
import {copyNodes, pasteNodes} from '../src/graph/clipboard.ts';
import {renameMarker, markerUses} from '../src/ui/details/markerCatalog.ts';
function fixture(pair = false) {
  const w = emptyWorkspace();
  for (let i = 1; i <= 3; i++) {
    const p = createProject('single');
    p.actionId = 'Action' + i;
    p.name = 'Action' + i;
    p.steps[0].clip = 'Animations\\Test' + i + '.hkx';
    const a = wrap(p, 'a' + i);
    if (pair && i === 1) {
      a.pair = defaultPair();
      a.config.graph = ['RootBehaviorGraph'];
      a.config.cost.enabled = false;
      a.config.recovery.enabled = false;
      Object.values(a.config.slots).forEach(s => (s.enabled = false));
    }
    w.actions.push(a);
  }
  return w;
}
function wired(pair = false) {
  let w = fixture(pair);
  const added = addFlat(w, 'a1', 'qte', {x: 420, y: 160});
  w = added.workspace;
  const play = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a1');
  w = connectFlat(w, play.id, added.id, 'trigger');
  return {w, id: added.id};
}
test('QTE detached creation, HKX wiring, multiple nodes and XML/project round trip', () => {
  let {w, id} = wired();
  assert.equal(w.qtes[0].owner, 'a1');
  const added = addFlat(w, 'a1', 'qte', {x: 420, y: 340});
  w = added.workspace;
  assert.equal(w.qtes[1].owner, '');
  w.qtes[0].at = {basis: 'event', event: 'QTE_Start', seconds: 0, fallback: false, fallbackBasis: 'seconds'};
  w.qtes[0].results.success = {mode: 'event', event: 'QTE_Won', recipient: 'self', to: '', partnerTo: ''};
  const xml = compileWorkspace(w);
  assert.match(xml, /<QTE /);
  assert.match(xml, /event:QTE_Start/);
  assert.doesNotMatch(xml, /id="QTE2"/);
  const re = importWorkspaceXml(xml);
  assert.equal(re.qtes[0].results.success.event, 'QTE_Won');
  assert.equal(re.qtes[0].at.event, 'QTE_Start');
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes.length, 2);
  assert.equal(deleteFlat(w, id).qtes.length, 1);
});
test('pair victim input, direct success and failure paths, both ordinary handoff', () => {
  let {w, id} = wired(true);
  w.qtes[0].inputOwner = 'partner';
  const dest = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a2');
  w = connectFlat(w, id, dest.id, 'pass');
  w.qtes[0].results.success.partnerTo = 'a3';
  const xml = compileWorkspace(w);
  assert.match(xml, /inputOwner="partner"/);
  assert.match(xml, /<Success to="Action2" partnerTo="Action3"/);
  const re = importWorkspaceXml(xml);
  assert.equal(re.qtes[0].results.success.to, 'a2');
  assert.equal(re.qtes[0].results.success.partnerTo, 'a3');
  assert.equal(qteErrors(w).length, 0);
});
test('unset input owner follows the event sender (runtime 0.12.263); a set one is written', () => {
  const {w} = wired(true);
  const q = w.qtes[0];
  assert.equal(q.inputOwner, 'sender');
  q.at = {...q.at, basis: 'event', event: 'Start'};
  q.eventSource = 'partner';
  assert.equal(shownTo(q, true), 'partner');
  q.eventSource = 'self';
  assert.equal(shownTo(q, true), 'self');
  q.eventSource = 'both';
  assert.equal(shownTo(q, true), 'player');
  assert.equal(shownTo({...q, eventSource: 'partner'}, false), 'player');
  assert.equal(shownTo({...q, at: {...q.at, basis: 'seconds'}, eventSource: 'partner'}, true), 'player');
  q.eventSource = 'partner';
  assert.doesNotMatch(compileWorkspace(w), /inputOwner=/);
  assert.equal(importWorkspaceXml(compileWorkspace(w)).qtes[0].inputOwner, 'sender');
  // "Any role" is now a choice of its own: written, and read back as such.
  q.inputOwner = 'player';
  assert.match(compileWorkspace(w), /inputOwner="player"/);
  assert.equal(importWorkspaceXml(compileWorkspace(w)).qtes[0].inputOwner, 'player');
  assert.equal(shownTo(q, true), 'player');
  assert.equal(qteErrors(w).length, 0);
});
test('disconnect stops execution without deleting editable QTE; reconnect restores', () => {
  let {w, id} = wired();
  const edge = flatGraph(w).edges.find(e => e.target === id);
  w = disconnectEdge(w, edge);
  assert.equal(w.qtes.length, 1);
  assert.doesNotMatch(compileWorkspace(w), /<QTE /);
  w = connectFlat(w, edge.source, edge.target, edge.pin);
  assert.match(compileWorkspace(w), /<QTE /);
});
test('invalid targets, range, role and timing rejected', () => {
  const {w} = wired();
  const q = w.qtes[0];
  q.perfectWindow = 0.5;
  assert.ok(qteErrors(w).length);
  q.perfectWindow = 0.026;
  q.inputOwner = 'partner';
  assert.ok(qteErrors(w).length);
  q.inputOwner = 'player';
  q.at.basis = 'end';
  assert.ok(qteErrors(w).length);
});
test('QTE copy is independent; deleting playback keeps a reconnectable node', () => {
  let {w, id} = wired();
  w.qtes[0].speed = 2;
  const clip = copyNodes(w, flatGraph(w), [id]),
    r = pasteNodes(w, clip, {x: 800, y: 500}, 'a1');
  assert.equal(r.workspace.qtes.length, 2);
  assert.equal(r.workspace.qtes[1].speed, 2);
  assert.equal(r.workspace.qtes[1].owner, '');
  const play = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a1');
  w = deleteFlat(w, play.id);
  assert.equal(w.qtes[0].owner, '');
  assert.equal(qteErrors(w).length, 0);
  assert.ok(flatGraph(w).nodes.some(n => n.id === id));
});
test('event catalog renames QTE start and result references', () => {
  let {w} = wired();
  w.qtes[0].at.basis = 'event';
  w.qtes[0].at.event = 'QStart';
  w.qtes[0].results.failure = {mode: 'event', event: 'QFailed', recipient: 'self', to: '', partnerTo: ''};
  w = renameMarker(w, 'QStart', 'QStart2');
  assert.equal(w.qtes[0].at.event, 'QStart2');
  assert.equal(markerUses(w, 'QFailed').length, 1);
});
test('six QTE types preserve type settings and sequences across XML and projects', () => {
  for (const type of Object.keys(qteTypes)) {
    const {w} = wired();
    const q = w.qtes[0];
    q.type = type;
    q.pressCount = 17;
    q.perfectBefore = 0.3;
    q.sequence = [
      {key: 'E', gamepad: 4096},
      {key: 'Q', gamepad: 8192},
      {key: 'E', gamepad: 4096},
    ];
    assert.deepEqual(qteErrors(w), []);
    const xml = compileWorkspace(w),
      re = importWorkspaceXml(xml).qtes[0];
    assert.equal(re.type, type);
    if (type === 'keySequence') assert.deepEqual(re.sequence, q.sequence);
    if (type === 'rapidPress') assert.equal(re.pressCount, 17);
    if (['keySequence', 'rapidPress'].includes(type)) assert.equal(re.perfectBefore, 0.3);
    assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].type, type);
  }
});
test('the converging-lines design survives XML and projects, and only on the timing circle', () => {
  const {w} = wired();
  const q = w.qtes[0];
  q.design = 'converge';
  assert.deepEqual(qteErrors(w), []);
  const xml = compileWorkspace(w);
  assert.match(xml, /design="converge"/);
  assert.equal(importWorkspaceXml(xml).qtes[0].design, 'converge');
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].design, 'converge');
  // The circle is the omitted design; another type writes none.
  delete q.design;
  assert.doesNotMatch(compileWorkspace(w), /design=/);
  q.design = 'converge';
  q.type = 'timingBar';
  assert.doesNotMatch(compileWorkspace(w), /design=/);
  q.design = 'square';
  assert.ok(qteErrors(w).length);
  // Hand-written XML: design on another type is refused, as the runtime refuses it.
  q.type = 'splitArc';
  q.design = 'converge';
  const bad = compileWorkspace(w).replace('design="converge"', 'design="converge" type="timingBar"');
  assert.throws(() => importWorkspaceXml(bad));
});
test('type specific validation rejects impossible sequences and fractional counts', () => {
  const {w} = wired(),
    q = w.qtes[0];
  q.type = 'keySequence';
  q.sequence = [{key: 'E', gamepad: 0}];
  assert.ok(qteErrors(w).length);
  q.sequence = [
    {key: 'E', gamepad: 0},
    {key: '', gamepad: 4096},
  ];
  assert.ok(qteErrors(w).length);
  q.sequence = [
    {key: '', gamepad: 8192},
    {key: '', gamepad: 4096},
  ];
  assert.deepEqual(qteErrors(w), []);
  q.type = 'rapidPress';
  q.pressCount = 1.5;
  assert.ok(qteErrors(w).length);
  q.pressCount = 10;
  q.perfectBefore = 2;
  assert.ok(qteErrors(w).length);
});
test('all preview timing skins and hold match the runtime target', () => {
  const q = wired().w.qtes[0];
  for (const type of ['splitArc', 'timingBar', 'rotatingNeedle']) {
    q.type = type;
    assert.equal(previewInput(previewAdvance(previewInitial(), qteTarget * 2.4, q), q).outcome, 'perfect');
  }
  q.type = 'holdRelease';
  let s = previewInput(previewInitial(), q);
  assert.equal(s.outcome, null);
  s = previewAdvance(s, qteTarget * 2.4, q);
  assert.equal(previewInput(s, q, true).outcome, 'perfect');
  assert.equal(previewInput(previewInitial(), q, true).outcome, null);
  s = previewInput(previewAdvance(previewInitial(), 1.5, q), q);
  s = previewAdvance(s, 1, q);
  assert.equal(previewInput(s, q, true).outcome, 'failure');
});
test('rapid and sequence preview counts, timeout, wrong key, and perfect cutoff', () => {
  const q = wired().w.qtes[0];
  q.type = 'rapidPress';
  q.pressCount = 3;
  let s = previewInitial();
  for (let i = 0; i < 3; i++) s = previewInput(s, q);
  assert.equal(s.outcome, 'perfect');
  q.perfectBefore = 0;
  s = previewInitial();
  for (let i = 0; i < 3; i++) s = previewInput(s, q);
  assert.equal(s.outcome, 'success');
  q.type = 'keySequence';
  s = previewInput(previewInitial(), q, false, false);
  assert.equal(s.outcome, 'failure');
  assert.equal(previewAdvance(previewInitial(), 2.4, q).outcome, 'failure');
});
const lowerDisconnected = w => w; // Cuts are document edits now (format 6): nothing is lowered.
import {qteMembers} from '../src/graph/qteGroups.ts';
test('Grapple control, stop, sounds and group survive XML/project round trips', () => {
  let {w} = wired(true);
  const q = w.qtes[0];
  Object.assign(q, {
    control: 'rightAttack',
    stopEvent: 'StopQte',
    replaceActive: true,
    feedback: 0.3,
    group: 'Grapple QTE',
    speed: 4,
  });
  q.results.success.soundPlugin = 'FH_Grapple.esp';
  q.results.success.soundForm = '822';
  q.results.failure.soundPlugin = 'FH_Grapple.esp';
  q.results.failure.soundForm = '824';
  const xml = compileWorkspace(w),
    r = importWorkspaceXml(xml).qtes[0];
  for (const field of ['control', 'stopEvent', 'replaceActive', 'feedback', 'group', 'speed'])
    assert.deepEqual(r[field], q[field]);
  assert.equal(r.results.failure.soundForm, '824');
  assert.equal(r.results.failure.mode, 'continue');
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].control, 'rightAttack');
  assert.equal(markerUses(w, 'StopQte').length, 1);
  assert.equal(renameMarker(w, 'StopQte', 'Stop2').qtes[0].stopEvent, 'Stop2');
  q.results.success.soundForm = 'garbage';
  assert.ok(qteErrors(w).length);
});
test('grouped QTE fans out one node and preserves independent transition routes', () => {
  let {w, id} = wired();
  const q = w.qtes[0];
  q.group = 'Stages';
  q.results.success = {mode: 'transition', to: 'a2', partnerTo: '', event: '', recipient: 'self'};
  w.qtes.push({
    ...structuredClone(q),
    id: 'Other',
    owner: 'a2',
    results: {...structuredClone(q.results), success: {...q.results.success, to: 'a3'}},
  });
  let g = flatGraph(w);
  assert.equal(g.nodes.filter(n => n.kind === 'qte').length, 1);
  assert.equal(g.edges.filter(e => e.target === id).length, 2);
  const outgoing = g.edges.filter(e => e.source === id);
  assert.equal(outgoing.length, 2);
  assert.notEqual(outgoing[0].pin, outgoing[1].pin);
  // Cutting a1's line takes a1's rule out of the group in the document (10-15): no hidden cut, and the group
  // (still drawn as the same card) lists a2 alone.
  w = disconnectEdge(
    w,
    g.edges.find(e => e.target === id && e.source.includes('a1'))
  );
  assert.equal(w.disconnections, undefined);
  assert.deepEqual(
    qteMembers(w, id).map(q => q.owner),
    ['a2']
  );
  assert.equal(w.qtes[0].results.success.to, 'a3');
  assert.ok(flatGraph(w).nodes.some(n => n.id === id));
  // Reconnecting a1 copies the group's rule again.
  const source = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a1');
  w = connectFlat(w, source.id, id, 'trigger');
  assert.deepEqual(
    w.qtes.map(q => q.owner),
    ['a2', 'a1']
  );
  // A result line is emptied in the document too: the rule continues instead.
  const a2 = w.qtes[0].id;
  w = disconnectEdge(
    w,
    flatGraph(w).edges.find(e => e.source === id && e.pin === `choice:${a2}:success`)
  );
  assert.equal(w.disconnections, undefined);
  assert.equal(w.qtes[0].results.success.mode, 'continue');
  assert.equal(w.qtes[1].results.success.mode, 'transition');
  assert.equal(deleteFlat(w, id).qtes.length, 0);
});
test('shared QTE connects a new HKX and copies independently without duplicate prompts', () => {
  let {w, id} = wired();
  w.qtes[0].group = 'Stages';
  w.qtes[0].speed = 4;
  let next = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a2');
  w = connectFlat(w, next.id, id, 'trigger');
  assert.equal(w.qtes.length, 2);
  assert.equal(w.qtes[1].speed, 4);
  w = connectFlat(w, next.id, id, 'trigger');
  assert.equal(w.qtes.length, 2);
  const copy = pasteNodes(w, copyNodes(w, flatGraph(w), [id]), {x: 950, y: 460}, 'a3');
  const members = qteMembers(copy.workspace, copy.ids[0]);
  assert.equal(members.length, 1);
  assert.equal(members[0].owner, '');
  assert.notEqual(members[0].group, w.qtes[0].group);
  next = flatGraph(copy.workspace).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a3');
  const connected = connectFlat(copy.workspace, next.id, copy.ids[0], 'trigger');
  assert.equal(qteMembers(connected, copy.ids[0])[0].owner, 'a3');
  assert.equal(connected.qtes.filter(q => q.owner === 'a3').length, 1);
  assert.deepEqual(qteErrors(connected), []);
});
import {removeQteRule} from '../src/graph/qteGroups.ts';
test('deleting first grouped QTE rule preserves node and other disabled result', () => {
  let {w, id} = wired();
  w.qtes[0].group = 'Stages';
  const second = {...structuredClone(w.qtes[0]), id: 'Second', name: 'Second'};
  second.results.success = {mode: 'transition', to: 'a3', partnerTo: '', event: '', recipient: 'self'};
  w.qtes.push(second);
  w = disconnectEdge(
    w,
    flatGraph(w).edges.find(e => e.source === id && e.pin === 'choice:Second:success')
  );
  w = removeQteRule(w, id, w.qtes[0].id);
  assert.equal(w.qtes.length, 1);
  assert.equal(w.qtes[0].name, 'Second');
  assert.equal('qte:' + w.qtes[0].id, id);
  assert.equal(lowerDisconnected(w).qtes[0].results.success.mode, 'continue');
});
test('complete graph QTE copy remaps shared groups and disconnected result pins', () => {
  let {w, id} = wired();
  w.qtes[0].group = 'Stages';
  w.qtes[0].results.success = {mode: 'transition', to: 'a2', partnerTo: '', event: '', recipient: 'self'};
  w = disconnectEdge(
    w,
    flatGraph(w).edges.find(e => e.source === id)
  );
  const g = flatGraph(w),
    copy = copyNodes(
      w,
      g,
      g.nodes.map(n => n.id)
    );
  const r = pasteNodes(emptyWorkspace(), copy, {x: 0, y: 0}, '').workspace;
  assert.equal(r.qtes.length, 1);
  assert.notEqual(r.qtes[0].group, 'Stages');
  assert.equal(lowerDisconnected(r).qtes[0].results.success.mode, 'continue');
  assert.deepEqual(qteErrors(r), []);
});
test('sound-only XML cannot silently drop an incomplete descriptor reference', () => {
  const {w} = wired();
  w.qtes[0].results.success = {mode: 'event', event: 'Won', recipient: 'self', to: '', partnerTo: ''};
  const xml = compileWorkspace(w);
  assert.ok(xml.includes('</QTE>'));
  assert.throws(() => importWorkspaceXml(xml.replace('</QTE>', '<Failure soundForm="822"/></QTE>')));
});

// QTE channels (runtime 0.12.192): channel="1..3" runs beside channel 0; 0 is the default and not written.
test('QTE channel survives XML and project round trips and is validated like the runtime', () => {
  let {w} = wired(true);
  const q = w.qtes[0];
  q.channel = 1;
  const xml = compileWorkspace(w);
  assert.match(xml, /<QTE [^>]*channel="1"/);
  assert.equal(importWorkspaceXml(xml).qtes[0].channel, 1);
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].channel, 1);
  q.channel = undefined;
  assert.doesNotMatch(compileWorkspace(w), /channel=/);
  assert.equal(importWorkspaceXml(xml.replace('channel="1"', 'channel="0"')).qtes[0].channel, undefined);
  for (const bad of ['4', '1.5', '-1', 'x'])
    assert.throws(() => importWorkspaceXml(xml.replace('channel="1"', `channel="${bad}"`)), /channel/, bad);
  for (const bad of [4, 1.5, -1]) {
    q.channel = bad;
    assert.ok(
      qteErrors(w).some(e => /채널/.test(e)),
      String(bad)
    );
  }
});
const RAGDOLL_XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="RagdollRecoveryQTE">
  <EventRegistry>
    <Event name="Ragdoll">
      <QTE id="GetUp" design="converge" feedback="1.2" anchor="center" y="0.15">
        <Success event="Ragdoll_Recovery"/>
      </QTE>
    </Event>
  </EventRegistry>
  <Start event="GetUpBack" actor="player" to="GetUpBack"/>
  <Action id="GetUpBack" clip="Animations\\RagdollRecoveryQTE\\GetUpBack.hkx"/>
</AnimationSet>`;
test('an event starts a QTE with no HKX (runtime 0.12.248): XML and project round trips', () => {
  const w = importWorkspaceXml(RAGDOLL_XML);
  const q = w.qtes[0];
  assert.equal(q.eventStart, 'Ragdoll');
  assert.equal(q.owner, '');
  assert.equal(q.results.success.event, 'Ragdoll_Recovery');
  assert.equal(w.eventRegistry, undefined, 'an event that only starts QTEs is no registry row');
  assert.deepEqual(qteErrors(w), []);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Event name="Ragdoll">\s*<QTE id="GetUp"[^>]*design="converge"/);
  assert.doesNotMatch(xml, /at="|inputOwner=|recipient=/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].eventStart, 'Ragdoll');
  // A registered event with functions keeps one <Event>: its functions and its QTE together.
  const both = RAGDOLL_XML.replace('<Event name="Ragdoll">', '<Event name="Ragdoll"><Do op="shake"/>');
  const wb = importWorkspaceXml(both);
  assert.equal(wb.eventRegistry.length, 1);
  const xb = compileWorkspace(wb);
  assert.equal(xb.match(/<Event name="Ragdoll">/g).length, 1);
  assert.match(xb, /<Event name="Ragdoll">\s*<Do op="shake"[^>]*\/>\s*<QTE id="GetUp"/);
});
test('an event QTE is the player own: an ordinary transition only, no recipient, group or start time', () => {
  const w = importWorkspaceXml(RAGDOLL_XML);
  const q = w.qtes[0];
  // Runtime 0.12.249: a result may start an ordinary action, never a pair; asked during a pair (0.12.264) the
  // partner's too, an ordinary one.
  q.results.failure = {mode: 'transition', event: '', recipient: 'self', to: w.actions[0].uid, partnerTo: ''};
  assert.deepEqual(qteErrors(w), []);
  q.results.failure.partnerTo = w.actions[0].uid;
  assert.deepEqual(qteErrors(w), []);
  q.results.failure.partnerTo = '';
  w.actions[0].pair = true;
  assert.ok(qteErrors(w).some(e => /일반 동작으로만/.test(e)));
  w.actions[0].pair = undefined;
  q.results.failure = {mode: 'continue', event: '', recipient: 'self', to: '', partnerTo: ''};
  q.eventStart = '';
  assert.ok(qteErrors(w).some(e => /이벤트 이름을 지정/.test(e)));
  q.eventStart = 'Ragdoll';
  q.group = 'G';
  assert.ok(qteErrors(w).some(e => /규칙 묶음/.test(e)));
  for (const bad of ['at="0.5"', 'inputOwner="player"', 'group="G"'])
    assert.throws(() => importWorkspaceXml(RAGDOLL_XML.replace('<QTE id="GetUp"', `<QTE id="GetUp" ${bad}`)));
  assert.throws(() =>
    importWorkspaceXml(RAGDOLL_XML.replace('event="Ragdoll_Recovery"', 'event="Ragdoll_Recovery" recipient="self"'))
  );
  // The partner's action reads back (runtime 0.12.264).
  assert.equal(
    importWorkspaceXml(
      REST_XML.replace('<Success to="GetUpBack"/>', '<Success to="GetUpBack" partnerTo="GetUpFront"/>')
    ).qtes.find(q => q.eventStart === 'GetUpBack').results.success.partnerTo !== '',
    true
  );
});
// Ragdoll recovery from rest (runtime 0.12.249, Ragdoll Recovery 1.1.0): the plugin's pose events start the QTEs,
// and a success goes straight to its get-up action.
const REST_XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="RagdollRecoveryQTE">
  <EventRegistry>
    <Event name="GetUpBack">
      <QTE id="GetUpBack" speed="3.7391" successWindow="0.23369" perfectWindow="0.09347" feedback="1.2" anchor="center" y="0.15" design="converge">
        <Success to="GetUpBack"/>
      </QTE>
    </Event>
    <Event name="GetUpFront">
      <QTE id="GetUpFront" speed="3.7391" successWindow="0.23369" perfectWindow="0.09347" feedback="1.2" anchor="center" y="0.15" design="converge">
        <Success to="GetUpFront"/>
      </QTE>
    </Event>
  </EventRegistry>
  <Action id="GetUpBack" clip="Animations\\RagdollRecoveryQTE\\GetUpBack.hkx" enter="0.5"/>
  <Action id="GetUpFront" clip="Animations\\RagdollRecoveryQTE\\GetUpFront.hkx" enter="0.5"/>
</AnimationSet>`;
test('an event QTE success goes straight to an HKX (runtime 0.12.249): XML, canvas and round trips', () => {
  let w = importWorkspaceXml(REST_XML);
  const back = w.actions.find(a => a.config.actionId === 'GetUpBack'),
    front = w.actions.find(a => a.config.actionId === 'GetUpFront');
  const q = w.qtes.find(q => q.eventStart === 'GetUpBack');
  assert.equal(q.results.success.mode, 'transition');
  assert.equal(q.results.success.to, back.uid);
  assert.deepEqual(qteErrors(w), []);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Event name="GetUpBack">\s*<QTE id="GetUpBack"[^>]*>\s*<Success to="GetUpBack"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).qtes[0].results.success.mode, 'transition');
  // The canvas: event -> QTE -> the HKX card, no event card for a transition.
  const g = flatGraph(w);
  const edge = g.edges.find(e => e.source === 'qte:GetUpBack' && e.pin === 'pass');
  assert.ok(edge && g.nodes.find(n => n.id === edge.target)?.action === back.uid);
  assert.ok(!g.nodes.some(n => n.id.startsWith('qte-emit:GetUpBack')));
  // Re-pointed on the canvas to the other HKX; the partner pin (runtime 0.12.264) takes an ordinary one too.
  const frontCard = g.nodes.find(n => n.kind === 'hkxPlay' && n.action === front.uid);
  w = connectFlat(w, 'qte:GetUpBack', frontCard.id, 'pass');
  assert.equal(w.qtes.find(q => q.eventStart === 'GetUpBack').results.success.to, front.uid);
  w = connectFlat(w, 'qte:GetUpBack', frontCard.id, 'choice:success:partner');
  assert.equal(w.qtes.find(q => q.eventStart === 'GetUpBack').results.success.partnerTo, front.uid);
});
test('the canvas reads event -> QTE -> event; its lines and cards edit the QTE', () => {
  let w = importWorkspaceXml(RAGDOLL_XML);
  const g = flatGraph(w);
  const ids = g.nodes.map(n => n.id);
  assert.ok(ids.includes('qte-event:GetUp') && ids.includes('qte:GetUp') && ids.includes('qte-emit:GetUp:success'));
  const start = g.edges.find(e => e.source === 'qte-event:GetUp' && e.target === 'qte:GetUp');
  assert.ok(
    start && g.edges.some(e => e.source === 'qte:GetUp' && e.target === 'qte-emit:GetUp:success' && e.pin === 'pass')
  );
  // Cutting the start line or deleting the event card leaves a detached QTE, kept editable and out of the XML;
  // deleting the result event clears it.
  const cut = disconnectEdge(w, start);
  assert.equal(cut.qtes.length, 1);
  assert.equal(cut.qtes[0].eventStart, undefined);
  assert.doesNotMatch(compileWorkspace(cut), /<QTE /);
  assert.equal(deleteFlat(w, 'qte-event:GetUp').qtes[0].eventStart, undefined);
  assert.equal(deleteFlat(w, 'qte-emit:GetUp:success').qtes[0].results.success.mode, 'continue');
  // An event card made on the canvas, dragged to a detached QTE: the QTE starts from that event.
  w = deleteFlat(w, 'qte-event:GetUp');
  const added = addFlat(w, '', 'markerReceive', {x: 40, y: 40});
  w = added.workspace;
  w.starts.find(s => 'startCard:' + s.uid === added.id).event = 'Ragdoll';
  w = connectFlat(w, added.id, 'qte:GetUp', 'trigger');
  assert.equal(w.qtes[0].eventStart, 'Ragdoll');
  assert.ok(!w.starts.some(s => 'startCard:' + s.uid === added.id), 'the start card became the QTE event card');
  assert.ok(flatGraph(w).edges.some(e => e.source === 'qte-event:GetUp' && e.target === 'qte:GetUp'));
});
// Ragdoll recovery from a nearly resting body (runtime 0.12.253, Ragdoll Recovery 1.4.0): one QTE event, the success
// goes to a selecting action whose flow reads how the body lies at the handoff.
const SETTLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="RagdollRecoveryQTE">
  <EventRegistry>
    <Event name="GetUpQTE">
      <QTE id="GetUp" speed="3.7391" successWindow="0.23369" perfectWindow="0.09347" feedback="1.2" anchor="center" y="0.15" design="converge">
        <Success>
          <Check kind="lying" option="back"/>
          <True to="GetUpBack"/>
          <False to="GetUpFront"/>
        </Success>
        <Failure event="GetUpRelease"/>
      </QTE>
    </Event>
  </EventRegistry>
  <Action id="GetUpBack" clip="Animations\\RagdollRecoveryQTE\\GetUpBack.hkx"/>
  <Action id="GetUpFront" clip="Animations\\RagdollRecoveryQTE\\GetUpFront.hkx"/>
</AnimationSet>`;
test('the lying condition and an event QTE going through a condition card round-trip (runtime 0.12.253)', () => {
  const w = importWorkspaceXml(SETTLE_XML);
  assert.deepEqual(qteErrors(w), []);
  const q = w.qtes.find(q => q.eventStart === 'GetUpQTE');
  // The selecting action's flow is the result's own condition card (format 6).
  const card = w.cards.find(c => c.uid === q.results.success.card);
  assert.ok(card);
  assert.equal(q.results.success.to, '');
  assert.equal(q.results.failure.event, 'GetUpRelease');
  const xml = compileWorkspace(w);
  assert.match(
    xml,
    /<Success>\s*<Check kind="lying" option="back"\/>\s*<True to="GetUpBack"\/>\s*<False to="GetUpFront"\/>/
  );
  assert.match(xml, /<\/Success>\s*<Failure event="GetUpRelease"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), xml);
  assert.throws(() => importWorkspaceXml(SETTLE_XML.replace('option="back"', 'option="side"')));
});

test('an event result is drawn to the cards that receive the event, and the QTE card shows its look', async () => {
  const {readFileSync} = await import('node:fs');
  const {checklistProjection} = await import('../src/graph/checklist.ts');
  const {presentCard} = await import('../src/graph/cardPresentation.ts');
  const w = importWorkspaceXml(readFileSync(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url), 'utf8'));
  const g = checklistProjection(w),
    by = new Map(g.nodes.map(n => [n.id, n]));
  const via = g.edges.filter(e => e.via);
  assert.ok(via.length > 0);
  for (const e of via) {
    // From a QTE card's result pin to an event card listening for that event.
    assert.equal(by.get(e.source).kind, 'qte');
    assert.ok(['pass', 'fail', 'perfect'].includes(e.pin));
    assert.ok(['transition', 'startCard'].includes(by.get(e.target).kind));
    const listened = [
      ...w.links.filter(l => l.mode === 'event').map(l => l.event),
      ...w.starts.filter(s => s.mode === 'event').map(s => s.event),
    ];
    assert.ok(listened.includes(e.via));
  }
  const card = g.nodes.find(n => n.kind === 'qte' && n.title === 'Grapple QTE');
  const face = presentCard(w, card).qte;
  assert.equal(face.rules, w.qtes.filter(q => q.group === 'Grapple QTE').length);
  assert.equal(face.key, 'LMB');
  assert.match(face.start, /주석 이벤트 \d+종/);
});

test('a pair QTE transition has a victim pin named for its outcome, and the card lists both roles', async () => {
  const {portLabel, routeTone} = await import('../src/graph/pinTargets.ts');
  const {presentCard} = await import('../src/graph/cardPresentation.ts');
  let {w, id} = wired(true);
  w.qtes[0].results.success = {
    mode: 'transition',
    event: '',
    recipient: 'self',
    to: 'a2',
    partnerTo: '',
    perfect: undefined,
  };
  const card = flatGraph(w).nodes.find(n => n.id === id);
  // No victim action chosen yet: the pin is there to be dragged from.
  assert.ok(card.outputs.includes('choice:success:partner'));
  assert.equal(portLabel(card, 'choice:success:partner'), '성공 · 피해자');
  assert.equal(routeTone(card, 'choice:failure:partner'), 'fail');
  const results = presentCard(w, card).qte.results;
  assert.deepEqual(
    results.map(r => [r.k, r.mode, r.pair]),
    [
      ['success', 'transition', true],
      ['failure', 'continue', true],
      ['perfect', 'continue', true],
    ]
  );
});
