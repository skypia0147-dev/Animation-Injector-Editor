import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {gameControls} from '../src/keys.ts';
import {checker, needsChecker, runtimeSource, needsRuntimeSource} from './local.mjs';
import {readFileSync} from 'node:fs';

// Game controls (runtime 0.12.292): control="jump" instead of key=/gamepad= on a start, a transition, a QTE and a
// carry's put-down, read and written back the same, and the runtime's checker takes what the editor writes.
const out = resolve('tests/generated/game-controls');
mkdirSync(out, {recursive: true});
const XML = `<AnimationSet version="6" id="Controls">
  <Start control="jump" to="Leap"/>
  <Action id="Leap" clip="Animations\Controls\Leap.hkx">
    <Transition to="Roll" control="sprint"/>
    <QTE id="Q" at="0.2" control="activate"/>
  </Action>
  <Action id="Roll" clip="Animations\Controls\Roll.hkx"/>
</AnimationSet>`;

test('a game control is read and written back as control=, never as a key', () => {
  const w = importWorkspaceXml(XML);
  assert.equal(w.starts[0].control, 'jump');
  assert.equal(w.starts[0].key, '');
  const leap = w.actions.find(a => a.config.name === 'Leap' || a.config.id === 'Leap') ?? w.actions[0];
  assert.ok(leap.config.inputs.some(i => i.control === 'sprint' && !i.key && !i.gamepad));
  assert.equal(w.qtes[0].control, 'activate');
  assert.deepEqual(
    validateWorkspace(w).filter(i => i.severity === 'error'),
    []
  );
  const xml = compileWorkspace(w);
  assert.match(xml, /<Start[^>]* control="jump"/);
  assert.match(xml, /<Transition[^>]* control="sprint"/);
  assert.match(xml, /<QTE[^>]* control="activate"/);
  assert.doesNotMatch(xml, /<Start[^>]* key=/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml, 'read again, written the same');
  const reopened = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(reopened.starts[0].control, 'jump', 'the saved project keeps it');
  assert.equal(compileWorkspace(reopened), xml);
});

test('an unknown control or a control with a key is refused when read', () => {
  assert.throws(() => importWorkspaceXml(XML.replace('control="jump"', 'control="fly"')), /fly/);
  assert.throws(() => importWorkspaceXml(XML.replace('control="jump"', 'control="jump" key="G"')), /control/);
});

test('the runtime checker takes the editor’s game controls', needsChecker, () => {
  const file = resolve(out, 'Controls.xml');
  writeFileSync(file, compileWorkspace(importWorkspaceXml(XML)));
  const r = spawnSync(checker, [file], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the editor offers the runtime’s game controls, in its order', needsRuntimeSource, () => {
  const header = readFileSync(resolve(runtimeSource, 'src/runtime/GameControls.h'), 'utf8');
  const names = [...header.match(/kGameControlNames\[\] = \{([^}]*)\}/s)[1].matchAll(/"(\w*)"/g)]
    .map(m => m[1])
    .filter(Boolean);
  assert.deepEqual([...gameControls], names);
});
