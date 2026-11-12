import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseWorkspace} from '../src/workspace.ts';
import {
  applyRagdollFiles,
  builtInRagdoll,
  carryLifts,
  appDefaultRagdoll,
  parseRagdoll,
  ragdollWrites,
  ragdollXml,
  withoutRagdolls,
} from '../src/ragdoll.ts';
import {request} from '../src/package.ts';
import {carryXml} from './carry.test.mjs';
import {checker, needsChecker} from './local.mjs';

// The installed Grapple lift's file (11-04): the character built-in values with the left upper arm held too.
const grapple = `<?xml version="1.0" encoding="utf-8"?>
<Ragdoll rig="character" version="1">
  <Motion follow="1" gravity="4" drag="10" spin="10" inertia="10"/>
  <Body bone="NPC COM [COM ]" simulate="false"/>
  <Body bone="NPC Spine [Spn0]" simulate="false"/>
  <Body bone="NPC Spine1 [Spn1]" simulate="false"/>
  <Body bone="NPC Spine2 [Spn2]" simulate="false"/>
  <Body bone="NPC L UpperArm [LUar]" simulate="false"/>
</Ragdoll>`;

// The Combo Test 1 chicken carry's file (11-04): the chicken values tuned in HKX_Edit.
const chickenXml = `<?xml version="1.0" encoding="utf-8"?>
<Ragdoll rig="chicken" version="1">
  <Motion follow="1" gravity="3.13" drag="10" spin="10" inertia="3.7" friction="1"/>
  <Body bone="LeftAnkle" swingFrom="LeftThigh"/>
  <Body bone="RightAnkle" swingFrom="RightThigh"/>
</Ragdoll>`;
const tunedChicken = () => parseRagdoll(chickenXml, 'chicken').ragdoll;

test('built-in values are vanilla for every rig (RagdollProfile::BuiltIn) and list every body of the rig', () => {
  const vanilla = {follow: 0, gravity: 1, drag: 0, spin: 0, inertia: 1, friction: null};
  for (const rig of ['character', 'chicken', 'wolf']) {
    const r = builtInRagdoll(rig);
    assert.deepEqual(r.motion, vanilla, rig);
    assert.ok(
      r.bodies.every(b => b.simulate && b.drag === null && b.cone === null && !b.swingFrom),
      rig
    );
  }
  assert.equal(builtInRagdoll('character').bodies.length, 18);
  assert.equal(builtInRagdoll('chicken').bodies.length, 7);
});

test("the editor's starting values are the same for every rig", () => {
  for (const rig of ['character', 'chicken', 'wolf']) {
    const r = appDefaultRagdoll(rig);
    assert.deepEqual(r.motion, {follow: 1, gravity: 4, drag: 10, spin: 10, inertia: 10, friction: null}, rig);
    assert.ok(r.bodies.length > 0 && r.bodies.every(b => b.simulate && b.drag === null && !b.swingFrom), rig);
  }
});

test('a file reads with the runtime rules and writes back every value', () => {
  const read = parseRagdoll(grapple, 'character');
  assert.ok('ragdoll' in read, read.error);
  assert.equal(read.ragdoll.bodies.length, 18);
  assert.deepEqual(
    read.ragdoll.bodies.filter(b => !b.simulate).map(b => b.bone),
    ['NPC COM [COM ]', 'NPC Spine [Spn0]', 'NPC Spine1 [Spn1]', 'NPC Spine2 [Spn2]', 'NPC L UpperArm [LUar]']
  );
  const written = ragdollXml(read.ragdoll);
  assert.equal((written.match(/<Body /g) ?? []).length, 18);
  assert.match(written, /<Body bone="NPC Head \[Head\]" simulate="true"\/>/);
  assert.deepEqual(parseRagdoll(written, 'character').ragdoll, read.ragdoll);
  const limits = {
    ...read.ragdoll,
    bodies: read.ragdoll.bodies.map((b, i) =>
      i ? b : {...b, cone: 40, twist: [-15, 15], swingFrom: 'NPC Pelvis [Pelv]'}
    ),
  };
  assert.deepEqual(parseRagdoll(ragdollXml(limits), 'character').ragdoll, limits);
});

test('a file the runtime would reject is rejected with its reason', () => {
  const reject = (text, rig = 'character') => {
    const r = parseRagdoll(text, rig);
    assert.ok('error' in r, text);
    return r.error;
  };
  assert.match(reject(grapple, 'chicken'), /character/);
  assert.match(reject(grapple.replace('follow="1"', 'follow="9"')), /follow/);
  assert.match(reject(grapple.replace('version="1"', 'version="2"')), /version/);
  assert.match(reject(grapple.replace('<Motion ', '<Motion speed="1" ')), /speed/);
  assert.match(reject(grapple.replace('NPC Spine [Spn0]', 'NPC Spine1 [Spn1]')), /두 번/);
  assert.match(reject(grapple.replace('simulate="false"', 'simulate="no"')), /simulate/);
  assert.match(reject(grapple.replace('<Motion ', '<Extra/><Motion ')), /Extra/);
});

test('the runtime parser accepts what the editor writes', needsChecker, () => {
  const folder = mkdtempSync(join(tmpdir(), 'aie-ragdoll-'));
  after(() => rmSync(folder, {recursive: true, force: true}));
  const r = parseRagdoll(grapple, 'character').ragdoll;
  const limits = {
    ...r,
    motion: {...r.motion, friction: 12},
    bodies: r.bodies.map((b, i) => (i ? b : {...b, cone: 40, plane: [-20, 20], twist: [-15, 15], drag: 2})),
  };
  for (const [name, value] of [
    ['builtin', builtInRagdoll('character')],
    ['grapple', r],
    ['limits', limits],
    ['chicken', tunedChicken()],
  ]) {
    writeFileSync(`${folder}/${name}.xml`, ragdollXml(value));
    const run = spawnSync(checker, ['--ragdoll', `${folder}/${name}.xml`], {encoding: 'utf8'});
    assert.equal(run.status, 0, name + ': ' + run.stdout + run.stderr);
  }
});

test('a project reads its lifts files, writes those with values and removes the rest', () => {
  let w = importWorkspaceXml(carryXml());
  assert.deepEqual(
    carryLifts(w).map(l => [l.id, l.rig]),
    [['Lift', 'chicken']]
  );
  assert.equal(w.actions[0].pair.carry.ragdoll, null);
  // A file read: its values; a missing one: the built-in values (null); a rejected one: left alone.
  const chicken = ragdollXml(tunedChicken());
  let applied = applyRagdollFiles(w, [{id: 'Lift', contents: chicken.replace('gravity="3.13"', 'gravity="2"')}]);
  assert.deepEqual(applied.errors, []);
  assert.equal(applied.workspace.actions[0].pair.carry.ragdoll.motion.gravity, 2);
  applied = applyRagdollFiles(w, [{id: 'lift', contents: grapple}]);
  assert.equal(applied.workspace.actions[0].pair.carry.ragdoll, null);
  assert.deepEqual(applied.rejected, ['Lift']);
  // The notice names the file (11-04 cleanup: an escaped `\${` printed the template text instead).
  assert.match(applied.errors[0], /^Ragdoll\\Lift\.xml: /);
  assert.deepEqual(ragdollWrites(applied.workspace, ['Lift'], applied.rejected), {files: [], remove: []});
  // A file that could not be read at all (not UTF-8, too large): the document opens on the built-in values, the
  // notice names the file and Save leaves it on disk, as a rejected one.
  applied = applyRagdollFiles(w, [{id: 'Lift', contents: null, error: 'stream did not contain valid UTF-8'}]);
  assert.equal(applied.workspace.actions[0].pair.carry.ragdoll, null);
  assert.deepEqual(applied.rejected, ['Lift']);
  assert.equal(applied.errors[0], 'Ragdoll\\Lift.xml: stream did not contain valid UTF-8');
  assert.deepEqual(ragdollWrites(applied.workspace, ['Lift'], applied.rejected), {files: [], remove: []});
  // Back on the built-in values: the file goes; a renamed lift's old file goes too.
  assert.deepEqual(ragdollWrites(w, ['Old'], []), {files: [], remove: ['Lift', 'Old']});
  w = applyRagdollFiles(w, [{id: 'Lift', contents: chicken}]).workspace;
  const writes = ragdollWrites(w, ['Lift'], []);
  assert.deepEqual(writes.remove, []);
  assert.equal(writes.files[0].id, 'Lift');
  assert.equal(writes.files[0].contents, chicken);
});

test('the editor block holds no ragdoll values; a saved project without them opens on the built-in values', () => {
  const w = applyRagdollFiles(importWorkspaceXml(carryXml()), [
    {id: 'Lift', contents: ragdollXml(tunedChicken())},
  ]).workspace;
  const project = JSON.stringify(w);
  assert.ok(parseWorkspace(project).actions[0].pair.carry.ragdoll);
  const block = withoutRagdolls(project);
  assert.doesNotMatch(block, /"ragdoll":/);
  // Only the carries' values go: a ragdoll function keeps its op.
  assert.match(
    withoutRagdolls(JSON.stringify({effects: [{values: {op: 'ragdoll'}}], ragdoll: 1})),
    /"op":"ragdoll".*"ragdoll":1/
  );
  assert.equal(parseWorkspace(block).actions[0].pair.carry.ragdoll, null);
  const broken = structuredClone(w);
  broken.actions[0].pair.carry.ragdoll.motion.gravity = 9;
  assert.throws(() => parseWorkspace(JSON.stringify(broken)), /래그돌/);
});

test('the mod package writes the lifts with their own values beside the XML', () => {
  const w = applyRagdollFiles(importWorkspaceXml(carryXml()), [
    {id: 'Lift', contents: ragdollXml(tunedChicken())},
  ]).workspace;
  w.packaging.folder = 'CarryDemo';
  assert.deepEqual(
    request(w).ragdolls.map(f => f.id),
    ['Lift']
  );
});
