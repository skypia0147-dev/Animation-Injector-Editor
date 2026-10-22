import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createProject, clone} from '../src/model.ts';
import {
  migrateWorkspace,
  parseWorkspace,
  compileWorkspace,
  validateWorkspace,
  addAction,
  addLink,
  removeAction,
  emptyWorkspace,
  operations,
} from '../src/workspace.ts';
import {eventOps, pairRoles, fieldsOf, doAttrs} from '../src/eventRegistry.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseXml} from '../src/xml.ts';
import {savedProject, withEditorBlock} from '../src/editorBlock.ts';
import {s4sample} from '../src/s4sample.ts';
import {checker, needsChecker} from './local.mjs';
const dir = resolve('tests/generated/s4');
mkdirSync(dir, {recursive: true});
function check(...args) {
  const r = spawnSync(checker, args, {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
const original = resolve('tests/fixtures/current-xml/Grapple.xml');
test(
  'Grapple eight actions, both roles, all QTE stages survive current XML and project round trips',
  needsChecker,
  () => {
    const w = importWorkspaceXml(readFileSync(original, 'utf8'));
    assert.equal(w.actions.length, 8);
    assert.equal(w.links.length, 6);
    assert.equal(w.actions[0].enterBlendEnabled, false);
    assert.equal(w.actions[0].pair.angle, 180);
    for (const stage of ['01', '02', '10'])
      assert.equal(w.links.filter(l => l.event === 'Grapple_QTE_Stage' + stage && l.partnerTo).length, 2);
    assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
    for (const v of [1, 2]) {
      const file = resolve(dir, 'Grapple-v' + v + '.xml');
      writeFileSync(file, compileWorkspace(w, v));
      check('--compare', original, file);
      const reload = importWorkspaceXml(readFileSync(file, 'utf8'));
      const again = resolve(dir, 'Grapple-reload-v' + v + '.xml');
      writeFileSync(again, compileWorkspace(reload, v));
      check('--compare', original, again);
    }
    writeFileSync(resolve(dir, 'Grapple.xml'), withEditorBlock(compileWorkspace(w), JSON.stringify(w)));
  }
);
test('S3 migration and XML roundtrip preserve executable semantics', needsChecker, () => {
  // S3Combo was a combo: projects with combos no longer open (format 4).
  for (const name of ['S3Single', 'S3Directional', 'S3Event']) {
    const p = JSON.parse(savedProject(readFileSync('examples/' + name + '.xml', 'utf8')).project);
    const w = parseWorkspace(JSON.stringify(p));
    assert.equal(w.schema, 7);
    for (const v of [1, 2]) {
      const file = resolve(dir, name + '-v' + v + '.xml');
      writeFileSync(file, compileWorkspace(importWorkspaceXml(compileWorkspace(w, v)), v));
      // A directional project keeps its entry clip as one single action (motion is the HKX's, 0.12.231).
      const expected = name === 'S3Directional' ? 'DirectionalMigrated' : name.slice(2);
      check('--compare', resolve('tests/fixtures/current-xml/' + expected + '.xml'), file);
    }
  }
});
test('stable action IDs, guarded deletion, invalid roles and input conflicts', () => {
  const w = emptyWorkspace();
  for (const kind of ['pair', 'single', 'single', 'pair']) w.actions.push(addAction(w, kind));
  const l = addLink(w, w.actions[0].uid, w.actions[1].uid);
  l.event = 'Next';
  l.partnerTo = w.actions[2].uid;
  w.links.push(l);
  w.actions[1].config.actionId = 'Renamed';
  assert.match(compileWorkspace(w), /to="Renamed"/);
  assert.throws(() => removeAction(w, w.actions[1].uid));
  l.partnerTo = w.actions[3].uid;
  assert.throws(() => compileWorkspace(w));
  l.partnerTo = '';
  l.mode = 'input';
  l.input = w.actions[0].config.inputs[0].id;
  l.window = true;
  w.links.push({...clone(l), id: 'other'});
  assert.throws(() => compileWorkspace(w));
});
test('unknown XML and schema data fail atomically; entities are bounded and never expanded', () => {
  for (const raw of [
    '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///c:/secret">]><x/>',
    '<x a="&no;"/>',
    '<x a="1" a="2"/>',
    '<x><y></x>',
    '<x/>junk',
  ])
    assert.throws(() => parseXml(raw));
  assert.equal(parseXml('<x a="&#xD55C;&amp;"/>').attrs.a, '한&');
  const originalText = readFileSync(original, 'utf8');
  for (const raw of [
    originalText.replace('<OnPartnerLost blend=', '<OnPartnerLost typo='),
    originalText.replace('<Exit', '<Unknown'),
    originalText.replace('<Do op="hide"/>', '<Do op="invalid"/>'),
    originalText.replace('<EventRegistry>', '<EventRegistry><Event name="Grapple_unequip"/>'),
  ])
    assert.throws(() => importWorkspaceXml(raw));
  // An older file's event function target opens as one changing its sender (runtime 0.12.273).
  const older = importWorkspaceXml(originalText.replace('<Do op="hide"/>', '<Do op="hide" target="lead"/>'));
  assert.ok(older.eventRegistry.every(r => r.functions.every(f => !('target' in f.values) && !('from' in f.values))));
  const w = migrateWorkspace(createProject());
  w.actions[0].unknown = true;
  assert.throws(() => parseWorkspace(JSON.stringify(w)));
});
test('S4 sample covers single to pair, pair to pair and both ordinary roles using actual parser', needsChecker, () => {
  const w = s4sample();
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
  const a = resolve(dir, 'S4Connections-v1.xml'),
    b = resolve(dir, 'S4Connections-v2.xml');
  writeFileSync(a, compileWorkspace(w));
  writeFileSync(b, compileWorkspace(w));
  check('--compare', a, b);
  for (const v of [1, 2]) {
    const file = resolve(dir, 'S4-reload-v' + v + '.xml');
    writeFileSync(file, compileWorkspace(importWorkspaceXml(compileWorkspace(w, v)), v));
    check('--compare', a, file);
  }
  writeFileSync(resolve(dir, 'S4Connections.xml'), withEditorBlock(compileWorkspace(w), JSON.stringify(w)));
});
// Every op with its settings, as a pair clip-time effect and as a registered event function.
const settingValue = {
  plugin: 'FH_Grapple.esp',
  form: '806',
  releasePhysics: 'true',
  parameters: 'true',
  delay: '0.2',
  stamina: '10',
  magicka: '5',
  strength: '0.8',
  duration: '0.5',
  move: 'true',
  look: 'true',
  factor: '0.5',
};
const withSettings = (op, i) => ({
  op,
  // A pair's clip-time effect names a role and no sender filter (runtime 0.12.275).
  target: pairRoles[i % pairRoles.length],
  ...Object.fromEntries(fieldsOf(op).map(k => [k, settingValue[k]])),
});
test('all role operations and supported parameters preserve parser semantics', needsChecker, () => {
  const w = s4sample(),
    p = w.actions[0].pair;
  p.effectsEnabled = true;
  w.actions[0].cameraEnabled = true;
  w.actions[0].camera = {reset: 'ResetCamera', restore: 'end', timeout: 10};
  p.interruptOnThirdPartyHit = true;
  p.effects = operations.map((op, i) => ({id: 'effect' + i, values: {...withSettings(op, i), at: String(i * 0.1)}}));
  w.eventRegistry = eventOps.map((op, i) => ({
    id: 'event' + i,
    name: 'Event' + i,
    // A registered function changes its sender: no role (runtime 0.12.273).
    functions: [{id: 'fn1', values: (({target: _, ...v}) => v)(withSettings(op, i + 1))}],
  }));
  const a = resolve(dir, 'effects-v1.xml'),
    b = resolve(dir, 'effects-v2.xml');
  writeFileSync(a, compileWorkspace(w));
  writeFileSync(b, compileWorkspace(w));
  check('--compare', a, b);
  const reread = importWorkspaceXml(compileWorkspace(w));
  assert.deepEqual(
    reread.actions[0].pair.effects.map(e => doAttrs(e.values, true)),
    p.effects.map(e => doAttrs(e.values, true))
  );
  assert.deepEqual(
    reread.eventRegistry.map(r => [r.name, r.functions.map(f => doAttrs(f.values))]),
    w.eventRegistry.map(r => [r.name, r.functions.map(f => doAttrs(f.values))])
  );
  for (const patch of [
    {at: 'NaN'},
    {form: '../bad'},
    {target: 'sender'},
    {factor: '0'},
    {target: 'npc'},
    {from: 'any'},
  ]) {
    const invalid = clone(w);
    Object.assign(invalid.actions[0].pair.effects[2].values, patch);
    assert.throws(() => compileWorkspace(invalid));
  }
  for (const patch of [{op: 'fireArrow', target: 'partner'}, {op: 'stateOn', plugin: ''}, {delay: '61'}]) {
    const invalid = clone(w);
    Object.assign(invalid.eventRegistry[2].functions[0].values, patch);
    assert.throws(() => compileWorkspace(invalid));
  }
  const badName = clone(w);
  badName.eventRegistry[0].name = 'bad|@2';
  assert.throws(() => compileWorkspace(badName));
  const twice = clone(w);
  twice.eventRegistry[1].name = 'event0';
  assert.throws(() => compileWorkspace(twice));
});
test('repeated imports never declare inputs: keys stay where they are used (format 4)', needsChecker, () => {
  let xml = compileWorkspace(s4sample());
  for (let i = 0; i < 8; i++) {
    xml = compileWorkspace(importWorkspaceXml(xml));
    assert.ok(!parseXml(xml).children.some(n => n.name === 'Inputs'));
  }
  const file = resolve(dir, 'S4-eight-roundtrips.xml');
  writeFileSync(file, xml);
  check('--compare', resolve(dir, 'S4Connections-v1.xml'), file);
});
