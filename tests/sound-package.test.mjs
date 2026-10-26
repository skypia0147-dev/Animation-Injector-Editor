import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, parseWorkspace} from '../src/workspace.ts';
import {
  sounds,
  soundFiles,
  soundLibrary,
  selectSound,
  unregisterSound,
  policy,
  plugins,
  request,
  packageProblems,
} from '../src/package.ts';
import {portable} from '../src/authoring.ts';
import {functionErrors} from '../src/eventRegistry.ts';

// Sound files a function plays go into the mod package like HKX (runtime 0.12.296).
const project = () => {
  const w = emptyWorkspace();
  w.actions.push(addAction(w));
  const a = w.actions[0];
  a.config.steps[0].clip = 'Animations\\Test.hkx';
  a.config.effects = [
    {id: 'e1', values: {op: 'sound', at: '0.1', file: 'sound\\fx\\MyMod\\whoosh.wav'}},
    {id: 'e2', values: {op: 'sound', at: '0.2', file: 'Sound/FX/mymod/WHOOSH.wav'}},
    {id: 'e3', values: {op: 'globalSet', at: '0.3', plugin: 'MyMod.esp', form: '801', value: '1'}},
  ];
  w.eventRegistry = [
    {id: 'event1', name: 'Hit', functions: [{id: 'fn1', values: {op: 'sound', file: 'sound\\fx\\MyMod\\hit.xwm'}}]},
    {id: 'event2', name: 'Bell', functions: [{id: 'fn1', values: {op: 'sound', plugin: 'Bells.esp', form: '3C7BA'}}]},
  ];
  return w;
};

test('the sounds of clip-time functions and registered events, once each', () => {
  assert.deepEqual(soundFiles(project()), ['sound\\fx\\MyMod\\whoosh.wav', 'sound\\fx\\MyMod\\hit.xwm']);
  assert.deepEqual(plugins(project()), ['Bells.esp', 'MyMod.esp']);
});

test('a chosen source and a copy or external choice ride in the request', () => {
  let w = selectSound(project(), 'sound\\fx\\MyMod\\whoosh.wav', 'H:\\Mods\\My\\sound\\fx\\MyMod\\whoosh.wav');
  w = policy(w, 'sound\\fx\\MyMod\\hit.xwm', 'external', '');
  assert.equal(packageProblems(w).length, 1);
  w = policy(w, 'sound\\fx\\MyMod\\hit.xwm', 'external', 'Base Sounds');
  const report = {sounds: [{clip: 'SOUND/fx/mymod/whoosh.wav', sha256: 'abc'}], assets: []};
  assert.deepEqual(request(w, report).sounds, [
    {
      file: 'sound\\fx\\MyMod\\whoosh.wav',
      paths: ['H:\\Mods\\My\\sound\\fx\\MyMod\\whoosh.wav'],
      mode: 'copy',
      dependency: '',
      expectedSha256: 'abc',
    },
    {file: 'sound\\fx\\MyMod\\hit.xwm', paths: [], mode: 'external', dependency: 'Base Sounds', expectedSha256: ''},
  ]);
  // Choosing again replaces the source of the same entry; an empty path forgets it and keeps the entry.
  w = selectSound(w, 'SOUND\\fx\\MyMod\\whoosh.wav', 'D:\\sound\\fx\\MyMod\\whoosh.wav');
  assert.deepEqual(w.packaging.sounds, [
    {file: 'sound\\fx\\MyMod\\whoosh.wav', localPath: 'D:\\sound\\fx\\MyMod\\whoosh.wav'},
  ]);
  const forgot = selectSound(w, 'sound\\fx\\MyMod\\whoosh.wav', '');
  assert.deepEqual(sounds(forgot)[0].paths, []);
  assert.equal(forgot.packaging.sounds.length, 1);
  assert.equal(unregisterSound(forgot, 'SOUND\\FX\\mymod\\whoosh.wav').packaging.sounds.length, 0);
});

test('a library sound no function plays is still packaged and marked unused', () => {
  const w = selectSound(project(), 'Sound\\FX\\FST\\FST_SprintStop.wav', 'H:\\Mod\\Sound\\FX\\FST\\FST_SprintStop.wav');
  const entry = soundLibrary(w).find(s => s.name === 'FST_SprintStop.wav');
  assert.deepEqual([entry.registered, entry.actions, entry.events], [true, [], []]);
  assert.ok(request(w).sounds.some(s => s.file === 'Sound\\FX\\FST\\FST_SprintStop.wav'));
});

test('a sound path the game cannot find is an error before packaging', () => {
  assert.equal(functionErrors({op: 'sound', at: '0', file: 'sound\\fx\\효과\\a.wav'}, true).length, 1);
  assert.deepEqual(functionErrors({op: 'sound', at: '0', file: 'sound\\fx\\a.wav'}, true), []);
});
