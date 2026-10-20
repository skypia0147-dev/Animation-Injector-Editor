import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {s4sample} from '../src/s4sample.ts';
import {savedProject} from '../src/editorBlock.ts';
import {
  addAction,
  emptyWorkspace,
  parseWorkspace,
  compileWorkspace,
  validateWorkspace,
  removeAction,
} from '../src/workspace.ts';
import {portable, applyParameter, parameterValue} from '../src/authoring.ts';
import {assets, selectAsset, policy, request, packageProblems, plugins, folderValid} from '../src/package.ts';
import {exportTemplate, parseTemplate} from '../src/templates.ts';
import {checker, needsChecker} from './local.mjs';
const dir = resolve('tests/generated/s5');
// One action with a key, like a new project once its first action is added (the built-in start templates
// went in 2026-10-01); a pair also exposes its loss blend as a public parameter.
function starter(kind) {
  const w = emptyWorkspace(),
    a = addAction(w, kind);
  w.actions.push(a);
  a.config.start.mode = 'input';
  a.config.start.input = a.config.inputs[0].id;
  a.config.inputs[0].key = 'NumEnter';
  if (kind === 'pair') a.config.steps[0].clip = 'Animations\\MyMod\\Paired.hkx';
  const field = (id, f, input, min, max) => ({id, label: id, help: '', action: a.uid, field: f, input, min, max});
  w.parameters = [field('useKey', 'inputKey', a.config.inputs[0].id, 0, 0), field('cooldown', 'cooldown', '', 0, 10)];
  if (kind === 'pair') w.parameters.push(field('lossBlend', 'lossBlend', '', 0.01, 5));
  return w;
}
mkdirSync(dir, {recursive: true});
test('schema 3 upgrades strictly and packaging choices survive schema 4 round trips', () => {
  // The 0.4.0 release's S4Connections project (schema 3), kept in the example XML's editor block.
  const previous = JSON.parse(savedProject(readFileSync('examples/S4Connections.xml', 'utf8')).project);
  assert.equal(previous.schema, 3);
  const w = parseWorkspace(JSON.stringify(previous));
  assert.equal(w.schema, 7);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
  previous.future = 1;
  assert.throws(() => parseWorkspace(JSON.stringify(previous)));
  const invalid = structuredClone(w);
  invalid.packaging.typo = true;
  assert.throws(() => parseWorkspace(JSON.stringify(invalid)));
  const duplicate = structuredClone(w);
  duplicate.packaging.policies = [
    {clip: 'Animations/A.hkx', mode: 'copy', dependency: ''},
    {clip: 'animations/a.hkx', mode: 'external', dependency: 'Provider'},
  ];
  assert.throws(() => parseWorkspace(JSON.stringify(duplicate)));
});
test('repeated clips coalesce; conflicting sources remain visible for explicit resolution', () => {
  let w = s4sample();
  assert.equal(assets(w).length, 3);
  const clip = w.actions[0].config.steps[0].clip;
  w.actions[0].config.steps[0].localPath = 'H:/A/meshes/actors/character/' + clip;
  w.actions[1].config.steps[0].localPath = 'H:/B/meshes/actors/character/' + clip;
  assert.equal(assets(w)[0].paths.length, 2);
  w = selectAsset(w, clip, 'H:/chosen.hkx');
  assert.equal(assets(w)[0].paths.length, 1);
  assert.equal(w.actions[1].config.steps[0].localPath, 'H:/chosen.hkx');
});
test('external assets require named providers, and portable projects omit machine paths', () => {
  let w = s4sample();
  w.packaging.roots = ['H:/Private/Mods'];
  w.actions[0].config.steps[0].localPath = 'H:/Private/source.hkx';
  w = policy(w, w.actions[0].config.steps[0].clip, 'external', '');
  assert.ok(packageProblems(w).length);
  w = policy(w, w.actions[0].config.steps[0].clip, 'external', 'External Animations');
  const r = request(w);
  assert.equal(r.assets.find(a => a.mode === 'external').dependency, 'External Animations');
  assert.deepEqual(compileWorkspace(portable(w)), compileWorkspace(w));
});
test('public parameters bind stable IDs, enforce ranges and protect deletion', () => {
  let w = starter('pair');
  assert.equal(parameterValue(w, w.parameters[2]), 0.6); // a new pair's partner-lost blend (10-20)
  w = applyParameter(w, 'lossBlend', 3);
  assert.equal(w.actions[0].pair.lossBlend, 3);
  w = applyParameter(w, 'useKey', 'Num5');
  assert.equal(w.actions[0].config.inputs[0].key, 'Num5');
  assert.throws(() => applyParameter(w, 'lossBlend', 6));
  assert.throws(() => applyParameter(w, 'useKey', '__proto__'));
  assert.throws(() => removeAction(w, w.actions[0].uid));
  w.actions[0].config.actionId = 'Renamed';
  assert.equal(parameterValue(w, w.parameters[0]), 'Num5');
  w.actions[0].pair.lossEnabled = false;
  assert.ok(validateWorkspace(w).some(i => i.node === 'parameters' && i.level === 'error'));
});
test('shared templates produce matching real current XML parser declarations', needsChecker, () => {
  for (const kind of ['single', 'pair']) {
    const w = starter(kind);
    assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0, kind);
    const shared = parseTemplate(exportTemplate(w));
    assert.equal(compileWorkspace(shared), compileWorkspace(w));
    const a = resolve(dir, kind + '-v1.xml'),
      b = resolve(dir, kind + '-v2.xml');
    writeFileSync(a, compileWorkspace(w));
    writeFileSync(b, compileWorkspace(w));
    const result = spawnSync(checker, ['--compare', a, b], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
test('dependencies only include active spell roles and unsafe output names are rejected', () => {
  const w = s4sample(),
    p = w.actions[0].pair;
  p.effects = [{id: 'spell', values: {op: 'spell', name: 'Cast', plugin: 'Required.esp', form: '806'}}];
  assert.deepEqual(plugins(w), []);
  p.effectsEnabled = true;
  assert.deepEqual(plugins(w), ['Required.esp']);
  for (const n of ['../Mods', 'C:/Mods', 'CON', 'LPT1.txt', 'Bad.', 'Bad ', 'stream:name', '.aieditor-evil'])
    assert.equal(folderValid(n), false, n);
  assert.equal(folderValid('한글 모드 1.0'), true);
});
