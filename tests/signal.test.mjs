import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {setActionSignal, signalVariable, signalUsers, signalIssues, signalRefused} from '../src/signal.ts';
import {checker, needsChecker} from './local.mjs';

// OAR signals (runtime 1.0.9 <Action signal>, runtime/Signals.h): a charge whose three actions keep one variable on,
// and a part action with a name of its own.
const SIGNALS = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="MyBow">
  <Start control="rightAttack" press="hold" to="ChargeStart"/>
  <Action id="ChargeStart" clip="Animations\\MyBow\\Start.hkx" body="upper" signal="Charge">
    <Transition to="ChargeHold" on="end"/>
  </Action>
  <Action id="ChargeHold" clip="Animations\\MyBow\\Hold.hkx" loop="true" body="upper" signal="Charge">
    <Transition to="Release" on="release"/>
  </Action>
  <Action id="Release" clip="Animations\\MyBow\\Release.hkx" signal="Charge_Shot"/>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');
const byId = (w, id) => w.actions.find(a => a.config.actionId === id);

test('signals read in, write back unchanged and are what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(SIGNALS);
  assert.deepEqual(errors(w), []);
  assert.equal(byId(w, 'ChargeStart').config.signal, 'Charge');
  assert.equal(byId(w, 'Release').config.signal, 'Charge_Shot');
  assert.equal(signalVariable(w, 'Charge'), 'bAI_MyBow_Charge');
  assert.deepEqual(
    signalUsers(w, 'charge').map(a => a.config.actionId),
    ['ChargeStart', 'ChargeHold'],
    'the actions sharing a name, without case'
  );
  const xml = compileWorkspace(w);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.match(xml, /<Action id="ChargeHold"[^>]*signal="Charge"/);
  mkdirSync('tests/generated/signal', {recursive: true});
  writeFileSync('tests/generated/signal/MyBow.xml', xml);
  execFileSync(checker, ['tests/generated/signal/MyBow.xml']);
  // Taken off: no attribute.
  const off = setActionSignal(w, byId(w, 'Release').uid, '');
  assert.equal(byId(off, 'Release').config.signal, undefined);
  assert.doesNotMatch(compileWorkspace(off), /<Action id="Release"[^>]*signal=/);
});

test('a bad name, a pair or a creature action is the card problem the runtime would refuse', () => {
  const w = importWorkspaceXml(SIGNALS);
  for (const bad of ['Charge-1', 'a'.repeat(33), '차지'])
    assert.ok(
      signalIssues(setActionSignal(w, byId(w, 'ChargeStart').uid, bad)).some(i => i.level === 'error'),
      'refused: ' + bad
    );
  assert.deepEqual(signalIssues(setActionSignal(w, byId(w, 'ChargeStart').uid, 'a'.repeat(32))), []);
  const pair = structuredClone(w);
  byId(pair, 'Release').pair = {};
  assert.ok(signalRefused(byId(pair, 'Release')));
  assert.ok(signalIssues(pair).some(i => i.node === byId(pair, 'Release').uid));
  const creature = structuredClone(w);
  byId(creature, 'Release').config.rig = 'wolf';
  assert.ok(signalIssues(creature).some(i => i.node === byId(creature, 'Release').uid));
  assert.throws(() => importWorkspaceXml(SIGNALS.replace('signal="Charge_Shot"', 'signal="Charge Shot"')), /OAR/);
});
