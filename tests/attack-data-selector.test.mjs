import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attackDataOptions} from '../src/attackData.ts';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';

function sample() {
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].config.actionId = 'test';
  return w;
}

test('Dropdown preserves custom names and exact casing across project reload', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.attack = 'MyMod_Attack';
  a.config.steps[0].attack = 'AttackStart';
  const reloaded = parseWorkspace(JSON.stringify(captureGraph(w)));
  const options = attackDataOptions(reloaded, 'ExternalValue');
  assert.deepEqual(options.custom, ['AttackStart', 'ExternalValue', 'MyMod_Attack']);
  assert.ok(options.human.some(a => a.name === 'attackStart'));
  assert.ok(compileWorkspace(reloaded).includes('attack="AttackStart"'));
});

test('Clearing clip override restores default; clearing both removes attack assignment', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.attack = 'attackStart';
  a.config.steps[0].attack = 'attackPowerStartInPlace';
  assert.ok(compileWorkspace(w).includes('attack="attackPowerStartInPlace"'));
  a.config.steps[0].attack = '';
  assert.ok(compileWorkspace(w).includes('attack="attackStart"'));
  a.config.attack = '';
  assert.ok(!compileWorkspace(w).includes('<Attack '));
});
