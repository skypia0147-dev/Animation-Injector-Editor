import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {qteErrors} from '../src/qte.ts';
import {copyQteRules} from '../src/graph/qteGroups.ts';
import {checker, needsChecker} from './local.mjs';

// UI rework stage 4: what the runtime reads that the editor could not write (docs/시험-UI재작성 G6·G7·G11·G15).
const out = 'tests/generated/stage4';
mkdirSync(out, {recursive: true});
// The runtime reads the editor's file and finds it the same as the source.
const sameForRuntime = (name, source, w) => {
  writeFileSync(`${out}/${name}-source.xml`, source);
  writeFileSync(`${out}/${name}-editor.xml`, compileWorkspace(w));
  execFileSync(checker, ['--compare-starts', `${out}/${name}-source.xml`, `${out}/${name}-editor.xml`], {
    stdio: 'pipe',
  });
};
const roundtrip = w => parseWorkspace(JSON.stringify(captureGraph(w)));
const errors = w => validateWorkspace(w).filter(i => i.level === 'error');

const CANCELS = `<AnimationSet version="6" id="Cancels">
  <Inputs>
    <Input id="use" key="E"/>
  </Inputs>
  <Start input="use" to="Dodge"/>
  <Action id="Dodge" clip="Animations\\Test\\Dodge.hkx">
    <Vanilla id="dodgeOut" to="Attack"/>
    <Vanilla id="late" to="Block" from="0.2" until="end-0.1" buffer="false"/>
  </Action>
</AnimationSet>`;

test('a vanilla cancel keeps its own XML id and an always-open window (G6, G11)', needsChecker, () => {
  let w = importWorkspaceXml(CANCELS);
  const [always, timed] = w.actions[0].cancels;
  assert.equal(always.always, true);
  assert.equal(timed.always, undefined);
  sameForRuntime('cancels', CANCELS, w);
  w = roundtrip(w);
  // Open for the whole clip: no from, until or buffer (format 6).
  assert.match(compileWorkspace(w), /<Vanilla id="dodgeOut" to="Attack"\/>/);
  // The XML id is set apart from the editor's key: the key stays, the file takes the given id.
  w.actions[0].cancels[1].xmlId = 'blockOut';
  assert.match(compileWorkspace(w), /<Vanilla id="blockOut" to="Block" /);
  assert.equal(w.actions[0].cancels[1].id, 'late');
  assert.equal(roundtrip(w).actions[0].cancels[1].xmlId, 'blockOut');
  // Two windows may not share an id (the runtime's window ids, case-insensitive), nor take an invalid one.
  w.actions[0].cancels[1].xmlId = 'DodgeOut';
  assert.ok(errors(w).some(e => /캔슬 창의 대상·ID/.test(e.message)));
  w.actions[0].cancels[1].xmlId = '1bad';
  assert.ok(errors(w).some(e => /캔슬 창의 대상·ID/.test(e.message)));
});

test('an unnamed vanilla cancel is cancelN', needsChecker, () => {
  // The runtime names an unnamed cancel by its position; the editor keeps that name and does not write it.
  const unnamed = CANCELS.replace('<Vanilla id="dodgeOut" ', '<Vanilla ');
  const w = importWorkspaceXml(unnamed);
  assert.equal(w.actions[0].cancels[0].id, 'cancel1');
  assert.match(compileWorkspace(w), /<Vanilla to="Attack"\/>/);
  sameForRuntime('unnamed-cancel', unnamed, w);
});

const QTES = `<AnimationSet version="6" id="Qtes">
  <Inputs>
    <Input id="use" key="E"/>
  </Inputs>
  <Start input="use" to="A"/>
  <Action id="A" clip="Animations\\Test\\A.hkx">
    <QTE id="Q1" at="0.5" key="E" anchor="screen"/>
  </Action>
  <Start event="GoB" to="B"/>
  <Action id="B" clip="Animations\\Test\\B.hkx">
    <QTE id="Q1" at="0.4" key="E" anchor="center"/>
  </Action>
</AnimationSet>`;

test(
  'QTE ids may repeat between actions and are kept as written; a repeat within an action is refused (G7)',
  needsChecker,
  () => {
    let w = importWorkspaceXml(QTES);
    // The second Q1 takes another editor key and keeps Q1 for the file.
    const [first, second] = w.qtes;
    assert.equal(first.id, 'Q1');
    assert.notEqual(second.id, 'Q1');
    assert.equal(second.xmlId, 'Q1');
    assert.deepEqual(qteErrors(w), []);
    sameForRuntime('qtes', QTES, w);
    assert.equal([...compileWorkspace(roundtrip(w)).matchAll(/<QTE id="Q1"/g)].length, 2);
    // A copied rule is a new one: its own automatic id.
    const [copy] = copyQteRules(w, [second], undefined, second.owner);
    assert.equal(copy.xmlId, undefined);
    assert.deepEqual(qteErrors(w), []);
    copy.xmlId = 'q1';
    assert.ok(qteErrors(w).some(e => /같은 동작에 같은 QTE ID/.test(e)));
    copy.xmlId = 'not valid';
    assert.ok(qteErrors(w).some(e => /QTE ID는/.test(e)));
  }
);

const CAMERA = `<AnimationSet version="6" id="Camera">
  <Inputs>
    <Input id="use" key="E"/>
  </Inputs>
  <EventRegistry>
    <Event name="ResetA"/>
    <Event name="ResetB"/>
  </EventRegistry>
  <Start input="use" to="P1"/>
  <Pair id="P1" clip="Animations\\Test\\P1.hkx">
    <Camera reset="ResetA" restore="event" timeout="10"/>
  </Pair>
  <Start event="GoP2" to="P2"/>
  <Pair id="P2" clip="Animations\\Test\\P2.hkx">
    <Camera reset="ResetA" restore="event" timeout="10"/>
  </Pair>
</AnimationSet>`;

test('one pair restores the camera on its own event while the others keep the project one (G15)', needsChecker, () => {
  let w = importWorkspaceXml(CAMERA);
  // An imported file keeps each pair's event; the project event is set in the project settings.
  assert.equal(w.globals.cameraReset, null);
  w.globals.cameraReset = 'ResetA';
  // The camera restore is the action's (10-16).
  const p2 = w.actions.find(a => a.config.actionId === 'P2');
  p2.camera = {...p2.camera, own: true, reset: 'ResetB'};
  w = roundtrip(w);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Pair id="P1"[\s\S]*?reset="ResetA"[\s\S]*?<\/Pair>/);
  assert.match(xml, /<Pair id="P2"[\s\S]*?reset="ResetB"[\s\S]*?<\/Pair>/);
  // The project event still reaches every pair that is not on its own.
  w.globals.cameraReset = 'ResetC';
  const changed = compileWorkspace(w);
  assert.match(changed, /<Pair id="P1"[\s\S]*?reset="ResetC"/);
  assert.match(changed, /<Pair id="P2"[\s\S]*?reset="ResetB"/);
  const expected = CAMERA.replace(/(<Pair id="P2"[\s\S]*?)reset="ResetA"/, '$1reset="ResetB"');
  sameForRuntime('camera', expected, roundtrip(importWorkspaceXml(expected)));
});
