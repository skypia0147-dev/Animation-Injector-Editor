import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {emptyWorkspace, addAction, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {switchActionKind} from '../src/actionTypes.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {doAttrs, functionParts, functionErrors, registryPart, valuePart} from '../src/eventRegistry.ts';
import {checker, needsChecker} from './local.mjs';

// The strike (runtime 0.12.293, docs/mockup-strike): whom it hits and how, the engine's damage times a ratio or a
// fixed amount, an area's radius, angle, height and falloff, and a window.
test('a strike writes only what differs from the runtime defaults', () => {
  assert.deepEqual(
    doAttrs({op: 'strike', at: '0.4', pick: 'combatTarget', hand: 'right', block: 'vanilla', ratio: '1.5'}, true),
    {at: '0.4', op: 'strike', ratio: '1.5'}
  );
  // A fixed amount replaces the ratio, and only an area keeps the area's settings.
  assert.deepEqual(
    doAttrs({op: 'strike', at: '0.4', pick: 'partner', amount: '25', ratio: '2', radius: '300', hit: 'all'}, true),
    {at: '0.4', op: 'strike', pick: 'partner', amount: '25'}
  );
  assert.deepEqual(
    doAttrs(
      {op: 'strike', at: '0', pick: 'area', radius: '250', angle: '360', hit: 'all', edge: '0.4', duration: '0.4'},
      true
    ),
    {at: '0', op: 'strike', pick: 'area', hit: 'all', radius: '250', angle: '360', edge: '0.4', duration: '0.4'}
  );
});
test('a registered strike keeps whom and how; each node keeps its numbers', () => {
  const v = {op: 'strike', pick: 'area', hit: 'all', hand: 'both', block: 'ignore', radius: '250', ratio: '1.2'};
  assert.deepEqual(registryPart(v), {op: 'strike', pick: 'area', hit: 'all', hand: 'both', block: 'ignore'});
  assert.deepEqual(valuePart(v), {op: 'strike', radius: '250', ratio: '1.2'});
});
test('a strike says its area, its damage and its window', () => {
  assert.deepEqual(
    functionParts({op: 'strike', pick: 'area', angle: '360', radius: '250', ratio: '1.2', duration: '0.4'}),
    ['범위 360° 250', '무기 120%', '0.4초 동안']
  );
  assert.deepEqual(functionParts({op: 'strike', pick: 'partner', amount: '25'}), ['페어 상대', '고정 25']);
});
test('a strike refuses both damages, area settings without an area and its settings elsewhere', () => {
  assert.equal(functionErrors({op: 'strike', ratio: '1', amount: '5'}).length, 1);
  assert.equal(functionErrors({op: 'strike', at: '0.3', radius: '200'}, true).length, 1);
  // A node's numbers do not know the registry's pick.
  assert.deepEqual(functionErrors({op: 'strike', radius: '200'}), []);
  assert.equal(functionErrors({op: 'strike', pick: 'north'}).length, 1);
  assert.equal(functionErrors({op: 'strike', angle: '400'}).length, 1);
  assert.equal(functionErrors({op: 'ragdoll', pick: 'area'}).length, 1);
  assert.equal(functionErrors({op: 'hide', ratio: '1'}).length, 1);
  assert.deepEqual(functionErrors({op: 'strike', at: '0.3', pick: 'area', radius: '200', edge: '0.4'}, true), []);
});
test('clip-time strikes compile, pass the runtime and open again', needsChecker, () => {
  let w = emptyWorkspace();
  w.actions.push(addAction(w));
  w.actions.push(addAction(w));
  w = switchActionKind(w, w.actions[1].uid, 'pair');
  const own = w.actions[0],
    pair = w.actions[1];
  own.config.steps[0].clip = 'Animations/Spin.hkx';
  pair.config.steps[0].clip = 'Animations/Stomp.hkx';
  const spin = {
    op: 'strike',
    at: '0.2',
    pick: 'area',
    radius: '250',
    angle: '360',
    duration: '0.4',
    ratio: '1.2',
    reaction: 'stagger',
    strength: '0.8',
    without: 'poison,hitEvent',
  };
  const stomp = {
    op: 'strike',
    at: '0.42',
    target: 'initiator',
    pick: 'partner',
    ratio: '1.5',
    block: 'ignore',
    reaction: 'push',
    force: '8',
  };
  own.config.effects = [{id: 'spin', values: {...spin}}];
  pair.pair.effects.push({id: 'stomp', values: {...stomp}});
  assert.deepEqual(
    validateWorkspace(w)
      .filter(x => x.level === 'error')
      .map(x => x.message),
    []
  );
  const xml = compileWorkspace(w);
  assert.match(xml, /<Do at="0.2" op="strike"[^>]* pick="area"[^>]* radius="250" angle="360"/);
  assert.match(xml, /<Do at="0.42" op="strike" target="initiator"[^>]* pick="partner" block="ignore" ratio="1.5"/);
  const dir = resolve('tests/generated/strike');
  mkdirSync(dir, {recursive: true});
  writeFileSync(resolve(dir, 'strike.xml'), xml);
  const r = spawnSync(checker, [resolve(dir, 'strike.xml')], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const back = importWorkspaceXml(xml);
  assert.deepEqual(
    back.actions.find(a => !a.pair && a.config.effects?.length).config.effects.map(e => e.values),
    [spin]
  );
  assert.deepEqual(
    back.actions.find(a => a.pair).pair.effects.map(e => e.values),
    [stomp]
  );
});

// After the damage (runtime 0.12.294): a reaction and what a real hit brings along.
test('a strike writes its reaction, its strength or force, and what it leaves out in order', () => {
  assert.deepEqual(
    doAttrs(
      {op: 'strike', at: '0', reaction: 'stagger', strength: '0.5', force: '9', without: 'hitEvent,poison'},
      true
    ),
    {at: '0', op: 'strike', reaction: 'stagger', without: 'poison,hitEvent'}
  );
  assert.deepEqual(doAttrs({op: 'strike', at: '0', reaction: 'push', force: '8', strength: '0.3'}, true), {
    at: '0',
    op: 'strike',
    reaction: 'push',
    force: '8',
  });
  assert.deepEqual(doAttrs({op: 'strike', at: '0', reaction: 'none', without: ''}, true), {at: '0', op: 'strike'});
  const v = {op: 'strike', reaction: 'stagger', without: 'impact', strength: '0.8'};
  assert.deepEqual(registryPart(v), {op: 'strike', reaction: 'stagger', without: 'impact'});
  assert.deepEqual(valuePart(v), {op: 'strike', strength: '0.8'});
  assert.deepEqual(functionParts({op: 'strike', pick: 'partner', reaction: 'push'}), ['페어 상대', '밀쳐내기']);
});
test('a strike refuses a strength without a stagger, a force without a push, and unknown extras', () => {
  assert.equal(functionErrors({op: 'strike', at: '0', strength: '0.5'}, true).length, 1);
  assert.equal(functionErrors({op: 'strike', at: '0', reaction: 'stagger', strength: '2'}, true).length, 1);
  assert.equal(functionErrors({op: 'strike', at: '0', reaction: 'stagger', force: '3'}, true).length, 1);
  assert.equal(functionErrors({op: 'strike', without: 'blood'}).length, 1);
  assert.equal(functionErrors({op: 'hide', without: 'poison'}).length, 1);
  // A node's numbers do not know the registry's reaction; a push's force is a strike's too.
  assert.deepEqual(functionErrors({op: 'strike', force: '8'}), []);
  assert.deepEqual(functionErrors({op: 'strike', at: '0', reaction: 'push', force: '8'}, true), []);
});
