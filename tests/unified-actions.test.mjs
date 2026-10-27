import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {switchActionKind} from '../src/actionTypes.ts';
import {pairTimelineEffects, pairTrackKeys} from '../src/pairTimeline.ts';
import {s4sample} from './fixtures/s4sample.ts';
import {portable} from '../src/authoring.ts';
import {checker, needsChecker} from './local.mjs';
const setup = () => {
  const w = emptyWorkspace();
  w.actions.push(addAction(w));
  return w;
};
test('same action changes between ordinary and pair, retaining identity and saved per-type clips', () => {
  let w = setup(),
    a = w.actions[0];
  const id = a.uid;
  a.config.steps[0].clip = 'Animations/Original.hkx';
  a.config.steps[0].localPath = 'C:/Mods/source.hkx';
  const original = structuredClone(a.config);
  w = switchActionKind(w, id, 'pair');
  // The first visit to a type keeps the chosen file (2026-10-28: changing to 페어 used to empty it).
  assert.equal(w.actions[0].config.steps[0].clip, 'Animations/Original.hkx');
  assert.equal(w.actions[0].config.steps[0].localPath, 'C:/Mods/source.hkx');
  w.actions[0].config.steps[0].clip = 'Animations/Paired.hkx';
  w.actions[0].pair.range = 345;
  w.actions[0].config.name = '共通 이름';
  w.actions[0].config.inputs.push({id: 'next', label: 'next', key: 'H', gamepad: 0});
  w = parseWorkspace(JSON.stringify(w));
  w = switchActionKind(w, id, 'single');
  a = w.actions[0];
  assert.equal(a.uid, id);
  assert.equal(a.config.actionId, original.actionId);
  assert.equal(a.config.name, '共通 이름');
  assert.equal(a.config.inputs[0].key, 'H');
  assert.deepEqual(a.config.steps, original.steps);
  w = switchActionKind(w, id, 'pair');
  assert.equal(w.actions[0].pair.range, 345);
  assert.equal(w.actions[0].config.steps[0].clip, 'Animations/Paired.hkx');
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
  // Combos went with XML format 4: an action is ordinary or a pair.
  assert.throws(() => switchActionKind(w, id, 'combo'), /지원하지 않는/);
  assert.ok(Object.values(portable(w).actions[0].variants).every(v => v.config.steps.every(s => !s.localPath)));
});
test('paired feature ranges emit supported role operations and match the actual XML parsers', needsChecker, () => {
  let w = setup();
  w = switchActionKind(w, w.actions[0].uid, 'pair');
  const a = w.actions[0],
    p = a.pair;
  a.config.steps[0].clip = 'Animations/Paired.hkx';
  for (const key of pairTrackKeys) p.timeline[key].enabled = true;
  p.timeline.iframe.role = 'both';
  p.timeline.cost.role = 'receiver';
  p.timeline.cost.stamina = 17;
  p.timeline.cost.magicka = 9;
  p.effects.push({id: 'timed', values: {op: 'hide', at: '0.3', target: 'both'}});
  const original = structuredClone(p.effects);
  assert.equal(validateWorkspace(w).filter(x => x.level === 'error').length, 0);
  // Tracks run at clip times; an event moment is a registry function (format 3).
  const eventTrack = structuredClone(w);
  eventTrack.actions[0].pair.timeline.armor.from = {...p.timeline.armor.from, basis: 'event', event: 'GuardOn'};
  assert.ok(validateWorkspace(eventTrack).some(x => x.level === 'error' && x.message.includes('armor')));
  assert.equal(pairTimelineEffects(p).length, 7);
  assert.ok(Object.values(a.config.slots).every(s => !s.enabled));
  assert.equal(a.config.cost.enabled, false);
  const dir = resolve('tests/generated/unified');
  mkdirSync(dir, {recursive: true});
  for (const v of [1, 2]) writeFileSync(resolve(dir, 'pair-v' + v + '.xml'), compileWorkspace(w, v));
  const r = spawnSync(checker, ['--compare', resolve(dir, 'pair-v1.xml'), resolve(dir, 'pair-v2.xml')], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(p.effects, original);
  const xml = compileWorkspace(w);
  // A role and no sender filter (runtime 0.12.275); both is the default and left out.
  assert.match(xml, /<Do at="[^"]*" op="cost" target="receiver" stamina="17"/);
  assert.match(xml, /<Do at="0.3" op="hide"\/>/);
  assert.doesNotMatch(xml, / from="/);
  p.timeline.iframe.enabled = false;
  const off = compileWorkspace(w);
  assert.doesNotMatch(off, /iframeOn/);
  p.timeline.iframe.enabled = true;
  assert.equal(compileWorkspace(w), xml);
});
test('unsupported pair timing and incompatible external links cannot silently compile', () => {
  const w = s4sample();
  assert.throws(() => switchActionKind(w, 'a1', 'single'), /양쪽 일반 전환/);
  assert.throws(() => switchActionKind(w, 'a4', 'pair'), /양쪽 일반 전환/);
  w.actions[0].pair.timeline.iframe.enabled = true;
  w.actions[0].pair.timeline.iframe.from.basis = 'end';
  assert.throws(() => compileWorkspace(w), /페어 트랙/);
});
test('unvisited pair type retains unsupported ordinary timing in its original profile', () => {
  let w = setup();
  const a = w.actions[0];
  a.config.slots.iframe.enabled = true;
  a.config.slots.iframe.until.basis = 'end';
  a.config.slots.iframe.until.seconds = 0.1;
  w = switchActionKind(w, a.uid, 'pair');
  assert.equal(w.actions[0].pair.timeline.iframe.enabled, false);
  w = switchActionKind(w, a.uid, 'single');
  assert.equal(w.actions[0].config.slots.iframe.until.basis, 'end');
  assert.equal(w.actions[0].config.slots.iframe.enabled, true);
});
