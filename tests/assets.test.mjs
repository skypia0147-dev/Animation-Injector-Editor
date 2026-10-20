import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, parseWorkspace} from '../src/workspace.ts';
import {assetLibrary, registerAssets, assignClip, unregisterAsset} from '../src/assets.ts';
import {assets} from '../src/package.ts';
import {portable} from '../src/authoring.ts';

const setup = () => {
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations\\Mod\\Attack.hkx';
  w.actions.push(a);
  return w;
};

test('library merges registered files with clips referenced by states', () => {
  let w = setup();
  w = registerAssets(w, [
    {clip: 'Animations\\Mod\\attack.hkx', path: 'H:/mods/x/meshes/actors/character/Animations/Mod/attack.hkx'},
    {clip: 'Animations\\Mod\\Idle.hkx', path: 'H:/mods/x/meshes/actors/character/Animations/Mod/Idle.hkx'},
  ]);
  const lib = assetLibrary(w);
  assert.deepEqual(
    lib.map(e => [e.name, e.registered, e.users.length, !!e.localPath]),
    [
      ['Attack.hkx', true, 1, true],
      ['Idle.hkx', true, 0, true],
    ]
  );
  // the state without a source path picked up the registered one (case-insensitive key)
  assert.equal(w.actions[0].config.steps[0].localPath, 'H:/mods/x/meshes/actors/character/Animations/Mod/attack.hkx');
  assert.equal(assets(w).length, 1, 'packaging still lists only clips that states use');
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
  assert.ok(portable(w).assets.every(a => a.localPath === ''));
});

test('drop on a state replaces its clip; unregistering keeps referenced files in the library', () => {
  let w = setup();
  const uid = w.actions[0].uid;
  w = assignClip(w, uid, 'Animations\\Mod\\New.hkx', 'C:/data/meshes/actors/character/Animations/Mod/New.hkx');
  assert.equal(w.actions[0].config.steps[0].clip, 'Animations\\Mod\\New.hkx');
  // the replaced clip was neither registered nor used any more, so the library holds only the new file
  assert.equal(assetLibrary(w).length, 1);
  assert.ok(assetLibrary(w)[0].registered && assetLibrary(w)[0].users.length === 1);
  w = unregisterAsset(w, 'Animations\\Mod\\New.hkx');
  const entry = assetLibrary(w).find(e => e.name === 'New.hkx');
  assert.ok(entry && !entry.registered && entry.users.length === 1);
  assert.throws(() => assignClip(w, 'missing', 'a.hkx', ''));
});

test('schema 7 files saved before the asset browser still open', () => {
  const w = setup();
  const old = JSON.parse(JSON.stringify(w));
  delete old.assets;
  const back = parseWorkspace(JSON.stringify(old));
  assert.deepEqual(back.assets, []);
  assert.throws(() => parseWorkspace(JSON.stringify({...w, assets: [{clip: 'x'}]})));
});
