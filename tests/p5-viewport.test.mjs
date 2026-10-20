import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {emptyWorkspace, addAction, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {portable} from '../src/authoring.ts';
import {previewAssets, setPreviewAsset, skeletonCandidates, skinPathForActor} from '../src/viewport/resources.ts';
import {frameAtTime, validateViewerData, viewerMeta} from '../src/viewport/types.ts';
import {actorRootMatrix, boneSegments, matchBoneNames, matrixAt} from '../src/viewport/matrices.ts';
import {applyActorPose, validateSkinHierarchy, describeSkinJoints} from '../src/viewport/skin.ts';
import {playbackReducer} from '../src/viewport/playback.ts';
import {safeLoaderUrl, validateGlbResources} from '../src/viewport/glb.ts';

const matrix = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const actor = {
  skeleton: 'character',
  skeletonPath: 'C:\\Skyrim\\meshes\\actors\\character\\character assets\\skeleton.hkx',
  bones: [
    {name: 'NPC Root [Root]', parent: -1, body: true},
    {name: 'NPC Pelvis [Pelv]', parent: 0, body: true},
  ],
  matrices: [...matrix(1, 2, 3), ...matrix(4, 5, 6), ...matrix(2, 3, 4), ...matrix(6, 7, 8)],
  rootTranslation: [
    [10, 0, 0],
    [20, 0, 0],
  ],
  rootYaw: [90, 180],
  trajectory: [
    [8, 1, 3],
    [17, 2, 4],
  ],
};
const viewer = {
  duration: 1,
  fps: 1,
  frameCount: 2,
  paired: false,
  actors: [actor],
  annotations: [{time: 0.5, text: 'Hit', track: 'NPC'}],
};

test('old schema 7 files gain empty preview mappings without changing executable XML', () => {
  const old = emptyWorkspace();
  const action = addAction(old);
  action.config.steps[0].clip = 'Animations\\Test.hkx';
  old.actions.push(action);
  old.assets.push({clip: action.config.steps[0].clip, localPath: 'H:\\Test.hkx', preview: {skeletons: [], skins: []}});
  const before = compileWorkspace(old);
  const json = JSON.parse(JSON.stringify(old));
  delete json.assets[0].preview;
  const restored = parseWorkspace(JSON.stringify(json));
  assert.deepEqual(restored.assets[0].preview, {skeletons: [], skins: []});
  assert.equal(compileWorkspace(restored), before);
});

test('clip-local A1/A2 sources roundtrip and portable export removes every local path', () => {
  let workspace = emptyWorkspace();
  workspace = setPreviewAsset(workspace, 'Animations\\Pair.hkx', 'skeletons', 0, 'H:\\A1\\skeleton.hkx');
  workspace = setPreviewAsset(workspace, 'Animations\\Pair.hkx', 'skeletons', 1, 'H:\\A2\\skeleton.hkx');
  workspace = setPreviewAsset(workspace, 'Animations\\Pair.hkx', 'skins', 0, 'H:\\skins\\character.glb');
  const restored = parseWorkspace(JSON.stringify(workspace));
  assert.deepEqual(previewAssets(restored, 'animations\\pair.hkx').skeletons, [
    'H:\\A1\\skeleton.hkx',
    'H:\\A2\\skeleton.hkx',
  ]);
  const output = JSON.stringify(portable(restored));
  for (const secret of ['H:\\A1', 'H:\\A2', 'H:\\skins']) assert.ok(!output.includes(secret));
});

test('registered skeletons become unique candidates and skins auto-match only by an unambiguous skeleton name', () => {
  let workspace = emptyWorkspace();
  workspace = setPreviewAsset(workspace, 'A.hkx', 'skeletons', 0, 'H:\\a\\skeleton.hkx');
  workspace = setPreviewAsset(workspace, 'B.hkx', 'skeletons', 0, 'H:\\b\\skeleton.hkx');
  workspace = setPreviewAsset(workspace, 'A.hkx', 'skins', 0, 'H:\\skin\\character.glb');
  assert.deepEqual(skeletonCandidates(workspace, ['H:\\a\\skeleton.hkx']), ['H:\\b\\skeleton.hkx']);
  assert.equal(skinPathForActor(workspace, 'B.hkx', 0, 'character'), 'H:\\skin\\character.glb');
  workspace = setPreviewAsset(workspace, 'C.hkx', 'skins', 0, 'I:\\other\\character.glb');
  assert.equal(skinPathForActor(workspace, 'B.hkx', 0, 'character'), '');
});

test('viewer response validation, metadata and end-frame mapping preserve the native frame contract', () => {
  const data = validateViewerData(structuredClone(viewer));
  assert.equal(frameAtTime(0, data), 0);
  assert.equal(frameAtTime(data.duration, data), data.frameCount - 1);
  assert.deepEqual(viewerMeta(data).annotations, data.annotations);
  const malformed = structuredClone(data);
  malformed.actors[0].matrices.pop();
  assert.throws(() => validateViewerData(malformed), /액터 프레임/);
});

test('bones use native object matrices and root yaw degrees form one actor overlay', () => {
  assert.deepEqual(matrixAt(actor, 1, 1), matrix(6, 7, 8));
  assert.deepEqual(boneSegments(actor, 0), [1, 2, 3, 4, 5, 6]);
  const root = actorRootMatrix(actor, 0, true);
  assert.ok(Math.abs(root[0]) < 1e-12);
  assert.equal(root[1], -1);
  assert.equal(root[3], 10);
  assert.deepEqual(actor.trajectory[0], [8, 1, 3], 'trajectory remains the already-rooted native value');
});

test('bone matching handles Skyrim and Blender side names, helper joints, and rejects invalid hierarchy', () => {
  assert.deepEqual(matchBoneNames(['npc root [root]', 'NPC Pelvis'], actor.bones), [0, 1]);
  assert.deepEqual(matchBoneNames(['NPC Thigh.L'], [{name: 'NPC L Thigh [LThg]'}]), [0]);
  assert.deepEqual(matchBoneNames(['NPC Pelvis'], [{name: 'NPC Pelvis [Pelv]'}, {name: 'NPC Pelvis [Tail]'}]), [0]);
  assert.deepEqual(
    validateSkinHierarchy(
      [
        {name: 'NPC Root [Root]', parent: -1},
        {name: 'NPC Pelvis', parent: 0},
      ],
      actor
    ),
    [0, 1]
  );
  assert.deepEqual(
    validateSkinHierarchy(
      [
        {name: 'NPC Root [Root]', parent: -1},
        {name: 'CME Body', parent: 0},
        {name: 'NPC Pelvis', parent: 1},
      ],
      actor
    ),
    [0, -1, 1]
  );
  assert.deepEqual(
    validateSkinHierarchy(
      [
        {name: 'NPC Root [Root]', parent: -1},
        {name: 'NPC Pelvis', parent: -1},
      ],
      actor
    ),
    [0, 1]
  );
  assert.throws(
    () =>
      validateSkinHierarchy(
        [
          {name: 'NPC Root [Root]', parent: 1},
          {name: 'NPC Pelvis', parent: 0},
        ],
        actor
      ),
    /순환/
  );
});

test('skin pose uses the actual GLB parent world transform before updating the palette', () => {
  const common = new THREE.Group(),
    actorRoot = new THREE.Group(),
    gltfScene = new THREE.Group(),
    armature = new THREE.Group(),
    root = new THREE.Bone(),
    pelvis = new THREE.Bone();
  common.rotation.x = -Math.PI / 2;
  actorRoot.matrixAutoUpdate = false;
  actorRoot.matrix.set(...actorRootMatrix(actor, 0, true));
  gltfScene.position.set(30, -10, 7);
  armature.position.set(-4, 12, 2);
  root.name = 'NPC Root [Root]';
  pelvis.name = 'NPC Pelvis [Pelv]';
  common.add(actorRoot);
  actorRoot.add(gltfScene);
  gltfScene.add(armature);
  armature.add(root);
  root.add(pelvis);
  let paletteUpdated = false;
  const mesh = {
    skeleton: {
      bones: [root, pelvis],
      update() {
        paletteUpdated = true;
        const expected = actorRoot.matrixWorld.clone().multiply(new THREE.Matrix4().set(...matrix(4, 5, 6)));
        assert.ok(
          expected.elements.every((value, index) => Math.abs(value - pelvis.matrixWorld.elements[index]) < 1e-6)
        );
      },
    },
    updateMatrixWorld() {},
  };
  common.updateMatrixWorld(true);
  const stats = applyActorPose(actorRoot, actor, 0, [mesh]);
  assert.equal(paletteUpdated, true);
  assert.equal(stats.matchedBones, 2);
  assert.ok(stats.maxWorldError < 1e-6);
});

test('playback sync clamps duration, stops at the end, and ignores an old clip RAF tick', () => {
  let state = {identity: 'A', duration: 2, time: 1.8, playing: true};
  state = playbackReducer(state, {type: 'sync', identity: 'A', duration: 1});
  assert.deepEqual(state, {identity: 'A', duration: 1, time: 1, playing: false});
  state = playbackReducer(state, {type: 'sync', identity: 'B', duration: 3});
  assert.deepEqual(state, {identity: 'B', duration: 3, time: 0, playing: false});
  const afterOldTick = playbackReducer({...state, playing: true}, {type: 'tick', identity: 'A', elapsed: 0.5});
  assert.equal(afterOldTick.time, 0);
  assert.equal(afterOldTick.identity, 'B');
});

const makeGlb = json => {
  const source = Buffer.from(JSON.stringify(json)),
    padded = Buffer.concat([source, Buffer.alloc((4 - (source.length % 4)) % 4, 0x20)]),
    output = Buffer.alloc(20 + padded.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  return new Uint8Array(output);
};

test('GLB accepts embedded bufferView/data resources and rejects remote, file and relative URIs', () => {
  validateGlbResources(makeGlb({asset: {version: '2.0'}, buffers: [{byteLength: 0}], images: [{bufferView: 0}]}));
  validateGlbResources(makeGlb({asset: {version: '2.0'}, images: [{uri: 'data:image/png;base64,AA=='}]}));
  for (const uri of ['https://example.org/a.bin', 'file:///C:/a.bin', 'texture.png'])
    assert.throws(() => validateGlbResources(makeGlb({asset: {version: '2.0'}, buffers: [{uri}]})), /외부 리소스/);
  assert.equal(safeLoaderUrl('blob:generated-by-loader'), 'blob:generated-by-loader');
  assert.throws(() => safeLoaderUrl('https://example.org/texture.png'), /외부 URL/);
});

test('GLTF sanitized and uniquified names retain authored HKX joint bindings', () => {
  const root = new THREE.Bone(),
    pelvis = new THREE.Bone();
  root.name = 'NPC_Root_Root';
  root.userData.name = 'NPC Root [Root]';
  pelvis.name = 'NPC_Pelvis_Pelv_1';
  pelvis.userData.name = 'NPC Pelvis [Pelv]';
  root.add(pelvis);
  assert.deepEqual(validateSkinHierarchy(describeSkinJoints([root, pelvis]), actor), [0, 1]);
  const scene = new THREE.Group();
  scene.add(root);
  const skeleton = new THREE.Skeleton([root, pelvis]);
  applyActorPose(scene, actor, 1, [{skeleton, updateMatrixWorld() {}}]);
  assert.ok(pelvis.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(6, 7, 8)) < 1e-6);
  delete root.userData.name;
  root.name = 'NPC Root [Root]';
  assert.deepEqual(validateSkinHierarchy(describeSkinJoints([root, pelvis]), actor), [0, 1]);
});
