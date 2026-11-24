import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction} from '../src/workspace.ts';
import {validate} from '../src/model.ts';

// Power attack data makes the engine take the vanilla power attack's stamina at each hit (HitFrame, measured 11-24):
// a stamina cost on the same action is taken as well, so the card warns.
const warned = p => validate(p).some(i => i.level === 'warning' && /attackPowerStart/.test(i.message));
const action = () => {
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations\\Test.hkx';
  return a.config;
};

test('power attack data with a stamina cost warns of the double cost', () => {
  const p = action();
  p.attack = 'attackPowerStartInPlace';
  assert.ok(!warned(p), 'no cost: the engine takes the stamina alone');
  p.cost = {...p.cost, enabled: true, stamina: 25};
  assert.ok(warned(p), 'cost slot');
  p.cost = {...p.cost, stamina: 0, magicka: 10};
  assert.ok(!warned(p), 'a magicka cost is not taken twice');
  p.cost = {...p.cost, enabled: false};
  p.effects = [{id: 'e1', values: {op: 'cost', at: '0.1', stamina: '20'}}];
  assert.ok(warned(p), 'a cost function at a clip time');
});

test('light attack data, or a clip of its own with power data', () => {
  const p = action();
  p.attack = 'attackStart';
  p.cost = {...p.cost, enabled: true, stamina: 10};
  assert.ok(!warned(p), 'a light attack costs nothing from the engine');
  p.steps[0].attack = 'attackPowerStartForward';
  assert.ok(warned(p), "a clip's own power data");
  p.steps[0].attack = '';
  p.attack = 'bashPowerStart';
  assert.ok(warned(p), 'a power bash');
});
