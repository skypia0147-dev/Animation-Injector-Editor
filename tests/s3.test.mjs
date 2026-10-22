import {actionXml} from '../src/compiler.ts';
import {documentXml, node} from '../src/xml.ts';
import {XML_FORMAT_VERSION} from '../src/xmlFormat.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  createProject,
  parseProject,
  validate,
  mark,
  clone,
  addEvent,
  renameEvent,
  removeEvent,
  removeInput,
} from '../src/model.ts';
import {checker, needsChecker} from './local.mjs';

// One action's XML file, as the workspace writes it for that action alone.
const exportXml = p => documentXml(node('AnimationSet', {version: XML_FORMAT_VERSION, id: p.actionId}, [actionXml(p)]));

test('combo projects (schema 1, a combo kind, transitions or several HKX) are refused naming the change', () => {
  assert.throws(() => parseProject(JSON.stringify({schema: 1, name: 'Old'})), /콤보/);
  for (const mutate of [
    p => (p.kind = 'combo'),
    p => (p.transitions = [{id: 'T1'}]),
    p => p.steps.push({...p.steps[0], id: 'A2'}),
  ]) {
    const p = createProject();
    mutate(p);
    assert.throws(() => parseProject(JSON.stringify(p)), /콤보/);
  }
  // An empty transition list (saved before format 4) is dropped.
  const p = createProject();
  assert.deepEqual(parseProject(JSON.stringify({...p, transitions: []})), p);
});
test('future, nested unknown, missing and malformed project fields are refused', () => {
  for (const mutate of [
    p => (p.schema = 3),
    p => (p.slots.iframe.until.future = 1),
    p => delete p.start.actor,
    p => (p.events = [{}]),
    p => (p.kind = 'pair'),
    p => (p.steps[0].position.x = Infinity),
    p => (p.exit.basis = 'percent'),
  ]) {
    const p = createProject();
    mutate(p);
    assert.throws(() => parseProject(JSON.stringify(p)));
  }
});
test('the start key is written where it is used; a used input cannot be removed', () => {
  const p = createProject();
  p.inputs[0].key = 'J';
  assert.match(exportXml(p), /<Start key="J"\/>/);
  assert.throws(() => removeInput(p, 'use'));
  p.inputs[0].key = 'code:36';
  assert.match(exportXml(p), /<Start key="code:36"\/>/);
  // A pad button by its name (format 4); no key and no button is an error.
  p.inputs[0] = {...p.inputs[0], key: '', gamepad: 4096};
  assert.match(exportXml(p), /<Start gamepad="A"\/>/);
  p.inputs[0].gamepad = 0;
  assert.throws(() => exportXml(p));
});
test('event renaming updates active and hidden references; deletion protects both', () => {
  let p = addEvent(createProject(), 'Open');
  p.start.event = 'Open';
  p.exit.event = 'Open';
  p.slots.armor.until.event = 'Open';
  p = renameEvent(p, 'Open', 'NewOpen');
  assert.equal(p.start.event, 'NewOpen');
  assert.equal(p.exit.event, 'NewOpen');
  assert.equal(p.slots.armor.until.event, 'NewOpen');
  assert.throws(() => removeEvent(p, 'NewOpen'));
  assert.throws(() => addEvent(p, 'NewOpen'));
});
test('single overrides and event-only starts are explicit without hidden key bindings', () => {
  const p = createProject();
  p.steps[0].attack = 'attackStart';
  p.start.mode = 'event';
  p.start.actor = 'npc';
  p.start.event = 'EditorStart';
  const xml = exportXml(p);
  assert.match(xml, /<Start event="EditorStart" actor="npc"/);
  assert.match(xml, /<Attack data="attackStart"/);
  assert.doesNotMatch(xml, /<Inputs|<Step|<Combo/);
  p.start.mode = 'none';
  assert.doesNotMatch(exportXml(p), /<Start/);
});
test('defaults are not written (format 4): a new action is its clip, key and blends', () => {
  const xml = exportXml(createProject());
  assert.match(xml, /<Action id="EditorSingle" clip="Animations\\MyMod\\Action.hkx">/);
  assert.doesNotMatch(xml, /<Require|<Advanced|graph=|cooldown=|safety=|air=/);
  const p = createProject();
  Object.assign(p, {cooldown: 0.2, air: 'allow'});
  assert.match(exportXml(p), /<Require air="allow" cooldown="0.2"\/>/);
});
test('runtime timing limits block unsupported clocks and escaping preserves event strings', () => {
  const p = createProject();
  p.exit = mark(0.5);
  assert.throws(() => exportXml(p));
  p.exit = mark(0.05, 'end');
  p.slots.iframe.enabled = true;
  // Windows run at clip times only (format 3): an event moment is a registry function.
  p.slots.iframe.until = {...mark(0, 'event'), event: 'Off', fallback: true, fallbackBasis: 'end'};
  assert.throws(() => exportXml(p));
  p.slots.iframe.until = mark(0.3);
  p.exit = {...mark(0.05, 'event'), event: 'Off&Done', fallback: true, fallbackBasis: 'end'};
  assert.match(exportXml(p), /at="event:Off&amp;Done" fallback="end-0.05"/);
  p.steps[0].clip = 'Animations//bad.hkx';
  assert.throws(() => exportXml(p));
});
test('layout and input labels do not change XML', needsChecker, () => {
  const p = createProject();
  const before = exportXml(p);
  p.steps[0].position = {x: -50, y: 40};
  p.trigger = {x: 0, y: 0};
  p.inputs[0].label = '기본 공격';
  assert.equal(exportXml(p), before);
});

const output = resolve('tests/generated/s3');
mkdirSync(output, {recursive: true});
function parses(name, xml) {
  const file = resolve(output, name + '.xml');
  writeFileSync(file, xml);
  const result = spawnSync(checker, [file], {encoding: 'utf8'});
  assert.equal(result.status, 0, `${name}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
test('actual C++ parser reads single, attack, event, slots, gamepad and scan-code outputs', needsChecker, () => {
  const cases = [];
  const p = createProject();
  cases.push(['single', p]);
  const attack = clone(p);
  attack.steps[0].attack = 'attackStart';
  cases.push(['single-attack', attack]);
  const events = createProject();
  events.start.mode = 'event';
  events.start.event = 'S3Start';
  events.start.actor = 'npc';
  events.exit = {...mark(0.05, 'event'), event: 'S3End', fallback: true, fallbackBasis: 'end'};
  for (const s of Object.values(events.slots)) {
    s.enabled = true;
    s.from = mark(0.1);
    s.until = mark(0.05, 'end');
  }
  events.recovery = {enabled: true, at: {...mark(0.8, 'event'), event: 'Recover', fallback: true}, blend: 0.2};
  events.cost = {enabled: true, at: mark(0.1), stamina: 12, magicka: 3};
  cases.push(['all-slots', events]);
  for (const code of [4096, 9, 300]) {
    const pad = createProject();
    pad.inputs[0] = {...pad.inputs[0], key: '', gamepad: code};
    cases.push(['gamepad-' + code, pad]);
  }
  const scan = createProject();
  scan.inputs[0].key = 'code:1';
  cases.push(['scan-code', scan]);
  const noStart = createProject();
  noStart.start.mode = 'none';
  cases.push(['external', noStart]);
  for (const [name, p] of cases) {
    assert.equal(validate(p).filter(i => i.level === 'error').length, 0, name);
    parses(name, exportXml(p));
  }
});
