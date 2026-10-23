import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, removeAction, validateWorkspace} from '../src/workspace.ts';
import {flatGraph, deleteFlat, connectFlat} from '../src/graph/flat.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {disconnectEdge} from '../src/graph/disconnect.ts';
import {deleteSharedInput, inputReferences} from '../src/sharedSettings.ts';
import {
  validBoneName,
  carryHoldPreset,
  defaultCarryHold,
  defaultCarryFix,
  setPutdown,
  chooseCarryInput,
  NEW_CARRY_INPUT,
} from '../src/carry.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {t} from '../src/i18n/index.ts';
import {blendNodes, editBlend, animId} from '../src/graph/blends.ts';
import {timelineRows, patch, remove} from '../src/timeline/model.ts';
import {checker, needsChecker} from './local.mjs';

// The carrier alone puts the target down: a one-actor Action whose CarryRelease drops it (0.12.187).
export const carryXml = (
  bone = 'NPC R Hand [RHnd]',
  release = '<CarryRelease at="0.8"/>'
) => `<AnimationSet version="4" id="CarryDemo">
<Inputs><Input id="use" key="G"/><Input id="drop" key="H" gamepad="A"/></Inputs>
<Pair id="Lift" clip="Animations/Carry/Lift.hkx"><Start input="use"/><Target rig="chicken" range="250" angle="160"/>
<Carry bone="${bone}" targetRoot="NPC Root [Root]" putdown="Lower" input="drop"/>
<Exit at="end-0.05" blend="0.2"/></Pair>
<Action id="Lower" clip="Animations/Carry/Lower.hkx">${release}<Exit at="end-0.05" blend="0.2"/></Action>
</AnimationSet>`;
test('carry XML/project roundtrip preserves custom bones, putdown/input identity and unlimited duration', () => {
  const w = importWorkspaceXml(carryXml('My &amp; Custom [Anchor]'));
  const c = w.actions[0].pair.carry;
  assert.equal(c.bone, 'My & Custom [Anchor]');
  assert.equal(c.putdownAction, w.actions[1].uid);
  const saved = parseWorkspace(JSON.stringify(w));
  assert.deepEqual(saved.actions[0].pair.carry, c);
  saved.actions[1].config.actionId = 'RenamedLower';
  const xml = compileWorkspace(saved);
  assert.match(xml, /putdown="RenamedLower"/);
  assert.doesNotMatch(xml, /release="/);
  const restored = importWorkspaceXml(xml),
    rc = restored.actions[0].pair.carry;
  assert.equal(rc.bone, c.bone);
  assert.equal(rc.timeout, undefined);
  assert.doesNotMatch(xml, /<Carry[^>]*timeout=/);
  assert.equal(restored.actions[0].config.inputs.find(i => i.id === rc.input).key, 'H');
  assert.equal(restored.actions[0].config.inputs.find(i => i.id === rc.input).gamepad, 4096);
});
test('event start with release-only input exports its input definition', () => {
  const w = importWorkspaceXml(
    carryXml().replace('<Start input="use"/>', '<Start event="LiftRequest" actor="player"/>')
  );
  const restored = importWorkspaceXml(compileWorkspace(w));
  assert.equal(restored.actions[0].config.start.event, 'LiftRequest');
  const c = restored.actions[0].pair.carry;
  assert.equal(restored.actions[0].config.inputs.find(i => i.id === c.input).key, 'H');
});
test('carry is visible as a separate connected node; node removal removes only carry', () => {
  const w = importWorkspaceXml(carryXml()),
    g = flatGraph(w),
    node = g.nodes.find(n => n.kind === 'carry');
  assert.ok(node);
  assert.ok(g.edges.some(e => e.target === node.id));
  assert.ok(g.edges.some(e => e.source === node.id));
  const removed = deleteFlat(w, node.id);
  assert.equal(removed.actions.length, 2);
  assert.equal(removed.actions[0].pair.carry, undefined);
  // The putdown's release moment stays with its Action; without a carry it is reported, not dropped.
  assert.throws(() => compileWorkspace(removed), /대상 놓기/);
  delete removed.actions[1].config.carryRelease;
  assert.doesNotMatch(compileWorkspace(removed), /<Carry /);
});
test('context add creates a carry attached to pair; the putdown Action can be connected on canvas', () => {
  let w = importWorkspaceXml(carryXml(undefined, '').replace(/<Carry [^>]*\/>\n/, ''));
  const hkx = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === w.actions[0].uid);
  const option = contextualAdds(w, hkx.id).find(o => o.kind === 'carry');
  assert.ok(option);
  const added = addConnected(w, hkx.id, option, {x: 500, y: 500});
  w = added.workspace;
  assert.equal(w.actions[0].pair.carry.bone, 'NPC R Clavicle [RClv]');
  assert.ok(!contextualAdds(w, hkx.id).some(o => o.kind === 'carry'));
  const lower = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === w.actions[1].uid);
  w = connectFlat(w, added.id, lower.id);
  assert.equal(w.actions[0].pair.carry.putdownAction, w.actions[1].uid);
  assert.equal(w.actions[0].pair.carry.alignStart, undefined);
  // Connecting gives an Action without a release moment the default one (no HKX length here: 1 s).
  assert.equal(w.actions[1].config.carryRelease.at.seconds, 1);
  assert.match(compileWorkspace(w), /<CarryRelease at="1"\/>/);
  for (const a of w.actions) a.enterBlendEnabled = true;
  assert.doesNotThrow(() => compileWorkspace(w));
  // A pair (here the lift itself) is not a putdown.
  assert.throws(() => connectFlat(w, added.id, hkx.id), /한 사람 일반 동작/);
});

test('carry start alignment survives action renaming, blend-node edits and project/XML roundtrips', () => {
  let w = importWorkspaceXml(carryXml().replaceAll('<Exit ', '<Enter blend="0.4"/><Exit '));
  assert.equal(w.actions[0].pair.carry.alignStart, undefined);
  w.actions[0].config.actionId = 'PickupOnHand';
  w.actions[1].config.actionId = 'PutDownOnGround';
  w.blends = blendNodes(w);
  w = editBlend(w, animId(w.actions[0].uid, 'blendIn'), {seconds: 0.65});
  w = editBlend(w, animId(w.actions[1].uid, 'blendIn'), {seconds: 0.25});
  const xml = compileWorkspace(parseWorkspace(JSON.stringify(w))),
    imported = importWorkspaceXml(xml);
  assert.doesNotMatch(xml, /alignStart=/);
  assert.match(xml, /putdown="PutDownOnGround"/);
  assert.equal(imported.actions[0].config.enterBlend, 0.65);
  assert.equal(imported.actions[1].config.enterBlend, 0.25);
  for (const index of [0, 1]) {
    const removed = deleteFlat(w, animId(w.actions[index].uid, 'blendIn'));
    assert.doesNotThrow(() => compileWorkspace(removed));
  }
  for (const a of w.actions) w = editBlend(w, animId(a.uid, 'blendIn'), {seconds: 0});
  assert.doesNotThrow(() => importWorkspaceXml(compileWorkspace(w)));
});

test('carry alignment is automatic; the obsolete switch is dropped from projects and refused in XML (format 4)', () => {
  const w = importWorkspaceXml(carryXml());
  assert.equal(w.actions[0].pair.carry.alignStart, undefined);
  w.actions[0].pair.carry.alignStart = false;
  assert.equal(parseWorkspace(JSON.stringify(w)).actions[0].pair.carry.alignStart, undefined);
  assert.doesNotMatch(compileWorkspace(w), /alignStart=/);
  for (const value of ['true', 'false', 'yes', ''])
    assert.throws(
      () => importWorkspaceXml(carryXml().replace('<Carry ', `<Carry alignStart="${value}" `)),
      /alignStart/
    );
});
test(
  'bad bones, missing input, a pair or startable putdown, a missing or stray release moment are rejected',
  needsChecker,
  () => {
    mkdirSync('tests/generated/carry', {recursive: true});
    for (const invalid of [
      carryXml(''),
      carryXml(' leading'),
      carryXml().replace('input="drop"', 'input="missing"'),
      carryXml().replace('putdown="Lower"', 'putdown="Lift"'),
      carryXml().replace('putdown="Lower"', 'release="Lower"'),
      carryXml().replace('<Carry ', '<Carry timeout="120" '),
      carryXml(undefined, ''),
      carryXml(undefined, '<Start input="use"/><CarryRelease at="0.8"/>'),
      carryXml().replace(
        '<Exit at="end-0.05" blend="0.2"/></Pair>',
        '<CarryRelease at="0.8"/><Exit at="end-0.05" blend="0.2"/></Pair>'
      ),
      carryXml().replace(
        '</AnimationSet>',
        '<Action id="Other" clip="Animations/Carry/Other.hkx"><CarryRelease at="0.5"/></Action></AnimationSet>'
      ),
    ]) {
      assert.throws(() => compileWorkspace(importWorkspaceXml(invalid)));
      // The runtime parser rejects the same declarations.
      writeFileSync('tests/generated/carry/reject.xml', invalid);
      assert.throws(() => execFileSync(checker, ['tests/generated/carry/reject.xml'], {stdio: 'pipe'}));
    }
    for (const field of ['flow', 'start', 'release']) {
      const w = importWorkspaceXml(carryXml());
      if (field === 'flow') w.actions[1].flow = {entry: '', tests: []};
      if (field === 'start') {
        w.actions[1].config.start.mode = 'input';
        w.actions[1].config.start.input = 'use';
      }
      if (field === 'release') delete w.actions[1].config.carryRelease;
      assert.throws(() => compileWorkspace(w), /내려놓기/);
    }
    for (const value of ['', ' a', 'a ', 'a\n', 'a\x7f', '가'.repeat(86), null])
      assert.equal(validBoneName(value), false);
    assert.equal(validBoneName('가'.repeat(85)), true);
  }
);
test('deleting referenced putdown/input cannot silently break carry', () => {
  const w = importWorkspaceXml(carryXml());
  assert.throws(() => removeAction(w, w.actions[1].uid));
  assert.ok(inputReferences(w, w.actions[0].uid, 'drop').includes('운반 내려놓기'));
  w.sharedInputs = structuredClone(w.actions[0].config.inputs);
  assert.throws(() => deleteSharedInput(w, 'drop'));
});
test('individual connection removal suppresses carry or diagnoses a missing putdown', () => {
  const w = importWorkspaceXml(carryXml()),
    g = flatGraph(w),
    node = g.nodes.find(n => n.kind === 'carry');
  const incoming = g.edges.find(e => e.target === node.id),
    outgoing = g.edges.find(e => e.source === node.id);
  assert.throws(() => compileWorkspace(disconnectEdge(w, incoming)), /대상 놓기/);
  assert.throws(() => compileWorkspace(disconnectEdge(w, outgoing)), /내려놓기/);
});
test('the putdown release moment: XML, project, timeline and the runtime parser', needsChecker, () => {
  // An event moment waits for its event only (runtime 0.12.278): an older file's fallback is refused.
  assert.throws(
    () => importWorkspaceXml(carryXml(undefined, '<CarryRelease at="event:PutDownRelease" fallback="0.9"/>')),
    /0\.12\.278/
  );
  const source = carryXml(undefined, '<CarryRelease at="event:PutDownRelease"/>');
  let w = importWorkspaceXml(source);
  const lower = w.actions[1];
  assert.equal(lower.config.carryRelease.at.basis, 'event');
  assert.equal(lower.config.carryRelease.at.event, 'PutDownRelease');
  assert.equal(lower.config.carryRelease.at.fallback, false);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).actions[1].config.carryRelease, lower.config.carryRelease);
  const xml = compileWorkspace(w);
  assert.match(xml, /<CarryRelease at="event:PutDownRelease"\/>/);
  mkdirSync('tests/generated/carry', {recursive: true});
  writeFileSync('tests/generated/carry/putdown-source.xml', source);
  writeFileSync('tests/generated/carry/putdown-editor.xml', xml);
  execFileSync(checker, [
    '--compare',
    'tests/generated/carry/putdown-source.xml',
    'tests/generated/carry/putdown-editor.xml',
  ]);
  // The putdown card's timeline shows it; dragging and deleting edit the same data.
  const row = timelineRows(w, lower).find(r => r.id === 'runtime:carryRelease');
  assert.equal(row.from.event, 'PutDownRelease');
  w = patch(w, lower.uid, 'runtime:carryRelease', {
    from: {...row.from, basis: 'seconds', event: '', fallback: false, seconds: 0.7},
  });
  assert.match(compileWorkspace(w), /<CarryRelease at="0.7"\/>/);
  w = remove(w, lower.uid, 'runtime:carryRelease');
  assert.equal(w.actions[1].config.carryRelease, undefined);
  assert.throws(() => compileWorkspace(w), /대상 놓기 시점/);
});
test('choosing a putdown adds its release moment 0.3 s before the clip end, never over an existing one', () => {
  const w = importWorkspaceXml(carryXml(undefined, '<CarryRelease at="0.4"/>'));
  const lift = w.actions[0].uid,
    lower = w.actions[1].uid;
  assert.equal(setPutdown(w, lift, lower, 3).actions[1].config.carryRelease.at.seconds, 0.4);
  delete w.actions[1].config.carryRelease;
  assert.equal(setPutdown(w, lift, lower, 1.5).actions[1].config.carryRelease.at.seconds, 1.2);
  assert.equal(setPutdown(w, lift, lower).actions[1].config.carryRelease.at.seconds, 1);
  assert.equal(setPutdown(w, lift, lower, 0.2).actions[1].config.carryRelease.at.seconds, 1);
  assert.equal(setPutdown(w, lift, lower, 1.5).actions[0].pair.carry.putdownAction, lower);
});
test('projects with the old putdown pair open with the putdown to choose again', () => {
  const json = JSON.parse(JSON.stringify(importWorkspaceXml(carryXml())));
  const carry = json.actions[0].pair.carry;
  carry.releaseAction = carry.putdownAction;
  delete carry.putdownAction;
  const w = parseWorkspace(JSON.stringify(json));
  assert.equal(w.actions[0].pair.carry.putdownAction, '');
  assert.equal('releaseAction' in w.actions[0].pair.carry, false);
  assert.ok(validateWorkspace(w).some(i => i.level === 'error' && /내려놓기 동작을 고르세요/.test(i.message)));
});

// Carry stages 2-3: target handling (pose/physics), the fixed body and the carrier hold pose.
const heldXml = (carry = 'target="physics" part="Neck2"', hold = '<Bone name="NPC R Clavicle [RClv]" weight="1"/>') =>
  carryXml().replace('input="drop"/>', `input="drop" ${carry}><Hold blendOut="0.3">${hold}</Hold></Carry>`);
test('carry target, fixed body and hold pose survive XML, project and the runtime parser', needsChecker, () => {
  const w = importWorkspaceXml(heldXml()),
    c = w.actions[0].pair.carry;
  assert.equal(c.target, 'physics');
  assert.equal(c.part, 'Neck2');
  assert.deepEqual(c.hold, {
    pose: 'lift-end',
    blendIn: 0.2,
    blendOut: 0.3,
    bones: [{name: 'NPC R Clavicle [RClv]', weight: 1}],
  });
  assert.equal(carryHoldPreset(c.hold), 'right');
  const saved = parseWorkspace(JSON.stringify(w));
  assert.deepEqual(saved.actions[0].pair.carry, c);
  const xml = compileWorkspace(saved);
  assert.match(xml, /<Carry [^>]*target="physics" part="Neck2">/);
  // Input ids are renamed on export (a1_i2); the key itself is checked by the first carry test.
  assert.deepEqual({...importWorkspaceXml(xml).actions[0].pair.carry, input: c.input}, c);
  mkdirSync('tests/generated/carry', {recursive: true});
  writeFileSync('tests/generated/carry/source.xml', heldXml());
  writeFileSync('tests/generated/carry/editor.xml', xml);
  execFileSync(checker, ['--compare', 'tests/generated/carry/source.xml', 'tests/generated/carry/editor.xml']);
  // Pose handling writes neither target nor part; no Hold writes no Hold.
  w.actions[0].pair.carry = {...c, target: 'pose', part: '', hold: null};
  assert.doesNotMatch(compileWorkspace(w), /target="|part="|<Hold/);
});
test('projects saved before carry stages 2-3 open as pose handling without a hold', () => {
  const w = importWorkspaceXml(carryXml()),
    json = JSON.parse(JSON.stringify(w));
  for (const key of ['target', 'part', 'hold']) delete json.actions[0].pair.carry[key];
  const c = parseWorkspace(JSON.stringify(json)).actions[0].pair.carry;
  assert.equal(c.target, 'pose');
  assert.equal(c.part, '');
  assert.equal(c.hold, null);
  json.actions[0].pair.carry.hold = {...defaultCarryHold(), extra: 1};
  assert.throws(() => parseWorkspace(JSON.stringify(json)), /운반 자세/);
});
test('invalid carry target, fixed body and hold are rejected like the runtime', () => {
  for (const invalid of [
    heldXml('target="ragdoll"'),
    heldXml('part="Neck2"'),
    heldXml('target="physics" part=""'),
    // The hold pose is the lift's last frame: format 4 has no pose attribute (any value is refused).
    heldXml().replace('<Hold ', '<Hold pose="lift-end" '),
    heldXml().replace('<Hold ', '<Hold pose="Animations/Carry/Hold.hkx" '),
    heldXml().replace('<Hold ', '<Hold time="0.5" '),
    heldXml().replace('<Hold ', '<Hold blend="0.2" '),
    heldXml(undefined, '<Bone name="NPC R Clavicle [RClv]" weight="2"/>'),
    heldXml(undefined, '<Bone name="NPC R Clavicle [RClv]" weight="0"/>'),
    heldXml(undefined, '<Bone name="NPC R Clavicle [RClv]"/><Bone name="npc r clavicle [rclv]"/>'),
    heldXml(undefined, '<Bone name=" NPC"/>'),
  ])
    assert.throws(() => compileWorkspace(importWorkspaceXml(invalid)));
  // Omitted weights default to 1.
  const w = importWorkspaceXml(heldXml(undefined, '<Bone name="NPC L Clavicle [LClv]"/>'));
  assert.deepEqual(w.actions[0].pair.carry.hold.bones, [{name: 'NPC L Clavicle [LClv]', weight: 1}]);
  // Defaults are not written (format 4): blendIn 0.2, a bone's weight 1.
  assert.match(compileWorkspace(w), /<Hold blendOut="0.3">\s*<Bone name="NPC L Clavicle \[LClv\]"\/>/);
  // A project saved with the retired `time` opens without it.
  const json = JSON.parse(JSON.stringify(w));
  json.actions[0].pair.carry.hold.time = 0;
  assert.equal('time' in parseWorkspace(JSON.stringify(json)).actions[0].pair.carry.hold, false);
});
test('the release moment is an event item on the putdown card: add, show and disconnect', () => {
  let w = importWorkspaceXml(carryXml());
  const lower = w.actions[1].uid,
    node = flatGraph(w).nodes.find(n => n.kind === 'carryRelease' && n.action === lower);
  assert.ok(node);
  assert.equal(node.summary, '0.8초');
  // Cutting its wire drops it at compile time, which then asks for a release moment again.
  const edge = flatGraph(w).edges.find(e => e.target === node.id);
  assert.throws(() => compileWorkspace(disconnectEdge(w, edge)), /대상 놓기 시점/);
  w = remove(w, lower, 'runtime:carryRelease');
  // Only a carry's putdown Action offers it again (the lift pair never does).
  const clip = id => flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === id);
  assert.ok(!contextualAdds(w, clip(w.actions[0].uid).id).some(o => o.kind === 'carryRelease'));
  const option = contextualAdds(w, clip(lower).id).find(o => o.kind === 'carryRelease');
  assert.equal(option.label, '대상 놓기 추가');
  w = addConnected(w, clip(lower).id, option, {x: 600, y: 600}).workspace;
  assert.equal(w.actions[1].config.carryRelease.at.seconds, 1);
  assert.ok(!contextualAdds(w, clip(lower).id).some(o => o.kind === 'carryRelease'));
  assert.doesNotThrow(() => compileWorkspace(w));
});

// The fix moment (runtime 0.12.190): <Fix at="seconds"/> inside Carry, an event item of the lift pair's card.
const fixedXml = (fix = '<Fix at="1.7"/>') => heldXml().replace('<Hold ', `${fix}<Hold `);
test('carry fix moment: XML, project, timeline and the runtime parser', needsChecker, () => {
  let w = importWorkspaceXml(fixedXml());
  const lift = w.actions[0],
    c = lift.pair.carry;
  assert.deepEqual(c.fix, {at: {basis: 'seconds', seconds: 1.7, event: '', fallback: false, fallbackBasis: 'seconds'}});
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).actions[0].pair.carry.fix, c.fix);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Carry [^>]*>\s*<Fix at="1.7"\/>\s*<Hold /);
  mkdirSync('tests/generated/carry', {recursive: true});
  writeFileSync('tests/generated/carry/fix-source.xml', fixedXml());
  writeFileSync('tests/generated/carry/fix-editor.xml', xml);
  execFileSync(checker, ['--compare', 'tests/generated/carry/fix-source.xml', 'tests/generated/carry/fix-editor.xml']);
  // The compare summary includes the fix moment: a different one is reported.
  writeFileSync('tests/generated/carry/fix-other.xml', fixedXml('<Fix at="2.5"/>'));
  assert.throws(() =>
    execFileSync(
      checker,
      ['--compare', 'tests/generated/carry/fix-source.xml', 'tests/generated/carry/fix-other.xml'],
      {
        stdio: 'pipe',
      }
    )
  );
  // The lift pair's timeline shows it; dragging keeps plain seconds, deleting removes it.
  const row = timelineRows(w, lift).find(r => r.id === 'runtime:carryFix');
  assert.equal(row.from.seconds, 1.7);
  w = patch(w, lift.uid, 'runtime:carryFix', {from: {...row.from, seconds: 2.5}});
  assert.match(compileWorkspace(w), /<Fix at="2.5"\/>/);
  w = patch(w, lift.uid, 'runtime:carryFix', {from: {...row.from, basis: 'event', event: 'Grab'}});
  assert.equal(w.actions[0].pair.carry.fix.at.basis, 'seconds');
  w = remove(w, lift.uid, 'runtime:carryFix');
  assert.equal(w.actions[0].pair.carry.fix, null);
  assert.doesNotMatch(compileWorkspace(w), /<Fix /);
});
test('an invalid fix moment is rejected like the runtime', needsChecker, () => {
  mkdirSync('tests/generated/carry', {recursive: true});
  for (const fix of [
    '<Fix at="event:Grab"/>',
    '<Fix at="-1"/>',
    '<Fix/>',
    '<Fix at="601"/>',
    '<Fix at="1" fallback="2"/>',
    '<Fix at="1"/><Fix at="2"/>',
  ]) {
    assert.throws(() => importWorkspaceXml(fixedXml(fix)), undefined, fix);
    writeFileSync('tests/generated/carry/reject-fix.xml', fixedXml(fix));
    assert.throws(
      () => execFileSync(checker, ['tests/generated/carry/reject-fix.xml'], {stdio: 'pipe'}),
      undefined,
      fix
    );
  }
  const w = importWorkspaceXml(fixedXml());
  w.actions[0].pair.carry.fix.at = {...w.actions[0].pair.carry.fix.at, basis: 'event', event: 'Grab'};
  assert.throws(() => compileWorkspace(w), /대상 고정 시점/);
});
test('every carry has the fix item on its lift card: the lift end by default, a moment from details', () => {
  let w = importWorkspaceXml(heldXml());
  const lift = w.actions[0].uid,
    clip = id => flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === id),
    fixNode = () => flatGraph(w).nodes.find(n => n.kind === 'carryFix' && n.action === lift);
  // The carry brings it (no <Fix> = the lift's end), so neither card offers to add one.
  for (const a of w.actions) assert.ok(!contextualAdds(w, clip(a.uid).id).some(o => o.kind === 'carryFix'));
  assert.equal(w.actions[0].pair.carry.fix, null);
  assert.equal(fixNode().summary, t('carryFix.liftEnd'));
  const item = checklistModel(w)
    .items.get(clip(lift).id)
    .find(i => i.node.kind === 'carryFix');
  assert.equal(item.category, 'event');
  assert.equal(item.toggleable, false);
  assert.doesNotMatch(compileWorkspace(w), /<Fix /);
  // A moment moves the fix into the lift.
  w.actions[0].pair.carry.fix = defaultCarryFix();
  assert.equal(fixNode().summary, '1초');
  assert.match(compileWorkspace(w), /<Fix at="1"\/>/);
  // Cutting its wire or deleting it goes back to the lift's end; the item and the carry stay.
  const node = fixNode(),
    edge = flatGraph(w).edges.find(e => e.target === node.id);
  assert.doesNotMatch(compileWorkspace(disconnectEdge(w, edge)), /<Fix /);
  const removed = deleteFlat(w, node.id);
  assert.equal(removed.actions[0].pair.carry.fix, null);
  assert.equal(removed.actions[0].pair.carry.target, 'physics');
  assert.ok(flatGraph(removed).nodes.some(n => n.kind === 'carryFix' && n.action === lift));
  // A pair without a carry has none.
  const bare = importWorkspaceXml(carryXml(undefined, '').replace(/<Carry [^>]*\/>\n/, ''));
  assert.ok(!flatGraph(bare).nodes.some(n => n.kind === 'carryFix'));
});
test('projects saved before the fix moment open without one; a malformed one is rejected', () => {
  const json = JSON.parse(JSON.stringify(importWorkspaceXml(fixedXml())));
  const c = json.actions[0].pair.carry;
  delete c.fix;
  assert.equal(parseWorkspace(JSON.stringify(json)).actions[0].pair.carry.fix, null);
  c.fix = {at: {basis: 'seconds', seconds: 1, event: '', fallback: false, fallbackBasis: 'seconds'}, extra: 1};
  assert.throws(() => parseWorkspace(JSON.stringify(json)), /운반 고정/);
});

// The carry weapon setting: sheathed (default) or sheathe. weapon="keep" and weaponShow went in runtime 0.12.238.
const keepXml = (attrs = 'weapon="sheathe"') => heldXml(`target="physics" part="Neck2" ${attrs}`);
test('removed carry weapon settings are refused by the editor and the runtime alike', needsChecker, () => {
  mkdirSync('tests/generated/carry', {recursive: true});
  for (const attrs of [
    'weapon="keep"',
    'weapon="keep" weaponShow="Grapple_equip"',
    'weapon="sheathe" weaponShow="Grapple_equip"',
    'weaponShow="Grapple_equip"',
  ]) {
    assert.throws(() => importWorkspaceXml(keepXml(attrs)), /0\.12\.238/, attrs);
    writeFileSync('tests/generated/carry/reject-weapon.xml', keepXml(attrs));
    const r = spawnSync(checker, ['--json', 'tests/generated/carry/reject-weapon.xml'], {encoding: 'utf8'});
    assert.match(r.stdout, /"valid":false.*0\.12\.238/, attrs);
  }
  assert.throws(() => importWorkspaceXml(keepXml('weapon="drawn"')), undefined, 'drawn');
});
// Drawn at the lift, put away when it starts (runtime 0.12.195): <Carry weapon="sheathe">.
test('carry weapon sheathe: XML, project and the runtime parser', needsChecker, () => {
  const w = importWorkspaceXml(keepXml('weapon="sheathe"'));
  const c = w.actions[0].pair.carry;
  assert.equal(c.weapon, 'sheathe');
  assert.equal('weaponShow' in c, false);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).actions[0].pair.carry, c);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Carry [^>]*weapon="sheathe"/);
  mkdirSync('tests/generated/carry', {recursive: true});
  writeFileSync('tests/generated/carry/sheathe-source.xml', keepXml('weapon="sheathe"'));
  writeFileSync('tests/generated/carry/sheathe-editor.xml', xml);
  execFileSync(checker, [
    '--compare',
    'tests/generated/carry/sheathe-source.xml',
    'tests/generated/carry/sheathe-editor.xml',
  ]);
  w.actions[0].pair.carry.weapon = 'sheathed';
  assert.doesNotMatch(compileWorkspace(w), /<Carry [^>]*weapon=/);
});
test('saved projects: no weapon setting opens as sheathed, an empty show event is dropped, keep cannot open', () => {
  const json = JSON.parse(JSON.stringify(importWorkspaceXml(keepXml())));
  delete json.actions[0].pair.carry.weapon;
  assert.equal(parseWorkspace(JSON.stringify(json)).actions[0].pair.carry.weapon, 'sheathed');
  json.actions[0].pair.carry.weaponShow = '';
  assert.equal('weaponShow' in parseWorkspace(JSON.stringify(json)).actions[0].pair.carry, false);
  json.actions[0].pair.carry.weapon = 'keep';
  assert.throws(() => parseWorkspace(JSON.stringify(json)), /0\.12\.238/);
  json.actions[0].pair.carry.weapon = 'sheathe';
  json.actions[0].pair.carry.weaponShow = 'Grapple_equip';
  assert.throws(() => parseWorkspace(JSON.stringify(json)), /0\.12\.238/);
});

test('a carry without its own putdown input takes a new key or a project input', () => {
  let w = importWorkspaceXml(carryXml());
  const lift = () => w.actions.find(a => a.pair?.carry),
    put = a => (w = {...w, actions: w.actions.map(x => (x.uid === a.uid ? a : x))});
  // As a pair reached by a transition: no input for the putdown.
  put({...lift(), config: {...lift().config, inputs: lift().config.inputs.filter(i => i.id !== 'drop')}});
  put(chooseCarryInput(w, lift(), NEW_CARRY_INPUT));
  assert.equal(lift().pair.carry.input, 'PutDown');
  assert.ok(
    validateWorkspace(w).some(e => /PutDown|내려놓기/.test(e.message)),
    'a new input asks for its key'
  );
  put({
    ...lift(),
    config: {...lift().config, inputs: lift().config.inputs.map(i => (i.id === 'PutDown' ? {...i, key: 'E'} : i))},
  });
  // Format 4 writes the putdown key on the Carry itself.
  assert.match(compileWorkspace(w), /<Carry [^>]*key="E"/);
  // A project input is copied onto the pair; a keyless input left behind goes.
  w = {...w, sharedInputs: [{id: 'Drop', label: 'Drop', key: 'J', gamepad: 0}]};
  put(chooseCarryInput(w, lift(), NEW_CARRY_INPUT));
  assert.equal(lift().pair.carry.input, 'PutDown2');
  put(chooseCarryInput(w, lift(), 'Drop'));
  assert.deepEqual(
    lift().config.inputs.map(i => i.id),
    ['use', 'PutDown', 'Drop']
  );
  assert.equal(lift().pair.carry.input, 'Drop');
});
