import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {checker, needsChecker} from './local.mjs';

// The MCO add-on's reinforcement (runtime 1.1.0, 11-27): a start that stands aside when a behavior patch made its
// variable (compare="exists"), and clips a moveset may not have (optional="true"), reached by a row the runtime passes
// over when the clip is installed nowhere.
const MCO = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="MyMoveset">
  <Start event="attackStart" block="attackStart" blockWhen="both">
    <Check kind="graphVariable" variable="MCO_BlendLength" type="float" compare="exists" not="true"/>
    <True to="Attack1"/>
  </Start>
  <Action id="Attack1" clip="Animations\\MCO_attack1.hkx" attack="attackStart">
    <Transition event="attackPowerStartInPlace" from="event:MCO_PowerWinOpen" until="event:MCO_PowerWinClose">
      <Row to="TransN1P1"><Check kind="alive"/></Row>
      <Row to="Power1"><Check kind="alive"/></Row>
    </Transition>
  </Action>
  <Action id="Power1" clip="Animations\\MCO_powerattack1.hkx" attack="attackPowerStartInPlace">
    <Transition to="PowerLoop1" on="end"/>
  </Action>
  <Action id="PowerLoop1" clip="Animations\\MCO_powerattackloop1.hkx" optional="true" loop="true" maxHold="600">
    <Transition to="Power1" on="release" control="rightAttack"/>
  </Action>
  <Action id="TransN1P1" clip="Animations\\MCO_TransitionNormal1ToPower1.hkx" optional="true">
    <Transition to="Power1" on="end"/>
  </Action>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');

test('optional clips and a graph variable asked to exist read in, write back unchanged and load', needsChecker, () => {
  const w = importWorkspaceXml(MCO);
  assert.deepEqual(errors(w), []);
  const optional = w.actions.filter(a => a.config.optional).map(a => a.config.actionId);
  assert.deepEqual(optional.sort(), ['PowerLoop1', 'TransN1P1']);
  const exists = w.cards.flatMap(c => c.tests).find(t => t.kind === 'graphVariable');
  assert.equal(exists?.compare, 'exists');
  assert.equal(exists?.value, undefined, 'no value');
  const xml = compileWorkspace(w);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.equal((xml.match(/optional="true"/g) ?? []).length, 2);
  assert.match(
    xml,
    /<Check kind="graphVariable" compare="exists" variable="MCO_BlendLength" type="float" not="true"\/>/
  );
  assert.doesNotMatch(xml, /compare="exists"[^>]*value=/);
  mkdirSync('tests/generated/optional-clip', {recursive: true});
  writeFileSync('tests/generated/optional-clip/MyMoveset.xml', xml);
  execFileSync(checker, ['tests/generated/optional-clip/MyMoveset.xml']);
});

test('what the runtime refuses about optional clips and existence checks is refused on reading', () => {
  for (const bad of [
    MCO.replace('compare="exists"', 'compare="exists" value="1"'),
    MCO.replace('variable="MCO_BlendLength" type="float" ', 'variable="MCO_BlendLength" '),
    MCO.replace('optional="true" loop="true"', 'optional="yes" loop="true"'),
    MCO.replace('maxHold="600">', 'maxHold="600" body="upper">'),
  ])
    assert.throws(() => importWorkspaceXml(bad));
});
