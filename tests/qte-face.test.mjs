import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qteFaceMode, qteKeyName, qteLook, pressSeconds} from '../src/qteFace.ts';
import {newQte} from '../src/qte.ts';
import {emptyWorkspace} from '../src/workspace.ts';

// Runtime 0.12.245 ui/QteFace.h draws the same (tests/QteFace.cpp checks the same points).
const rule = patch => ({...newQte(emptyWorkspace()), ...patch});
test('the circle and a one-press QTE show the key themselves; other kinds keep their hint line', () => {
  assert.equal(qteFaceMode(rule({type: 'splitArc'})), 'circle');
  assert.equal(qteFaceMode(rule({type: 'rapidPress', pressCount: 1})), 'single');
  assert.equal(qteFaceMode(rule({type: 'rapidPress', pressCount: 2})), 'hint');
  assert.equal(qteFaceMode(rule({type: 'timingBar'})), 'hint');
});
test('a one-press QTE plays its press when pressed and is gone at once when not', () => {
  const q = rule({type: 'rapidPress', pressCount: 1});
  assert.deepEqual(qteLook(q, null, 0), {scale: 1, alpha: 1, flash: 0});
  const down = qteLook(q, 'success', 0.03);
  assert.ok(down.scale < 1 && down.alpha === 1 && down.flash > 0.4);
  const up = qteLook(q, 'perfect', 0.3);
  assert.ok(up.scale > 1 && up.alpha > 0 && up.alpha < 1 && up.flash === 0);
  assert.equal(qteLook(q, 'success', pressSeconds + 0.01).alpha, 0);
  assert.equal(qteLook(q, 'failure', 0).alpha, 0);
  const calm = qteLook({...q, reducedMotion: true}, 'success', 0.1);
  assert.ok(calm.scale === 1 && calm.alpha > 0 && calm.alpha < 1);
});
test('QTE keys are named as the game names them; a mouse button is LMB, RMB or MMB (runtime 0.12.258)', () => {
  assert.deepEqual(['Mouse1', 'Mouse2', 'mouse3', 'E', 'Space', 'Tab', 'code:300', ''].map(qteKeyName), [
    'LMB',
    'RMB',
    'MMB',
    'E',
    'Space',
    'Key 15',
    'Key 300',
    '',
  ]);
});
