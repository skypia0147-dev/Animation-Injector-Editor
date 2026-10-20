import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  convergeTiming,
  convergeHead,
  convergeUi,
  convergeFocus,
  convergeFlash,
  convergeDesat,
  convergeReach,
  speedForApproach,
  keyScale,
  hash,
  sparkOf,
  ashOf,
} from '../src/qteConverge.ts';
import {qteFaceMode, qteLook} from '../src/qteFace.ts';
import {previewInitial, previewAdvance, previewInput, qteTarget} from '../src/qtePreview.ts';
import {newQte} from '../src/qte.ts';
import {emptyWorkspace} from '../src/workspace.ts';

// Runtime 0.12.246 ui/QteConverge.h draws the same (tests/QteConverge.cpp checks the same points).
const rule = patch => ({...newQte(emptyWorkspace()), ...patch});
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
test('the converging lines are a design of the timing circle only', () => {
  assert.equal(qteFaceMode(rule({design: 'converge'})), 'converge');
  assert.equal(qteFaceMode(rule({})), 'circle');
  assert.equal(qteFaceMode(rule({type: 'timingBar', design: 'converge'})), 'hint');
});
test('the lines meet at the approach time and start from the farther screen edge', () => {
  const q = rule({design: 'converge', speed: speedForApproach(1.4)});
  const t = convergeTiming(q);
  assert.ok(near(t.approach, 1.4, 1e-9) && near(t.total, 1.4 / qteTarget, 1e-9));
  assert.ok(near(convergeHead(q, 1.4), 1, 1e-9));
  assert.equal(convergeReach(1920, 960, 1), 960);
  assert.equal(convergeReach(1920, 600, 2), 660);
});
test('a converging QTE fails once its success window is over, the circle at the end of its run', () => {
  const converge = rule({design: 'converge'}),
    circle = rule({});
  const late = (qteTarget + converge.successWindow) * 2.4 + 0.01;
  assert.equal(previewAdvance(previewInitial(), late, converge).outcome, 'failure');
  assert.equal(previewAdvance(previewInitial(), late, circle).outcome, null);
  const meet = previewAdvance(previewInitial(), qteTarget * 2.4, converge);
  assert.equal(previewInput(meet, converge).outcome, 'perfect');
});
test('the look: darkening in over .3 s, gone at the end of the result, the key dips once on a success', () => {
  const q = rule({design: 'converge', feedback: 1.2});
  assert.ok(near(convergeFocus(q, null, 0, 0.15), 0.375));
  assert.equal(convergeUi(q, 'success', 0.5), 1);
  assert.ok(near(convergeUi(q, 'success', 1.2), 0));
  assert.ok(near(keyScale(q, 'perfect', 0.09), 0.88, 1e-3));
  assert.equal(keyScale(q, 'failure', 0.09), 1);
  assert.equal(keyScale({...q, reducedMotion: true}, 'perfect', 0.09), 1);
  assert.ok(qteLook(q, 'perfect', 0.09).scale < 1);
  assert.ok(near(convergeFlash('perfect', 0.2), 0.1 * Math.exp(-2)));
  assert.equal(convergeFlash('failure', 0), 0);
  assert.ok(near(convergeDesat(0.25), 0.9) && convergeDesat(2.1) === 0);
});
test('the preview draws the particles the game draws', () => {
  // The same numbers in the runtime's tests/QteConverge.cpp.
  assert.equal(hash(7, 3), 0.7062613831367344);
  assert.equal(hash(123456, 240), 0.12778993975371122);
  const spark = sparkOf(7, 3, 'perfect');
  assert.ok(near(spark.vx, -641.6430348996073, 1e-9) && near(spark.life, 0.5125156966736539, 1e-12));
  assert.ok(near(ashOf(7, 5).back, 0.5305424235914228, 1e-12));
});
