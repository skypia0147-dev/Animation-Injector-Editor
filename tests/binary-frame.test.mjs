import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeSkin, decodeViewerFrames} from '../src/viewport/binaryFrame.ts';
import {validateViewerData} from '../src/viewport/types.ts';
import {matrixAt} from '../src/viewport/matrices.ts';

// Same layout as src-tauri/src/ipc_binary.rs: [u32 LE length][JSON][pad to 4][payload].
function frame(header, payload) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = (4 + json.length + 3) & ~3;
  const out = new Uint8Array(start + payload.byteLength);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), start);
  return out.buffer;
}
const actor = count => ({
  skeleton: 'character',
  skeletonPath: 'C:/Skyrim/meshes/actors/character/character assets/skeleton.hkx',
  bones: [
    {name: 'NPC Root [Root]', parent: -1, body: true},
    {name: '뼈', parent: 0, body: false},
  ],
  matrixCount: count,
  rootTranslation: [
    [0, 0, 0],
    [1, 2, 3],
  ],
  rootYaw: [0, 45],
  trajectory: [
    [0, 0, 0],
    [1, 1, 1],
  ],
});
const header = counts => ({
  duration: 1,
  fps: 30,
  frameCount: 2,
  paired: counts.length === 2,
  actors: counts.map(actor),
  annotations: [],
});

test('viewer frames decode to Float32Array views that validate and index like arrays', () => {
  const values = Float32Array.from({length: 128}, (_, i) => i * 0.25 - 3);
  const data = validateViewerData(decodeViewerFrames(frame(header([64, 64]), values)));
  assert.ok(data.actors[0].matrices instanceof Float32Array);
  assert.deepEqual(matrixAt(data.actors[1], 1, 1), [...values.slice(112, 128)]);
  assert.equal('matrixCount' in data.actors[0], false);
  // Array fixtures (development viewer fixtures, tests) keep working unchanged.
  const fixture = {...data, actors: data.actors.map(a => ({...a, matrices: [...a.matrices]}))};
  assert.deepEqual(matrixAt(validateViewerData(fixture).actors[0], 0, 0), [...values.slice(0, 16)]);
});

test('malformed viewer frames are rejected', () => {
  const values = new Float32Array(64);
  assert.throws(() => decodeViewerFrames(frame(header([65]), values))); // Count beyond the payload.
  assert.throws(() => decodeViewerFrames(frame(header([32]), values))); // Unclaimed trailing floats.
  assert.throws(() => decodeViewerFrames(new ArrayBuffer(2)));
  const bad = frame(header([64]), values);
  new DataView(bad).setUint32(0, 1 << 30, true);
  assert.throws(() => decodeViewerFrames(bad));
  values[5] = NaN;
  assert.throws(() => validateViewerData(decodeViewerFrames(frame({...header([64]), frameCount: 2}, values))));
});

test('skin frames carry the GLB bytes after the header', () => {
  const bytes = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 1, 2, 3]);
  const skin = decodeSkin(frame({path: 'C:/스킨.glb', name: '스킨.glb'}, bytes));
  assert.equal(skin.name, '스킨.glb');
  assert.deepEqual([...skin.bytes], [...bytes]);
});
