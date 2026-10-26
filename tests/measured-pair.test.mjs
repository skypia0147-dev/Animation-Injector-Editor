// A space or ground check measures where the actor stands, for no particular action (runtime 0.12.299, mockup ⑩):
// it names no action (candidate is no attribute any more). A start whose card plays no pair names its
// target (mockup ⑨): the actor ahead by default (range, angle written when changed) or the combat target.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {choosesOrdinary} from '../src/cards.ts';

const pairs = String.raw`<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="T">
  <Inputs><Input id="k" key="G"/></Inputs>
  <Start id="S" input="k" condition="Front"/>
  <Condition id="Front">
    <Row condition="Kind"><Check kind="space" distance="300" direction="selfForward"/></Row>
    <False to="Rko"/>
  </Condition>
  <Condition id="Kind">
    <Check kind="combat"/>
    <True to="Swing"/>
    <False to="Rko"/>
  </Condition>
  <Pair id="Swing" clip="Animations\a.hkx"/>
  <Pair id="Rko" clip="Animations\b.hkx"/>
</AnimationSet>`;
test('a space check names no action to measure for', () => {
  const w = importWorkspaceXml(pairs);
  const t = w.cards.flatMap(c => c.tests).find(t => t.kind === 'space');
  assert.deepEqual(t.space, {distance: 300, direction: 'selfForward'});
  const out = compileWorkspace(w);
  assert.doesNotMatch(out, /candidate=/);
  assert.match(out, /<Check kind="space" distance="300" direction="selfForward"\/>/);
  assert.equal(choosesOrdinary(w, w.starts[0]), false, 'a card playing pairs keeps the pair rules');
  assert.throws(
    () => importWorkspaceXml(pairs.replace('direction="selfForward"/>', 'direction="selfForward" candidate="Swing"/>')),
    /candidate/
  );
  assert.throws(() => importWorkspaceXml(pairs.replace('direction="selfForward"/>', 'direction="partnerBack"/>')));
});

const ordinary = (start, extra = '') => String.raw`<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="T">
  ${start}
    <Check kind="female" subject="partner"/>${extra}
    <True to="A"/>
    <False to="B"/>
  </Start>
  <Action id="A" clip="Animations\a.hkx"/>
  <Action id="B" clip="Animations\b.hkx"/>
</AnimationSet>`;
test('a start choosing ordinary actions takes the actor ahead, its cone kept when changed', () => {
  let w = importWorkspaceXml(ordinary('<Start id="S" key="G">'));
  const s = w.starts[0];
  assert.equal(choosesOrdinary(w, s), true);
  assert.equal(s.target, 'nearest');
  let out = compileWorkspace(w);
  assert.doesNotMatch(out, /range=|angle=|target=/, 'the default cone writes nothing');
  w = importWorkspaceXml(ordinary('<Start id="S" key="G" range="350" angle="60">'));
  assert.equal(w.starts[0].range, 350);
  out = compileWorkspace(w);
  assert.match(out, /range="350" angle="60"/);
  // A room check needs no pair either.
  w = importWorkspaceXml(
    ordinary('<Start id="S" key="G">', '\n    <Check kind="space" distance="200" direction="selfForward"/>')
  );
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
});
test("a key start choosing ordinary actions may take the combat target; a pair's key start may not", () => {
  const w = importWorkspaceXml(ordinary('<Start id="S" key="G" target="combatTarget">'));
  assert.equal(w.starts[0].target, 'combatTarget');
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
  assert.match(compileWorkspace(w), /target="combatTarget"/);
  const p = importWorkspaceXml(pairs);
  p.starts[0].target = 'combatTarget';
  assert.ok(validateWorkspace(p).some(i => i.level === 'error' && i.node === p.starts[0].uid));
});
