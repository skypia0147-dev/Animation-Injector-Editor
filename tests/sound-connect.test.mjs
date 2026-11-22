import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, validateWorkspace} from '../src/workspace.ts';
import {connectXmlAssets, soundFolder} from '../src/importAssets.ts';
import {selectSound, soundLibrary, sounds} from '../src/package.ts';

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
  assert.deepEqual(r.sounds, {connected: 1, missing: 2, stale: 0, folded: 0});
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
  assert.deepEqual(r.sounds, {connected: 1, missing: 0, stale: 1, folded: 0});
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

test("the mod folder's sounds are listed and packaged, never saved in the project (11-23)", () => {
  // Dynamic Sprint Stop: its plugin plays these from the HKX SoundPlay annotation; the XML names none.
  const w = project(['sound\\fx\\fst\\fst_sprintstop.wav']);
  const root = 'H:\\Mods\\My Mod\\Sound\\FX\\FST\\';
  const folder = [
    {path: root + 'FST_BowSprintStop.wav', file: 'sound\\FX\\FST\\FST_BowSprintStop.wav'},
    {path: root + 'FST_SprintStop.wav', file: 'sound\\FX\\FST\\FST_SprintStop.wav'},
  ];
  const library = soundLibrary(w, folder);
  assert.deepEqual(
    library.map(s => [s.name, s.localPath, s.actions.length > 0, s.registered, s.inFolder]),
    [
      ['fst_sprintstop.wav', root + 'FST_SprintStop.wav', true, false, true],
      ['FST_BowSprintStop.wav', root + 'FST_BowSprintStop.wav', false, false, true],
    ]
  );
  // The package copies both; the project keeps none of them.
  assert.deepEqual(
    sounds(w, folder).map(s => [s.file, s.paths]),
    [
      ['sound\\fx\\fst\\fst_sprintstop.wav', [root + 'FST_SprintStop.wav']],
      ['sound\\FX\\FST\\FST_BowSprintStop.wav', [root + 'FST_BowSprintStop.wav']],
    ]
  );
  assert.deepEqual(w.packaging.sounds, []);
  // A source chosen in the project comes before the folder's file.
  const chosen = selectSound(w, 'sound\\fx\\fst\\fst_sprintstop.wav', 'D:\\Work\\stop.wav');
  assert.equal(soundLibrary(chosen, folder)[0].localPath, 'D:\\Work\\stop.wav');
});

test('a sound from another mod chosen with 찾아보기 joins a full mod folder without breaking the project (11-23)', () => {
  // The report: a folder of 500+ sounds filled the saved library, and one more broke the project check.
  let w = project(['sound\\fx\\Other\\picked.wav']);
  const folder = Array.from({length: 600}, (_, i) => ({
    path: `H:\\Mods\\My Mod\\sound\\fx\\s${i}.wav`,
    file: `sound\\fx\\s${i}.wav`,
  }));
  w = selectSound(w, 'sound\\fx\\Other\\picked.wav', 'H:\\Mods\\Other Mod\\sound\\fx\\Other\\picked.wav');
  assert.equal(w.packaging.sounds.length, 1);
  assert.equal(soundLibrary(w, folder).length, 601);
  assert.ok(
    !validateWorkspace(w).some(i => i.level === 'error' && i.node === 'project' && /소리|패키지/.test(i.message))
  );
  // More than the project may remember says so.
  for (let i = 0; i < 500; i++) w = selectSound(w, `sound\\fx\\x${i}.wav`, `D:\\x${i}.wav`);
  const [issue] = validateWorkspace(w).filter(i => i.node === 'project');
  assert.match(issue.message, /소리 파일이 500개를 넘습니다/);
});

test("opening an XML takes the folder's unused sounds an earlier editor saved out of the project", async () => {
  let w = project(['sound\\fx\\used.wav']);
  w = selectSound(w, 'sound\\fx\\used.wav', 'H:\\Mods\\My Mod\\sound\\fx\\used.wav');
  w = selectSound(w, 'sound\\fx\\held.wav', 'H:\\Mods\\My Mod\\sound\\fx\\held.wav');
  w = selectSound(w, 'sound\\fx\\elsewhere.wav', 'D:\\Work\\sound\\fx\\elsewhere.wav');
  const besideOnly = async paths => paths.map(path => !path.includes('elsewhere') || path.startsWith('D:'));
  const r = await connectXmlAssets(w, xml, resolver, besideOnly);
  assert.equal(r.sounds.folded, 1);
  // Used, or chosen from outside the mod folder: kept.
  assert.deepEqual(
    r.workspace.packaging.sounds.map(s => s.file),
    ['sound\\fx\\used.wav', 'sound\\fx\\elsewhere.wav']
  );
});

test("an XML in the game's Data folder lists no folder sounds", () => {
  assert.equal(soundFolder('H:/Mods/My Mod/SKSE/Plugins/AnimationInjector/X/X.xml'), 'H:/Mods/My Mod');
  assert.equal(soundFolder('C:\\Steam\\Skyrim Special Edition\\Data\\SKSE\\Plugins\\AnimationInjector\\X\\X.xml'), '');
  assert.equal(soundFolder('C:/Steam/Skyrim/DATA/SKSE/Plugins/AnimationInjector/X.xml'), '');
  assert.equal(soundFolder('H:/Mods/My Mod/X.xml'), '');
  assert.equal(soundFolder('H:/Mods/../SKSE/Plugins/AnimationInjector/X.xml'), '');
});
