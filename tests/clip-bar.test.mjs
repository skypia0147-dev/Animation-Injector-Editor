import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  atEnd,
  barSeconds,
  barText,
  barToEndMark,
  barToExit,
  barToMark,
  exitToBar,
  markToBar,
  readTyped,
  settle,
  snapTime,
} from '../src/graph/clipBar.ts';
import {mark} from '../src/model.ts';
import {doAttrs, functionParts, functionErrors} from '../src/eventRegistry.ts';

// The one-line clip bar (docs/mockup-clip-bar): values as text, 「끝」 instead of 「끝나기 전」, snapping to ticks.
test('a bar time is seconds from the start or 「끝」; an older end-relative one needs the length', () => {
  assert.equal(barSeconds(0.4), 0.4);
  assert.equal(barSeconds(atEnd, 2), 2);
  assert.equal(barSeconds({end: 0.2}, 2), 1.8);
  assert.equal(barSeconds({end: 0.2}), undefined);
  assert.equal(barText(0.45), '0.45초');
  assert.equal(barText(atEnd), '끝');
  assert.equal(barText({end: 0.2}), '끝 − 0.2초');
});
test('a drag settles at 「끝」 at the clip length, else to the hundredth', () => {
  assert.deepEqual(settle(1.999, 2), atEnd);
  assert.equal(settle(1.234, 2), 1.23);
  assert.equal(settle(-1, 2), 0);
});
test('a drag draws to the start, the end and the annotation ticks nearby', () => {
  assert.equal(snapTime(0.66, 2, [0.67], 0.05), 0.67);
  assert.equal(snapTime(1.97, 2, [0.67], 0.05), 2);
  assert.equal(snapTime(0.02, 2, [0.67], 0.05), 0);
  assert.equal(snapTime(1.234, 2, [0.67], 0.05), 1.23);
});
test('a typed value: seconds or 끝/end, nothing else', () => {
  assert.equal(readTyped('0.87'), 0.87);
  assert.equal(readTyped(' 1.5초 '), 1.5);
  assert.deepEqual(readTyped('끝'), atEnd);
  assert.deepEqual(readTyped('END'), atEnd);
  assert.equal(readTyped('abc'), undefined);
  assert.equal(readTyped('-1'), undefined);
  assert.equal(readTyped(''), undefined);
});
test('marks: 「끝」 is the end itself, a time from the start a clip time; never an event', () => {
  assert.deepEqual(markToBar(mark(0.3)), 0.3);
  assert.deepEqual(markToBar(mark(0, 'end')), {end: 0});
  const ev = {...mark(0.4), basis: 'event', event: 'Hit'};
  assert.deepEqual(barToMark(ev, 0.5), {...mark(0.5), fallbackBasis: 'seconds'});
  assert.deepEqual(barToMark(mark(0.5), atEnd), {...mark(0, 'end'), fallbackBasis: 'seconds'});
});
test('the end trigger keeps 0.05 s at 「끝」 and is always counted from the end', () => {
  assert.deepEqual(exitToBar(mark(0.05, 'end')), atEnd);
  assert.deepEqual(exitToBar(mark(0.3, 'end')), {end: 0.3});
  assert.equal(barToExit(mark(0.05, 'end'), atEnd).seconds, 0.05);
  assert.equal(barToExit(mark(0.05, 'end'), 1.5, 2).seconds, 0.5);
  assert.equal(barToExit(mark(0.05, 'end'), 1.99, 2).seconds, 0.05);
  assert.equal(barToExit(mark(0.05, 'end'), 1.5), undefined);
  // A key detection window's close is counted from the end in the project.
  assert.deepEqual(barToEndMark(mark(0, 'end'), 1.6, 2), {...mark(0.4, 'end')});
  assert.deepEqual(barToEndMark(mark(0.4, 'end'), atEnd, 2), {...mark(0, 'end')});
});
test('a ragdoll writes its direction and force and says them; elsewhere they are errors', () => {
  assert.deepEqual(doAttrs({op: 'ragdoll', direction: 'left', force: '7'}), {
    op: 'ragdoll',
    direction: 'left',
    force: '7',
  });
  assert.deepEqual(functionParts({op: 'ragdoll'}), ['아래', '힘 1']);
  assert.deepEqual(functionParts({op: 'ragdoll', direction: 'forward'}), ['앞', '힘 5']);
  assert.deepEqual(functionErrors({op: 'ragdoll', direction: 'north'}).length, 1);
  assert.deepEqual(functionErrors({op: 'ragdoll', force: '21'}).length, 1);
  assert.deepEqual(functionErrors({op: 'hide', direction: 'down'}).length, 1);
  assert.deepEqual(functionErrors({op: 'ragdoll', direction: 'up', force: '2'}), []);
});
