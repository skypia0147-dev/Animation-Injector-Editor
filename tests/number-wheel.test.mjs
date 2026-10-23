import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wheelStep} from '../src/ui/details/numberDraft.ts';

// A focused number box's wheel (docs/mockup-layout-fixes ①): its step up or down, ×10 with Shift, within range.
test('one wheel notch moves a number box by its step, ten steps with Shift, never past its range', () => {
  assert.equal(wheelStep(100, 1, 5, false, 0, 360), 105);
  assert.equal(wheelStep(100, -1, 5, true, 0, 360), 50);
  assert.equal(wheelStep(0.1, 1, 0.05, false), 0.15);
  assert.equal(wheelStep(0.3, -1, 0.1, false), 0.2);
  assert.equal(wheelStep(358, 1, 5, false, 0, 360), 360);
  assert.equal(wheelStep(2, -1, 5, true, '0', '600'), 0);
  assert.equal(wheelStep(Number.NaN, 1, 1, false), 1);
});
