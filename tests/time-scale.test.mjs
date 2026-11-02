import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {slotToEvent, eventToClip} from '../src/graph/hkxMoments.ts';
import {rows} from '../src/timeline/model.ts';
import {checker, needsChecker} from './local.mjs';

// The time scale window (11-01, docs/mockup-time-scale-range): one item with a range, a multiplier and an ease, in
// place of the clip-time timeOn / timeOff pair.

const head =
  '<?xml version="1.0" encoding="utf-8"?>\n<AnimationSet version="6" id="Test"><Inputs><Input id="use" key="LAlt"/></Inputs>';
const xml = body =>
  head +
  '<Start input="use" to="Stab"/><Action id="Stab" clip="Animations\\Stab.hkx">' +
  body +
  '</Action></AnimationSet>';

test('a TimeScale reads into the window and writes back the same', needsChecker, () => {
  const w = importWorkspaceXml(xml('<TimeScale from="0.4" until="0.9" factor="0.3" ease="0.15"/>'));
  const time = w.actions[0].config.slots.time;
  assert.equal(time.enabled, true);
  assert.equal(time.from.seconds, 0.4);
  assert.equal(time.until.seconds, 0.9);
  assert.equal(time.factor, 0.3);
  assert.equal(time.ease, 0.15);
  assert.equal(validateWorkspace(w).filter(x => x.level === 'error').length, 0);
  const out = compileWorkspace(w);
  assert.match(out, /<TimeScale from="0\.4" until="0\.9" factor="0\.3" ease="0\.15"\/>/);
  // No ease and the whole clip: only the factor is written.
  w.actions[0].config.slots.time = {
    ...time,
    from: {...time.from, seconds: 0},
    until: {...time.until, basis: 'end', seconds: 0},
    ease: 0,
  };
  assert.match(compileWorkspace(w), /<TimeScale factor="0\.3"\/>/);
  const dir = resolve('tests/generated/time-scale');
  mkdirSync(dir, {recursive: true});
  writeFileSync(resolve(dir, 'time.xml'), out);
  const r = spawnSync(checker, [resolve(dir, 'time.xml')], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the time scale is offered with the windows, its pair of functions no longer', () => {
  const w = importWorkspaceXml(xml(''));
  const card = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay').id;
  const kinds = contextualAdds(w, card).map(o => o.kind);
  assert.ok(kinds.includes('notify:time'));
  assert.ok(!kinds.includes('notify:timeOn') && !kinds.includes('notify:timeOff'));
  // A clip-time timeOn in an ordinary action is refused, as the runtime refuses it.
  assert.throws(() => importWorkspaceXml(xml('<Do at="0.2" op="timeOn" factor="0.5"/>')));
  // A pair's time scale is its timeline track.
  assert.throws(
    () =>
      importWorkspaceXml(
        head + '<Pair id="P" clip="Animations\\P.hkx"><TimeScale factor="0.5"/></Pair></AnimationSet>'
      ),
    /페어 타임라인/
  );
});

test('a window moved to an event keeps its multiplier and ease as the action numbers, and back', () => {
  let w = importWorkspaceXml(xml('<TimeScale from="0.4" until="0.9" factor="0.3" ease="0.2"/>'));
  const a = w.actions[0].uid;
  w = slotToEvent(w, a, 'time', 'SlowStart');
  assert.equal(w.actions[0].config.slots.time.enabled, false);
  const row = w.eventRegistry.find(r => r.name === 'SlowStart');
  const fn = row.functions[0];
  assert.equal(fn.values.op, 'timeOn');
  const out = compileWorkspace(w);
  assert.match(out, /<Do op="timeOn"\/>/);
  assert.match(out, /<EventValues>\s*<Event name="SlowStart">\s*<Do op="timeOn" factor="0\.3" ease="0\.2"\/>/);
  w = eventToClip(w, a, 'SlowStart', fn.id, 0.4).w;
  const time = w.actions[0].config.slots.time;
  assert.equal(time.enabled, true);
  assert.equal(time.factor, 0.3);
  assert.equal(time.ease, 0.2);
});

test("a pair's time track is the player's and eases", () => {
  const w = importWorkspaceXml(head + '<Pair id="P" clip="Animations\\P.hkx"/></AnimationSet>');
  const p = w.actions[0].pair;
  assert.equal(p.timeline.time.role, 'player');
  Object.assign(p.timeline.time, {enabled: true, factor: 0.25, ease: 0.3});
  assert.equal(validateWorkspace(w).filter(x => x.level === 'error').length, 0);
  assert.ok(rows(w, w.actions[0]).some(r => r.id === 'pair:time'));
  assert.match(compileWorkspace(w), /op="timeOn" target="player" factor="0\.25" ease="0\.3"/);
});
