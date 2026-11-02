import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../src/workspace.ts';
import {modXmlPath} from '../src/assets.ts';

// The first save of a project whose HKX all came from one mod folder goes where the game reads it there (11-02).
const withAssets = (folder, ...paths) => {
  const w = emptyWorkspace();
  w.id = folder;
  w.assets = paths.map((localPath, i) => ({
    clip: `animations\\Test\\${i}.hkx`,
    localPath,
    preview: {skeletons: [], skins: []},
  }));
  return w;
};

test('HKX from one mod folder suggest its SKSE path; anything else suggests none', () => {
  const mod = 'H:\\Mods\\Dynamic Sprint Stop\\meshes\\actors\\character\\animations\\DynamicSprintStop\\';
  assert.equal(
    modXmlPath(withAssets('DynamicSprintStop', mod + 'A.hkx', mod + 'B.hkx')),
    'H:\\Mods\\Dynamic Sprint Stop\\SKSE\\Plugins\\AnimationInjector\\DynamicSprintStop\\DynamicSprintStop.xml'
  );
  // Forward slashes and case: still the one folder.
  assert.ok(modXmlPath(withAssets('X', 'h:/mods/a/MESHES/actors/x.hkx', 'H:\\Mods\\A\\meshes\\actors\\y.hkx')));
  // Two mod folders, one outside any, no files, or no valid folder name: none.
  assert.equal(modXmlPath(withAssets('X', 'H:\\A\\meshes\\actors\\x.hkx', 'H:\\B\\meshes\\actors\\y.hkx')), undefined);
  assert.equal(modXmlPath(withAssets('X', 'H:\\A\\meshes\\actors\\x.hkx', 'H:\\Loose\\x.hkx')), undefined);
  assert.equal(modXmlPath(withAssets('X')), undefined);
  assert.equal(modXmlPath(withAssets('', mod + 'A.hkx')), undefined);
});
