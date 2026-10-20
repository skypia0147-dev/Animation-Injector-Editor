import {importWorkspaceXml} from '../src/importXml.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyWorkspace, addAction} from '../src/workspace.ts';
import {connectXmlAssets} from '../src/importAssets.ts';
import {assetLibrary} from '../src/assets.ts';
import {grappleXml, grappleMod, needsGrapple} from './local.mjs';
const xml = 'H:/Mods/My Mod/SKSE/Plugins/AnimationInjector/My Mod/My Mod.xml';
function fixture(clips) {
  const w = emptyWorkspace();
  for (const clip of clips) {
    const a = addAction(w);
    a.config.steps[0].clip = clip;
    w.actions.push(a);
  }
  return w;
}
const resolver = async paths => paths.map(path => ({path, clip: path.split('character\\')[1], error: ''}));
test('XML resolves all shared clips and library entries under its own mod root', async () => {
  const w = fixture(['Animations/Test.hkx', 'animations/test.hkx']);
  w.assets.push({clip: 'Animations/Test.hkx', localPath: '', preview: {skeletons: [], skins: []}});
  const r = await connectXmlAssets(w, xml, resolver);
  assert.equal(r.connected, 1);
  assert.equal(r.missing, 0);
  for (const a of r.workspace.actions)
    assert.equal(a.config.steps[0].localPath, 'H:\\Mods\\My Mod\\meshes\\actors\\character\\Animations\\Test.hkx');
  assert.ok(r.workspace.assets[0].localPath);
  assert.equal(w.actions[0].config.steps[0].localPath, '');
});
test('unknown location, unsafe paths, missing files and native failures retain manual selection', async () => {
  const w = fixture(['../outside.hkx', 'C:/outside.hkx', 'Animations/Valid.hkx']);
  let calls = 0;
  const fail = async paths => {
    calls++;
    assert.equal(paths.length, 1);
    throw Error('offline');
  };
  assert.equal((await connectXmlAssets(w, '', fail)).workspace, w);
  assert.equal((await connectXmlAssets(w, 'H:/random.xml', fail)).workspace, w);
  const r = await connectXmlAssets(w, xml, fail);
  assert.equal(calls, 1);
  assert.equal(r.connected, 0);
  assert.equal(r.missing, 3);
  const missing = await connectXmlAssets(w, xml, async paths =>
    paths.map(path => ({path, clip: '', error: 'missing'}))
  );
  assert.equal(missing.connected, 0);
});
test('large imports batch native requests and preserve existing source selections', async () => {
  const w = fixture(Array.from({length: 205}, (_, i) => `Animations/${i}.hkx`));
  w.actions[0].config.steps[0].localPath = 'H:/selected.hkx';
  const sizes = [];
  const r = await connectXmlAssets(w, xml, async paths => {
    sizes.push(paths.length);
    return resolver(paths);
  });
  assert.deepEqual(sizes, [100, 100, 4]);
  assert.equal(r.connected, 204);
  assert.equal(r.workspace.actions[0].config.steps[0].localPath, 'H:/selected.hkx');
});
test('installed Grapple XML resolves its actual HKX sources', needsGrapple, async () => {
  const path = grappleXml;
  const w = importWorkspaceXml(fs.readFileSync(path, 'utf8'));
  const r = await connectXmlAssets(w, path, async paths =>
    (await resolver(paths)).map(item => ({...item, error: fs.existsSync(item.path) ? '' : 'missing'}))
  );
  const expected = assetLibrary(w).filter(asset =>
    fs.existsSync(grappleMod + '/meshes/actors/character/' + asset.clip)
  );
  assert.equal(r.connected, expected.length);
  assert.ok(r.connected >= 6);
  assert.equal(r.missing, assetLibrary(w).length - expected.length);
  for (const asset of assetLibrary(r.workspace)) {
    if (asset.localPath) assert.ok(fs.existsSync(asset.localPath));
    else assert.ok(!expected.some(item => item.clip === asset.clip));
  }
});
