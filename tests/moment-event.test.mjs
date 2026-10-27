import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace} from '../src/workspace.ts';
import {
  clipBlocked,
  clipToEvent,
  costToEvent,
  eventToClip,
  hkxMoments,
  moveFunction,
  otherSenders,
  setOffEvent,
  slotToEvent,
} from '../src/graph/hkxMoments.ts';
import {actionClip} from '../src/graph/hkxMoments.ts';
import {clipKey} from '../src/graph/annotations.ts';
import {nodeValues, setNodeValues} from '../src/eventRegistry.ts';
import {checker, needsChecker} from './local.mjs';

// A function moved from the clip to an event is edited in the HKX card (10-27, user request): which event, the
// window's end event, and back to the clip. Every kind that goes to an event: a clip-time function, a window, a cost.
const raw = fs.readFileSync('tests/fixtures/DynamicDodgeShot.xml', 'utf8');
const folder = 'tests/generated/moment-event';
fs.mkdirSync(folder, {recursive: true});
const runtime = (w, name) => {
  if (needsChecker.skip) return;
  fs.writeFileSync(`${folder}/${name}.xml`, compileWorkspace(w));
  const r = spawnSync(checker, [`${folder}/${name}.xml`], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
};
const row = (w, name) => w.eventRegistry?.find(r => r.name === name);
const own = (w, uid) => w.actions.find(a => a.uid === uid);
// Two events this HKX sends (the editor reads them from the HKX; here they are given).
const annotation = (text, time) => ({text, time});
const sends = (w, a, list) => new Map([[clipKey(actionClip(w, a)), list]]);

test('a clip-time function goes to an event, is moved to another in the card, and comes back', () => {
  let w = importWorkspaceXml(raw);
  const a = w.actions[2].uid;
  w = {...w};
  const withEffect = structuredClone(w);
  own(withEffect, a).config.effects = [{id: 'effect1', values: {op: 'shake', at: '0.4', strength: '2'}}];
  w = clipToEvent(withEffect, a, 'effect1', 'FootLeft');
  const fn = row(w, 'FootLeft').functions[0];
  assert.equal(fn.values.op, 'shake');
  assert.deepEqual(nodeValues(own(w, a), row(w, 'FootLeft'), fn), {op: 'shake', strength: '2'});
  // Another event, chosen in the card: the function and this node's numbers move; the emptied name stays.
  const moved = moveFunction(w, 'FootLeft', fn.id, 'FootRight');
  w = moved.w;
  assert.deepEqual(row(w, 'FootLeft').functions, []);
  const there = row(w, 'FootRight').functions.find(f => f.id === moved.fn);
  assert.equal(there.values.op, 'shake');
  assert.deepEqual(nodeValues(own(w, a), row(w, 'FootRight'), there), {op: 'shake', strength: '2'});
  runtime(w, 'moved');
  // Back to the clip at the event's time, with its numbers; the registry no longer has it.
  const back = eventToClip(w, a, 'FootRight', moved.fn, 0.35);
  w = back.w;
  assert.ok(back.item.startsWith('effect:'));
  assert.deepEqual(row(w, 'FootRight').functions, []);
  assert.deepEqual(own(w, a).config.effects.at(-1).values, {op: 'shake', strength: '2', at: '0.35'});
  runtime(w, 'back');
});

test('an equal function already on the chosen event takes the numbers; other nodes keep theirs', () => {
  let w = importWorkspaceXml(raw);
  const [b, l] = [w.actions[0].uid, w.actions[1].uid];
  w = costToEvent(w, b, 'StepA');
  w = setNodeValues(w, b, row(w, 'StepA'), row(w, 'StepA').functions[0], {stamina: '10'});
  w = setNodeValues(w, l, row(w, 'StepA'), row(w, 'StepA').functions[0], {stamina: '7'});
  w = costToEvent(w, l, 'StepB');
  const moved = moveFunction(w, 'StepA', row(w, 'StepA').functions[0].id, 'StepB');
  w = moved.w;
  assert.equal(row(w, 'StepB').functions.length, 1, 'one cost on StepB');
  assert.equal(moved.fn, row(w, 'StepB').functions[0].id);
  assert.equal(nodeValues(own(w, b), row(w, 'StepB'), row(w, 'StepB').functions[0]).stamina, '10');
  assert.equal(nodeValues(own(w, l), row(w, 'StepB'), row(w, 'StepB').functions[0]).stamina, '7');
  // A cost back on the clip is the action's own cost again, its amounts this node's.
  w = eventToClip(w, b, 'StepB', moved.fn, 0.2).w;
  assert.equal(own(w, b).config.cost.enabled, true);
  assert.equal(own(w, b).config.cost.stamina, 10);
  assert.equal(own(w, b).config.cost.at.seconds, 0.2);
  runtime(w, 'cost');
});

test("a window's on and off events are chosen in the card, and it comes back to its clip window", () => {
  let w = importWorkspaceXml(raw);
  const a = w.actions[0].uid;
  const window = structuredClone(own(w, a).config.slots.iframe);
  w = slotToEvent(w, a, 'iframe', 'DodgeStart');
  assert.equal(own(w, a).config.slots.iframe.enabled, false);
  const on = row(w, 'DodgeStart').functions[0];
  // Its end: an event, then another, then the action's end again.
  w = setOffEvent(w, 'iframe', null, 'DodgeEnd');
  const off = row(w, 'DodgeEnd').functions[0];
  assert.equal(off.values.op, 'iframeOff');
  w = setOffEvent(w, 'iframe', {event: 'DodgeEnd', fn: off.id}, 'DodgeLate');
  assert.deepEqual(row(w, 'DodgeEnd').functions, []);
  assert.equal(row(w, 'DodgeLate').functions[0].values.op, 'iframeOff');
  const annotations = sends(w, own(w, a), [annotation('DodgeStart', 0.1), annotation('DodgeLate', 0.7)]);
  const item = hkxMoments(w, own(w, a), annotations.get(clipKey(actionClip(w, own(w, a))))).registry[0];
  assert.equal(item.off.event, 'DodgeLate', 'the card pairs the off function with its on one');
  runtime(w, 'window');
  // Back on the clip: the window it had before, both functions out of the registry.
  w = eventToClip(w, a, 'DodgeStart', on.id, 0.1, {event: 'DodgeLate', fn: item.off.fn.id}).w;
  assert.deepEqual(own(w, a).config.slots.iframe, window);
  assert.deepEqual(row(w, 'DodgeStart').functions, []);
  assert.deepEqual(row(w, 'DodgeLate').functions, []);
});

test('the card names the other HKX sending the event, and when the clip is not offered', () => {
  const w = importWorkspaceXml(raw);
  const [b, l] = [w.actions[0], w.actions[1]];
  const annotations = new Map([
    [clipKey(actionClip(w, b)), [annotation('DodgeShotFire', 0.667)]],
    [clipKey(actionClip(w, l)), [annotation('DodgeShotFire', 0.667)]],
  ]);
  const shared = otherSenders(w, b, 'DodgeShotFire', annotations);
  assert.deepEqual(
    shared.map(a => a.uid),
    [l.uid]
  );
  assert.match(clipBlocked(b, 'fireArrow', shared), /BowDodge_L1/, 'shared: the clip would take it from them');
  assert.equal(clipBlocked(b, 'fireArrow', []), '');
  assert.equal(clipBlocked(b, 'iframeOn', []), '');
  assert.ok(clipBlocked(b, 'cancel', []), "ending a pair is not an ordinary action's clip function");
});
