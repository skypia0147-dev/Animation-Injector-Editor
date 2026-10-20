import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shareUnchanged} from '../src/graph/historySharing.ts';

// Structural sharing of the history and the rendered document (docs/수정-성능-2026-09-30.md): equal parts
// come back as the previous objects, a changed part as a new object holding the unchanged ones.
test('shareUnchanged: equal parts keep the previous objects', () => {
  const previous = {a: {x: 1, list: [1, {y: 2}]}, b: [{z: 3}, {z: 4}], c: 'text'};
  assert.equal(shareUnchanged(previous, structuredClone(previous)), previous);
  const next = structuredClone(previous);
  next.b[1].z = 5;
  const shared = shareUnchanged(previous, next);
  assert.deepEqual(shared, next);
  assert.notEqual(shared, previous);
  assert.equal(shared.a, previous.a);
  assert.equal(shared.b[0], previous.b[0]);
  assert.notEqual(shared.b[1], previous.b[1]);
  assert.equal(next.b[0].z, 3, 'the next value is not changed in place');
  assert.notEqual(next.a, previous.a);
});

test('shareUnchanged: added, removed and undefined keys, lengths and kinds', () => {
  const previous = {a: 1, b: undefined, list: [1, 2, 3]};
  // A key present only on one side (even as undefined) is a change.
  assert.deepEqual(Object.keys(shareUnchanged(previous, {a: 1, list: [1, 2, 3]})), ['a', 'list']);
  const added = {a: 1, b: undefined};
  assert.equal(shareUnchanged({a: 1}, added), added);
  const fewer = shareUnchanged(previous, {a: 1, b: undefined, list: [1, 2]});
  assert.deepEqual(fewer.list, [1, 2]);
  const more = shareUnchanged(previous, {a: 1, b: undefined, list: [1, 2, 3, 4]});
  assert.deepEqual(more.list, [1, 2, 3, 4]);
  assert.equal(shareUnchanged(previous, {...previous, list: previous.list}), previous);
  // An array and a record with the same keys are not equal.
  const record = {0: 1, 1: 2, 2: 3};
  assert.equal(shareUnchanged(previous.list, record), record);
  assert.equal(shareUnchanged(null, record), record);
  assert.equal(shareUnchanged(record, 'x'), 'x');
  assert.ok(Number.isNaN(shareUnchanged(NaN, NaN)));
});
