import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spanned, touches, boxMode, boxSelection, toggled} from '../src/graph/marquee.ts';

test('a box picks the cards it touches, whatever the drag direction', () => {
  const card = {x: 100, y: 100, w: 300, h: 200};
  assert.ok(touches(spanned({x: 0, y: 0}, {x: 120, y: 120}), card));
  assert.ok(touches(spanned({x: 500, y: 500}, {x: 390, y: 290}), card));
  assert.ok(touches(spanned({x: 0, y: 150}, {x: 600, y: 160}), card));
  assert.ok(!touches(spanned({x: 0, y: 0}, {x: 99, y: 400}), card));
  assert.ok(!touches(spanned({x: 401, y: 0}, {x: 500, y: 500}), card));
});

test('modifiers: none replaces, Shift adds, Ctrl or Cmd toggles', () => {
  assert.equal(boxMode({shiftKey: false, ctrlKey: false, metaKey: false}), 'replace');
  assert.equal(boxMode({shiftKey: true, ctrlKey: false, metaKey: false}), 'add');
  assert.equal(boxMode({shiftKey: false, ctrlKey: true, metaKey: false}), 'toggle');
  assert.equal(boxMode({shiftKey: true, ctrlKey: false, metaKey: true}), 'toggle');
  assert.deepEqual(boxSelection(['a', 'b'], ['c'], 'replace'), ['c']);
  assert.deepEqual(boxSelection(['a', 'b'], ['b', 'c'], 'add'), ['a', 'b', 'c']);
  assert.deepEqual(boxSelection(['a', 'b'], ['b', 'c'], 'toggle'), ['a', 'c']);
  assert.deepEqual(boxSelection(['a'], [], 'add'), ['a']);
});

test('a modifier click puts a card in or takes it out', () => {
  assert.deepEqual(toggled(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggled(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggled([], 'a'), ['a']);
});
