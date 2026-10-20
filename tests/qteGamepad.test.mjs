import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QteGamepad, standardPadCodes} from '../src/qteGamepad.ts';
import {previewInitial, previewAdvance, previewInput, qteTarget} from '../src/qtePreview.ts';
import {newQte} from '../src/qte.ts';
import {emptyWorkspace} from '../src/workspace.ts';
const sample = (pressed = [], index = 0) => ({
  index,
  id: 'test' + index,
  connected: true,
  mapping: 'standard',
  buttons: Array.from({length: 17}, (_, i) => ({pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0})),
});
test('standard controller buttons map to native Skyrim codes; holds never repeat', () => {
  for (let i = 0; i < standardPadCodes.length; i++) {
    const p = new QteGamepad();
    p.poll([sample()]);
    assert.deepEqual(p.poll([sample([i])]).edges, [{pad: 0, code: standardPadCodes[i], up: false}]);
    assert.deepEqual(p.poll([sample([i])]).edges, []);
    assert.deepEqual(p.poll([sample()]).edges, [{pad: 0, code: standardPadCodes[i], up: true}]);
  }
});
test('pre-held, hotplug, disconnect and nonstandard pads cannot invent presses', () => {
  const p = new QteGamepad();
  assert.deepEqual(p.poll([sample([7])]).edges, []);
  assert.deepEqual(p.poll([sample([7]), sample([0], 1)]).edges, []);
  assert.equal(p.poll([]).disconnected, true);
  assert.deepEqual(p.poll([sample([7])]).edges, []);
  assert.equal(p.poll([{...sample(), mapping: ''}]).connected, false);
});
test('RT analog threshold yields one down and one up', () => {
  const p = new QteGamepad(),
    pad = sample();
  p.poll([pad]);
  pad.buttons[7] = {pressed: false, value: 0.6};
  assert.deepEqual(p.poll([pad]).edges, [{pad: 0, code: 10, up: false}]);
  pad.buttons[7].value = 0.8;
  assert.deepEqual(p.poll([pad]).edges, []);
  pad.buttons[7].value = 0.2;
  assert.deepEqual(p.poll([pad]).edges, [{pad: 0, code: 10, up: true}]);
});
test('controller edges drive timing, hold, rapid and sequence preview judgments', () => {
  for (const type of ['splitArc', 'timingBar', 'rotatingNeedle', 'holdRelease', 'rapidPress', 'keySequence']) {
    const q = newQte(emptyWorkspace());
    q.type = type;
    q.speed = 4;
    q.pressCount = 2;
    q.sequence = [
      {key: '', gamepad: 4096},
      {key: '', gamepad: 8192},
    ];
    let state = previewInitial();
    const tracker = new QteGamepad();
    tracker.poll([sample()]);
    const apply = pressed => {
      for (const edge of tracker.poll([sample(pressed)]).edges) {
        if (edge.up && type !== 'holdRelease') continue;
        state = previewInput(
          state,
          q,
          edge.up,
          type !== 'keySequence' || q.sequence[state.completed]?.gamepad === edge.code
        );
      }
    };
    if (type === 'holdRelease') {
      apply([0]);
      state = previewAdvance(state, qteTarget * 0.6, q);
      apply([]);
    } else if (type === 'rapidPress' || type === 'keySequence') {
      apply([0]);
      apply([]);
      apply([type === 'keySequence' ? 1 : 0]);
    } else {
      state = previewAdvance(state, qteTarget * 0.6, q);
      apply([0]);
    }
    assert.ok(['success', 'perfect'].includes(state.outcome), type);
  }
});
