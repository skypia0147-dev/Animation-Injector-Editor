import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairedRigs} from '../src/pairedRigs.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {assets} from '../src/package.ts';
import {previewAssets} from '../src/viewport/resources.ts';

const xml = rig =>
  `<?xml version="1.0"?><AnimationSet version="4" id="CreaturePair"><Inputs><Input id="use" key="G"/></Inputs><Pair id="Test" clip="Animations/Pair/Test.hkx"><Start input="use"/><Target rig="${rig}" range="250" angle="160"/><Exit at="end-0.05" blend="0.2"/></Pair></AnimationSet>`;
for (const profile of pairedRigs) {
  test(`creature pair ${profile.id}: XML, project, package and explicit preview identity`, () => {
    const w = importWorkspaceXml(xml(profile.id));
    assert.equal(w.actions[0].pair.targetRig, profile.id);
    const compiled = compileWorkspace(w);
    const copy = importWorkspaceXml(compiled);
    assert.equal(copy.actions[0].pair.targetRig, profile.id);
    assert.equal(parseWorkspace(JSON.stringify(w)).actions[0].pair.targetRig, profile.id);
    assert.deepEqual(assets(w)[0].actorRoots, [...new Set(['meshes/actors/character', profile.actorRoot])]);
    if (profile.id !== 'character') {
      const preview = previewAssets(w, w.actions[0].config.steps[0].clip, profile.id);
      assert.equal(preview.skeletons[0], 'builtin/skeletons/character.hkx');
      assert.equal(preview.skeletons[1], profile.previewSkeleton);
    }
  });
}
test('unknown creature identity cannot silently become human', () => {
  assert.throws(() => importWorkspaceXml(xml('unknownCreature')));
  const w = importWorkspaceXml(xml('chicken'));
  w.actions[0].pair.targetRig = 'unknownCreature';
  assert.throws(() => compileWorkspace(w));
});
test('reused clip exports once per required actor root and retains manual preview override', () => {
  const w = importWorkspaceXml(xml('chicken'));
  const another = structuredClone(w.actions[0]);
  another.uid += '2';
  another.config.actionId += '2';
  another.pair.targetRig = 'wolf';
  w.actions.push(another);
  assert.equal(assets(w).length, 1);
  assert.deepEqual(assets(w)[0].actorRoots, [
    'meshes/actors/character',
    'meshes/actors/ambient/chicken',
    'meshes/actors/canine',
  ]);
  const clip = w.actions[0].config.steps[0].clip;
  w.assets = [{clip, localPath: '', preview: {skeletons: ['', 'F:/Custom.hkx'], skins: []}}];
  assert.equal(previewAssets(w, clip, 'chicken').skeletons[1], 'F:/Custom.hkx');
});
