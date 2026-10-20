import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetFolders} from '../src/ui/assetFolders.ts';

test('HKX folders merge casing/separator aliases without merging different files or changing paths', () => {
  const clips = [
    'Animations\\Grapple\\Front\\Attack.hkx',
    'animations/grapple/Back/Attack.hkx',
    'Animations/Grapple/Front/Attack2.hkx',
    'Loose.hkx',
  ];
  const entries = clips.map(clip => ({
    clip,
    name: clip.split(/[\\/]/).at(-1),
    localPath: 'H:/Mods/' + clip,
    users: [],
    registered: true,
  }));
  const original = structuredClone(entries),
    root = assetFolders(entries);
  assert.equal(root.count, 4);
  assert.equal(root.folders.length, 1);
  assert.equal(root.files[0].clip, 'Loose.hkx');
  const grapple = root.folders[0];
  assert.equal(grapple.count, 3);
  assert.deepEqual(
    grapple.folders.map(f => f.name),
    ['Back', 'Front']
  );
  assert.equal(grapple.folders[0].files[0].clip, clips[1]);
  assert.equal(grapple.folders[1].files.length, 2);
  assert.deepEqual(entries, original);
});
