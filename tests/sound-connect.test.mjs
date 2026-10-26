import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction} from '../src/workspace.ts';
import {connectXmlAssets} from '../src/importAssets.ts';
import {selectSound, soundLibrary} from '../src/package.ts';

// Opening an XML finds the sound files its functions play beside it, as the mod package writes them.
const xml = 'H:/Mods/My Mod/SKSE/Plugins/AnimationInjector/My Mod/My Mod.xml';
const resolver = async paths => paths.map(path => ({path, clip: path.split('character\\')[1], error: ''}));
const project = files => {
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations/Test.hkx';
  a.config.effects = files.map((file, i) => ({id: 'e' + i, values: {op: 'sound', at: '0', file}}));
  w.actions.push(a);
  w.eventRegistry = [{id: 'event1', name: 'Hit', functions: [{id: 'fn1', values: {op: 'sound', file: files[0]}}]}];
  return w;
};

test('sounds beside the XML are connected; unsafe or absent ones are not', async () => {
  const w = project(['sound\\fx\\MyMod\\a.wav', 'sound\\fx\\MyMod\\gone.wav', '..\\outside.wav']);
  const asked = [];
  const exists = async paths => {
    asked.push(...paths);
    return paths.map(path => !path.includes('gone'));
  };
  const r = await connectXmlAssets(w, xml, resolver, exists);
  assert.deepEqual(r.sounds, {connected: 1, missing: 2, stale: 0});
  assert.deepEqual(r.workspace.packaging.sounds, [
    {file: 'sound\\fx\\MyMod\\a.wav', localPath: 'H:\\Mods\\My Mod\\sound\\fx\\MyMod\\a.wav'},
  ]);
  assert.ok(!asked.some(path => path.includes('outside')));
  const [entry] = soundLibrary(r.workspace);
  assert.equal(entry.name, 'a.wav');
  assert.deepEqual(entry.events, ['Hit']);
  assert.equal(entry.actions.length, 1);
});

test('a remembered sound whose file is gone is found beside the XML; one still there stays', async () => {
  let w = project(['sound\\fx\\a.wav', 'sound\\fx\\b.wav']);
  w = selectSound(w, 'sound\\fx\\a.wav', 'H:\\Old Name\\sound\\fx\\a.wav');
  w = selectSound(w, 'sound\\fx\\b.wav', 'D:\\Work\\b.wav');
  const r = await connectXmlAssets(w, xml, resolver, async paths => paths.map(path => !path.includes('Old Name')));
  assert.deepEqual(r.sounds, {connected: 1, missing: 0, stale: 1});
  assert.deepEqual(Object.fromEntries(r.workspace.packaging.sounds.map(s => [s.file, s.localPath])), {
    'sound\\fx\\a.wav': 'H:\\Mods\\My Mod\\sound\\fx\\a.wav',
    'sound\\fx\\b.wav': 'D:\\Work\\b.wav',
  });
  // Without the check, or when it fails, nothing changes.
  assert.equal((await connectXmlAssets(w, xml, resolver)).workspace.packaging.sounds, w.packaging.sounds);
  const offline = await connectXmlAssets(w, xml, resolver, async () => {
    throw Error('offline');
  });
  assert.deepEqual(offline.workspace.packaging.sounds, w.packaging.sounds);
});

test('every sound the mod folder holds joins the library, even one no function plays (10-26)', async () => {
  // Dynamic Sprint Stop: its plugin plays these from the HKX SoundPlay annotation; the XML names none.
  const w = project(['sound\\fx\\fst\\fst_sprintstop.wav']);
  const root = 'H:\\Mods\\My Mod\\Sound\\FX\\FST\\';
  const held = async folder => {
    assert.equal(folder, 'H:/Mods/My Mod');
    return [
      {path: root + 'FST_BowSprintStop.wav', file: 'sound\\FX\\FST\\FST_BowSprintStop.wav'},
      {path: root + 'FST_SprintStop.wav', file: 'sound\\FX\\FST\\FST_SprintStop.wav'},
    ];
  };
  const r = await connectXmlAssets(w, xml, resolver, async paths => paths.map(() => false), held);
  assert.equal(r.sounds.connected, 2);
  const library = soundLibrary(r.workspace);
  assert.deepEqual(
    library.map(s => [s.name, s.localPath, s.actions.length > 0]),
    [
      ['FST_BowSprintStop.wav', root + 'FST_BowSprintStop.wav', false],
      ['fst_sprintstop.wav', root + 'FST_SprintStop.wav', true],
    ]
  );
  // A listing that fails leaves the library as it was.
  const offline = await connectXmlAssets(
    w,
    xml,
    resolver,
    async paths => paths.map(() => false),
    async () => {
      throw Error('offline');
    }
  );
  assert.deepEqual(offline.workspace.packaging.sounds, []);
});
