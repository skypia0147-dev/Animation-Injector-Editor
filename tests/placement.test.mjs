import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dropGrid, visibleNodePosition} from '../src/graph/placement.ts';
test('new nodes stay in a panned zoomed graph panel rather than the window or origin', () => {
  const previous = globalThis.document;
  globalThis.document = {
    querySelector: () => ({getBoundingClientRect: () => ({left: 700, top: 250, right: 1700, bottom: 950})}),
  };
  try {
    const convert = p => ({x: (p.x - 700) / 2 - 3000, y: (p.y - 250) / 2 + 1200});
    for (const point of [undefined, {x: 1699, y: 949}, {x: 0, y: 0}]) {
      const p = visibleNodePosition(convert, point),
        min = convert({x: 724, y: 274}),
        max = convert({x: 1676, y: 926});
      assert.ok(p.x >= min.x && p.y >= min.y);
      assert.ok(p.x + 320 <= max.x && p.y + 120 <= max.y);
    }
  } finally {
    globalThis.document = previous;
  }
});
test('cards dropped together go to a grid clear of every card, not a cascade on each other', () => {
  const size = {w: 380, h: 224},
    overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const empty = dropGrid({x: 0, y: 0}, 6, []);
  assert.deepEqual(empty[1], {x: 420, y: 0});
  assert.deepEqual(empty[4], {x: 0, y: 264});
  // Dropped on an existing card: the whole block moves below it.
  const existing = [{x: 300, y: -50, w: 380, h: 300}];
  const cells = dropGrid({x: 0, y: 0}, 3, existing).map(p => ({...p, ...size}));
  for (const [i, a] of cells.entries()) {
    assert.ok(!overlaps(a, existing[0]), 'clear of the card');
    for (const b of cells.slice(i + 1)) assert.ok(!overlaps(a, b), 'clear of each other');
  }
  assert.equal(new Set(cells.map(c => c.y)).size, 1, 'one row, kept together');
});
