import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleNodePosition} from '../src/graph/placement.ts';
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
