import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {commandSummary, parseCommand} from '../src/annotationCommands.ts';
import {functionErrors, registryFields, valueFields} from '../src/eventRegistry.ts';
import {checker, needsChecker} from './local.mjs';

// Attack data by event (runtime 1.1.0): a registered event names the sender's attack data (its race's, by event
// name) over the action's own, another ends it; a clip's annotation does the same as AI.AttackDataOn|name.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="LeftSwing">
  <EventRegistry>
    <Event name="MyLeftSwing">
      <Do op="attackDataOn" name="attackStartLeftHand"/>
    </Event>
    <Event name="MyBash">
      <Do op="attackDataOn" name="bashStart" duration="0.4"/>
    </Event>
    <Event name="MySwingEnd">
      <Do op="attackDataOff"/>
    </Event>
  </EventRegistry>
  <Start key="G" to="Attack1"/>
  <Action id="Attack1" clip="Animations\\MySet\\attack1.hkx" attack="attackStart"/>
</AnimationSet>
`;

test('attack data on and off are registered functions that read back as written', () => {
  const w = importWorkspaceXml(XML, 'LeftSwing.xml');
  assert.deepEqual(validateWorkspace(w), []);
  const functions = (w.eventRegistry ?? []).map(r => r.functions.map(f => f.values));
  assert.deepEqual(functions, [
    [{op: 'attackDataOn', name: 'attackStartLeftHand'}],
    [{op: 'attackDataOn', name: 'bashStart', duration: '0.4'}],
    [{op: 'attackDataOff'}],
  ]);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Do op="attackDataOn" name="attackStartLeftHand"\/>/);
  assert.match(xml, /<Do op="attackDataOn" duration="0.4" name="bashStart"\/>/);
  assert.match(xml, /<Do op="attackDataOff"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml, 'LeftSwing.xml')), xml);
});

test("the name and the span are the registry's; a name is required and holds no blank", () => {
  assert.deepEqual(registryFields('attackDataOn'), ['name', 'duration']);
  assert.deepEqual(valueFields('attackDataOn'), ['delay']);
  assert.deepEqual(registryFields('attackDataOff'), []);
  assert.deepEqual(functionErrors({op: 'attackDataOn', name: 'attackStartLeftHand'}), []);
  assert.equal(functionErrors({op: 'attackDataOn'}).length, 1);
  assert.equal(functionErrors({op: 'attackDataOn', name: 'a b'}).length, 1);
  assert.equal(functionErrors({op: 'attackDataOff', name: 'attackStart'}).length, 1);
});

test('AI.AttackDataOn|name[|span] and AI.AttackDataOff are annotation commands', () => {
  assert.deepEqual(parseCommand('AttackDataOn|attackStartLeftHand'), {op: 'attackDataOn', name: 'attackStartLeftHand'});
  assert.deepEqual(parseCommand('attackdataon|bashStart|0.5'), {
    op: 'attackDataOn',
    name: 'bashStart',
    duration: '0.5',
  });
  assert.deepEqual(parseCommand('AttackDataOff'), {op: 'attackDataOff'});
  for (const bad of ['AttackDataOn', 'AttackDataOn|', 'AttackDataOn|a b', 'AttackDataOn|a|x', 'AttackDataOff|a'])
    assert.equal(parseCommand(bad), undefined, bad);
  assert.match(commandSummary('AttackDataOn|attackStartLeftHand'), /attackStartLeftHand/);
});

test('the runtime checker reads what the editor writes', needsChecker, () => {
  mkdirSync('tests/generated/attack-data-event', {recursive: true});
  const path = 'tests/generated/attack-data-event/LeftSwing.xml';
  writeFileSync(path, compileWorkspace(importWorkspaceXml(XML, 'LeftSwing.xml')));
  assert.match(execFileSync(checker, [path], {encoding: 'utf8'}), /^Valid: 1 actions, 3 registered events/);
});
