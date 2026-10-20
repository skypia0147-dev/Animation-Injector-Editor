import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSizes, fitSizes, defaultSizes} from '../src/ui/layout.ts';

test('invalid persisted sizes recover and small windows reserve graph space', () => {
  assert.deepEqual(readSizes(null), defaultSizes);
  const s = readSizes({left: 'bad', right: NaN, bottom: Infinity});
  assert.deepEqual(s, defaultSizes);
  for (const width of [900, 1080, 1280, 1600]) {
    for (const height of [628, 728, 888]) {
      const fit = fitSizes(
        {left: 2000, right: 2000, bottom: 2000, viewport: 2000, project: -1},
        width,
        height,
        true,
        true,
        true,
        true
      );
      assert.ok(width - fit.left - fit.right >= 320);
      assert.ok(height - fit.bottom >= 260);
      assert.equal(fit.project, 20);
    }
  }
  const hidden = fitSizes(defaultSizes, 1080, 628, false, false, false, false);
  assert.equal(hidden.left + hidden.right + hidden.bottom + hidden.viewport, 0);
});
