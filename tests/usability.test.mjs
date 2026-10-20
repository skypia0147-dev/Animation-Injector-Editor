import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {s4sample} from '../src/s4sample.ts';
import {savedProject} from '../src/editorBlock.ts';
import {parseWorkspace, compileWorkspace, validateWorkspace, addAction} from '../src/workspace.ts';
import {attachInput, updateSharedInput, deleteSharedInput} from '../src/sharedSettings.ts';
import {applyParameter, parameterDefault} from '../src/authoring.ts';
import {checker, needsChecker} from './local.mjs';
const output = resolve('tests/generated/usability');
mkdirSync(output, {recursive: true});
test('schema 4 migration preserves differing camera events until a common event is selected', needsChecker, () => {
  // The 0.5.1 release's S4Connections project (schema 3), kept in the example XML's editor block.
  const old = JSON.parse(savedProject(readFileSync('examples/S4Connections.xml', 'utf8')).project);
  const pairs = old.actions.filter(a => a.pair);
  for (const [n, a] of pairs.entries()) {
    a.pair.cameraEnabled = true;
    a.pair.effectsEnabled = true;
    a.pair.camera.reset = 'Reset' + n;
  }
  const w = parseWorkspace(JSON.stringify(old));
  assert.equal(w.schema, 7);
  assert.equal(w.globals.cameraReset, null);
  assert.match(compileWorkspace(w), /Reset0/);
  assert.match(compileWorkspace(w), /Reset1/);
  w.globals.cameraReset = 'SharedReset';
  const xml = compileWorkspace(w);
  assert.equal((xml.match(/reset="SharedReset"/g) || []).length, 2);
  assert.doesNotMatch(xml, /reset="Reset[01]"/);
  // The camera restore moved to the action (10-16); a new action has none until one is added.
  assert.equal(w.actions.find(a => a.pair).camera.reset, 'Reset0');
  assert.equal(addAction(w, 'pair').camera, undefined);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
  const v1 = resolve(output, 'global-v1.xml'),
    v2 = resolve(output, 'global-v2.xml');
  writeFileSync(v1, compileWorkspace(w));
  writeFileSync(v2, xml);
  const result = spawnSync(checker, ['--compare', v1, v2], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('standalone shared input assigns, synchronizes, protects references and supports parameter edits', () => {
  let w = s4sample();
  w.sharedInputs.push({id: 'shared1', label: '회피', key: 'G', gamepad: 0});
  w = attachInput(w, 'shared1', 'a1', true);
  w = attachInput(w, 'shared1', 'a2', true);
  w = updateSharedInput(w, {...w.sharedInputs[0], key: 'H'});
  assert.equal(w.actions[0].config.inputs.at(-1).key, 'H');
  assert.equal(w.actions[1].config.inputs.at(-1).key, 'H');
  w.actions[0].config.start.input = 'shared1';
  assert.throws(() => deleteSharedInput(w, 'shared1'), /시작 입력/);
  w.parameters.push({...parameterDefault(), id: 'sharedKey', action: 'a1', input: 'shared1'});
  w = applyParameter(w, 'sharedKey', 'Num4');
  assert.equal(w.sharedInputs[0].key, 'Num4');
  assert.equal(w.actions[1].config.inputs.at(-1).key, 'Num4');
  assert.equal(validateWorkspace(w).filter(x => x.level === 'error').length, 0);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
  w.parameters = [];
  w.actions[0].config.start.input = 'use';
  w = deleteSharedInput(w, 'shared1');
  assert.equal(w.sharedInputs.length, 0);
  assert.ok(w.actions.every(a => !a.config.inputs.some(i => i.id === 'shared1')));
});
