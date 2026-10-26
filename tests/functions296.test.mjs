import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {emptyWorkspace, addAction, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {doAttrs, functionErrors, functionParts} from '../src/eventRegistry.ts';
import {checker, needsChecker} from './local.mjs';

// A sound, a global and a mod event (runtime 0.12.296), and node numbers for registered functions.
test('a sound, a global and a mod event write only what differs from the defaults', () => {
  assert.deepEqual(doAttrs({op: 'sound', at: '0', file: 'sound\\fx\\a.wav', bone: 'spine', volume: '1'}, true), {
    at: '0',
    op: 'sound',
    file: 'sound\\fx\\a.wav',
  });
  // A file replaces a registered sound.
  assert.deepEqual(doAttrs({op: 'sound', file: 'a.wav', plugin: 'a.esp', form: '1', bone: 'head'}), {
    op: 'sound',
    file: 'a.wav',
    bone: 'head',
  });
  assert.deepEqual(doAttrs({op: 'modEvent', name: 'X', number: '0'}), {op: 'modEvent', name: 'X'});
  assert.deepEqual(doAttrs({op: 'globalSet', plugin: 'a.esp', form: '1', value: '0', restore: 'end'}), {
    op: 'globalSet',
    plugin: 'a.esp',
    form: '1',
    value: '0',
    restore: 'end',
  });
  assert.deepEqual(functionParts({op: 'globalSet', value: '2', restore: 'end'}), ['= 2', '끝나면 되돌림']);
});
test('a sound needs one source, a mod event a name; their settings stay theirs', () => {
  assert.equal(functionErrors({op: 'sound', at: '0'}, true).length, 1);
  assert.equal(functionErrors({op: 'sound', at: '0', file: 'a.wav', plugin: 'a.esp', form: '1'}, true).length, 1);
  assert.equal(functionErrors({op: 'sound', at: '0', file: 'C:\\a.wav'}, true).length, 1);
  assert.equal(functionErrors({op: 'sound', at: '0', file: 'a.wav', bone: 'tail'}, true).length, 1);
  assert.deepEqual(functionErrors({op: 'sound', at: '0', file: 'sound\\fx\\a.wav'}, true), []);
  assert.equal(functionErrors({op: 'modEvent', at: '0'}, true).length, 1);
  assert.equal(functionErrors({op: 'hide', at: '0', name: 'X'}, true).length, 1);
  assert.equal(functionErrors({op: 'hide', at: '0', restore: 'end'}, true).length, 1);
  assert.equal(functionErrors({op: 'globalSet', at: '0', value: '1'}, true).length, 2);
});
test(
  'registered functions with node numbers and clip-time functions pass the runtime and open again',
  needsChecker,
  () => {
    const w = emptyWorkspace();
    w.actions.push(addAction(w));
    const a = w.actions[0];
    a.config.steps[0].clip = 'Animations/Test.hkx';
    const clip = [
      {op: 'sound', at: '0.1', file: 'sound\\fx\\mymod\\whoosh.wav', bone: 'rightHand', volume: '0.5'},
      {op: 'globalSet', at: '0.2', plugin: 'MyMod.esp', form: '801', value: '2', restore: 'end'},
      {op: 'modEvent', at: '0.3', name: 'MyMod_Hit', text: 'heavy', number: '3'},
    ];
    a.config.effects = clip.map((values, i) => ({id: 'effect' + i, values: {...values}}));
    w.eventRegistry = [
      {id: 'event1', name: 'Sweep', functions: [{id: 'fn1', values: {op: 'strike', pick: 'area', reaction: 'push'}}]},
      {
        id: 'event2',
        name: 'Whoosh',
        functions: [{id: 'fn1', values: {op: 'sound', plugin: 'Skyrim.esm', form: '3C7BA'}}],
      },
    ];
    a.config.eventValues = {
      'event1/fn1': {op: 'strike', radius: '250', angle: '360', edge: '0.4', force: '8'},
      'event2/fn1': {op: 'sound', volume: '0.7'},
    };
    assert.deepEqual(
      validateWorkspace(w)
        .filter(x => x.level === 'error')
        .map(x => x.message),
      []
    );
    const xml = compileWorkspace(w);
    assert.match(xml, /<Do at="0.1" op="sound" file="sound\\fx\\mymod\\whoosh.wav" bone="rightHand" volume="0.5"\/>/);
    assert.match(xml, /<Do op="strike"[^>]* radius="250"/);
    const dir = resolve('tests/generated/functions296');
    mkdirSync(dir, {recursive: true});
    writeFileSync(resolve(dir, 'functions.xml'), xml);
    const r = spawnSync(checker, [resolve(dir, 'functions.xml')], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const back = importWorkspaceXml(xml);
    const b = back.actions[0];
    assert.deepEqual(
      b.config.effects.map(e => e.values),
      clip
    );
    assert.deepEqual(Object.values(b.config.eventValues ?? {}), [
      {op: 'strike', radius: '250', angle: '360', edge: '0.4', force: '8'},
      {op: 'sound', volume: '0.7'},
    ]);
    assert.equal(compileWorkspace(back), xml);
  }
);
