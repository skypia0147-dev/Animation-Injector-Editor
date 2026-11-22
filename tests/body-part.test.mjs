import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {setActionBody, setActionFacing, bodyChipValue, fixedWhole, bodyIssues} from '../src/body.ts';
import {actionView, fixedThird} from '../src/view.ts';
import {switchPlaybackKind} from '../src/actionTypes.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {checker, needsChecker} from './local.mjs';

// Part actions (runtime 1.0.9 <Action body>, docs/mockup-body-part): a charge whose start and hold play on the upper
// body while walking and whose release plays on the whole body, and a crossed-arms loop ended by its key.
const PARTS = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Parts">
  <Start control="rightAttack" press="hold" to="ChargeStart"/>
  <Start key="H" to="CrossArms"/>
  <Action id="ChargeStart" clip="Animations\\Parts\\Start.hkx" body="upper">
    <Transition to="ChargeHold" on="end"/>
  </Action>
  <Action id="ChargeHold" clip="Animations\\Parts\\Hold.hkx" loop="true" body="upper">
    <Transition to="Release" on="release"/>
  </Action>
  <Action id="Release" clip="Animations\\Parts\\Release.hkx"/>
  <Action id="CrossArms" clip="Animations\\Parts\\Cross.hkx" loop="true" body="upper">
    <Transition key="H" end="true"/>
  </Action>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');
const byId = (w, id) => w.actions.find(a => a.config.actionId === id);

test('part actions read in, write back unchanged and are what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(PARTS);
  assert.deepEqual(errors(w), []);
  assert.equal(byId(w, 'ChargeStart').config.body, 'upper');
  assert.equal(byId(w, 'Release').config.body, undefined);
  // A part loop's maxHold when none is written: 3 s with a charge release, else until it is ended (0).
  assert.deepEqual(byId(w, 'ChargeHold').config.loop, {maxHold: 3});
  assert.deepEqual(byId(w, 'CrossArms').config.loop, {maxHold: 0});
  // Third person whatever the file says.
  assert.equal(actionView(w, byId(w, 'ChargeStart')), 'third');
  assert.equal(fixedThird(w, byId(w, 'ChargeStart')), 'part');
  const xml = compileWorkspace(w);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.doesNotMatch(xml, /maxHold=/);
  assert.match(xml, /<Action id="ChargeHold"[^>]*body="upper"/);
  // The canvas: a part loop with no maxHold says it plays until it is ended.
  assert.ok(flatGraph(w).nodes.some(n => n.kind === 'loopRule' && n.summary === ''));
  mkdirSync('tests/generated/body', {recursive: true});
  writeFileSync('tests/generated/body/Parts.xml', xml);
  execFileSync(checker, ['tests/generated/body/Parts.xml']);
  // A maxHold written on the loop without a release stays.
  const held = setActionBody(w, byId(w, 'CrossArms').uid, 'rightArm');
  held.actions.find(a => a.config.actionId === 'CrossArms').config.loop = {maxHold: 4};
  assert.match(
    compileWorkspace(held),
    /<Action id="CrossArms"[^>]*maxHold="4"[^>]*body="rightArm"|body="rightArm"[^>]*maxHold="4"/
  );
});

// The upper body's direction (runtime facing="camera", 11-23): aiming where the camera looks.
const AIM = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Aim">
  <Start key="Num7" to="Aim"/>
  <Action id="Aim" clip="Animations\\bow_idledrawn.hkx" body="upper" facing="camera" loop="true">
    <Transition key="Num7" end="true"/>
  </Action>
</AnimationSet>
`;
test(
  'the upper body faces the camera: read, written back, loaded by the runtime, cleared off the upper body',
  needsChecker,
  () => {
    const w = importWorkspaceXml(AIM);
    assert.deepEqual(errors(w), []);
    const aim = byId(w, 'Aim');
    assert.equal(aim.config.facing, 'camera');
    assert.equal(bodyChipValue(aim), '상체 · 화면');
    const xml = compileWorkspace(w);
    assert.match(xml, /<Action id="Aim"[^>]*body="upper"[^>]*facing="camera"/);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
    mkdirSync('tests/generated/body', {recursive: true});
    writeFileSync('tests/generated/body/Aim.xml', xml);
    execFileSync(checker, ['tests/generated/body/Aim.xml']);
    // facing="legs" is the default: read, not written.
    const legs = importWorkspaceXml(AIM.replace('facing="camera"', 'facing="legs"'));
    assert.equal(byId(legs, 'Aim').config.facing, undefined);
    assert.doesNotMatch(compileWorkspace(legs), /facing=/);
    // Back to the legs, and off the upper body: gone.
    assert.equal(byId(setActionFacing(w, aim.uid, false), 'Aim').config.facing, undefined);
    assert.equal(byId(setActionBody(w, aim.uid, 'rightArm'), 'Aim').config.facing, undefined);
    assert.equal(byId(setActionBody(w, aim.uid, undefined), 'Aim').config.facing, undefined);
    // Only the upper body takes a direction.
    assert.throws(() => setActionFacing(setActionBody(w, aim.uid, 'leftArm'), aim.uid, true), /상체/);
    assert.throws(() => importWorkspaceXml(AIM.replace('body="upper" ', 'body="rightArm" ')), /facing/);
    assert.throws(() => importWorkspaceXml(AIM.replace('body="upper" ', '')), /facing/);
    assert.throws(() => importWorkspaceXml(AIM.replace('facing="camera"', 'facing="screen"')), /facing/);
  }
);

test('picking a part drops what a part action does not take; a pair, putdown or creature stays whole', () => {
  let w = importWorkspaceXml(
    PARTS.replace(
      '<Action id="Release" clip="Animations\\Parts\\Release.hkx"/>',
      '<Action id="Release" clip="Animations\\Parts\\Release.hkx" view="first" otherView="switch" air="both" attack="Heavy"/>'
    )
  );
  const release = byId(w, 'Release');
  w = setActionBody(w, release.uid, 'leftArm');
  const part = byId(w, 'Release');
  assert.equal(part.config.body, 'leftArm');
  assert.equal(part.view, undefined);
  assert.equal(part.otherView, undefined);
  assert.equal(part.config.air, 'deny');
  assert.equal(part.config.attack, '');
  // Back to the whole body; a loop's 0 becomes the whole body's default.
  w = setActionBody(w, byId(w, 'CrossArms').uid, undefined);
  assert.deepEqual(byId(w, 'CrossArms').config.loop, {maxHold: 3});
  // A pair: the kind switch drops the part first.
  const paired = switchPlaybackKind(w, byId(w, 'ChargeStart').uid, 'pair');
  assert.equal(byId(paired, 'ChargeStart').config.body, undefined);
  assert.equal(fixedWhole(paired, byId(paired, 'ChargeStart')), 'pair');
  assert.throws(() => setActionBody(paired, byId(paired, 'ChargeStart').uid, 'upper'), /전신/);
});

test('a part card offers no movement transition, state features, block, camera restore or QTE', () => {
  const w = importWorkspaceXml(PARTS);
  const graph = flatGraph(w);
  const card = id => graph.nodes.find(n => n.kind === 'hkxPlay' && n.action === byId(w, id).uid).id;
  const kinds = id => contextualAdds(w, card(id), graph).map(o => o.kind);
  const part = kinds('ChargeHold'),
    whole = kinds('Release');
  for (const hidden of [
    'transitionMove',
    'suppress',
    'cameraRestore',
    'qte',
    'notify:rotate',
    'notify:iframe',
    'notify:armor',
    'notify:time',
    'notify:cost',
    'notify:recovery',
  ])
    assert.ok(!part.includes(hidden), hidden);
  assert.ok(part.includes('transitionRelease') || part.includes('keyInput'));
  assert.ok(whole.includes('notify:rotate') && whole.includes('suppress'));
});

test('what the runtime refuses on a part action is the card’s problem', () => {
  let w = importWorkspaceXml(PARTS);
  const hold = byId(w, 'ChargeHold');
  hold.config.slots.rotate.enabled = true;
  hold.config.loop = {maxHold: 0};
  const issues = bodyIssues(w).map(i => i.message);
  assert.ok(issues.some(m => m.includes('부위 동작에는 쓸 수 없습니다')));
  assert.ok(issues.some(m => m.includes('최대 유지 시간을 정하세요')));
  w = importWorkspaceXml(PARTS);
  w.links.find(l => l.from === byId(w, 'ChargeStart').uid).blend = 0.2;
  assert.ok(bodyIssues(w).some(i => i.message.includes('블렌드')));
});
