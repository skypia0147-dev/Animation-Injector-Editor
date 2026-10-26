import {actionXml} from '../src/compiler.ts';
import {documentXml, node} from '../src/xml.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createProject, parseProject, validate, mark, clone, addEvent, renameEvent, removeEvent} from '../src/model.ts';
import {checker, needsChecker} from './local.mjs';

// One HKX card's XML as the compiler writes it (format 6: its start is a start card of its own, written by the
// workspace). The checker reads it with a start card in front.
const blends = {enterBlendEnabled: true, exitBlendEnabled: true};
const exportXml = (p, a = blends) => documentXml(node('AnimationSet', {version: 6, id: p.actionId}, [actionXml(p, a)]));

test('future, nested unknown, missing and malformed project fields are refused', () => {
  for (const mutate of [
    p => (p.schema = 3),
    p => (p.slots.iframe.until.future = 1),
    p => delete p.exit.basis,
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
test('event renaming updates every moment; deletion protects a used event', () => {
  let p = addEvent(createProject(), 'Open');
  p.exit = {...mark(0, 'event'), event: 'Open'};
  p.slots.armor.until.event = 'Open';
  p = renameEvent(p, 'Open', 'NewOpen');
  assert.equal(p.exit.event, 'NewOpen');
  assert.equal(p.slots.armor.until.event, 'NewOpen');
  assert.throws(() => removeEvent(p, 'NewOpen'));
  assert.throws(() => addEvent(p, 'NewOpen'));
});
test('an attack is the action attribute; there are no hidden key bindings', () => {
  const p = createProject();
  p.steps[0].attack = 'attackStart';
  const xml = exportXml(p);
  assert.match(xml, / attack="attackStart"/);
  assert.doesNotMatch(xml, /<Inputs|<Step|<Combo|<Start/);
});
test('defaults are not written (format 6): a new action is its clip and blends', () => {
  const xml = exportXml(createProject(), {enterBlendEnabled: false, exitBlendEnabled: false});
  assert.match(xml, /<Action id="EditorSingle" clip="Animations\\MyMod\\Action.hkx"\/>/);
  const p = createProject();
  Object.assign(p, {air: 'allow'});
  assert.match(exportXml(p), /<Action id="EditorSingle" clip="[^"]+" air="both" enter="0.1">/);
  p.air = 'only';
  assert.match(exportXml(p), / air="only"/);
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
  // An event moment waits for its event only (runtime 0.12.278): no fallback is written.
  p.exit = {...mark(0.05, 'event'), event: 'Off&Done', fallback: true, fallbackBasis: 'end'};
  assert.match(exportXml(p), /<Exit at="event:Off&amp;Done"\/>|<Exit at="event:Off&amp;Done" /);
  assert.doesNotMatch(exportXml(p), /fallback=/);
  p.steps[0].clip = 'Animations//bad.hkx';
  assert.throws(() => exportXml(p));
});
test('layout does not change XML', () => {
  const p = createProject();
  const before = exportXml(p);
  p.steps[0].position = {x: -50, y: 40};
  p.trigger = {x: 0, y: 0};
  assert.equal(exportXml(p), before);
});

const output = resolve('tests/generated/s3');
mkdirSync(output, {recursive: true});
function parses(name, xml) {
  const file = resolve(output, name + '.xml');
  // A start card in front, as the workspace writes it.
  writeFileSync(file, xml.replace(/(<AnimationSet [^>]*>)/, '$1\n  <Start to="EditorSingle" key="G"/>'));
  const result = spawnSync(checker, [file], {encoding: 'utf8'});
  assert.equal(result.status, 0, `${name}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
test('actual C++ parser reads single, attack, events and slots outputs', needsChecker, () => {
  const cases = [];
  const p = createProject();
  cases.push(['single', p]);
  const attack = clone(p);
  attack.steps[0].attack = 'attackStart';
  cases.push(['single-attack', attack]);
  const events = createProject();
  events.exit = {...mark(0.05, 'event'), event: 'S3End', fallback: true, fallbackBasis: 'end'};
  for (const s of Object.values(events.slots)) {
    s.enabled = true;
    s.from = mark(0.1);
    s.until = mark(0.05, 'end');
  }
  events.recovery = {enabled: true, at: {...mark(0.8, 'event'), event: 'Recover', fallback: true}, blend: 0.2};
  events.cost = {enabled: true, at: mark(0.1), stamina: 12, magicka: 3};
  cases.push(['all-slots', events]);
  for (const [name, p] of cases) {
    assert.equal(validate(p).filter(i => i.level === 'error').length, 0, name);
    parses(name, exportXml(p));
  }
});
