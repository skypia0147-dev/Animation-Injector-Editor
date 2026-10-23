import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rulerTicks} from '../src/timeline/ruler.ts';

// docs/mockup-layout-audit ②: the labels never come closer than the minimum gap.
test('a narrow lane takes a coarser round step', () => {
  const wide = rulerTicks(0, 1.25, 900),
    narrow = rulerTicks(0, 1.25, 240);
  assert.deepEqual(
    wide.ticks.map(t => t.text),
    ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.1', '1.2']
  );
  assert.deepEqual(
    narrow.ticks.map(t => t.text),
    ['0.00', '0.25', '0.50', '0.75', '1.00', '1.25']
  );
  for (const {ticks} of [wide, narrow])
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].left > ticks[i - 1].left);
});

test('labels keep the minimum gap at any width', () => {
  for (const width of [120, 200, 333, 480, 777, 1400])
    for (const limit of [0.4, 1.25, 3.7, 12, 95]) {
      const {ticks} = rulerTicks(0, limit, width);
      for (let i = 1; i < ticks.length; i++)
        assert.ok(((ticks[i].left - ticks[i - 1].left) / 100) * width >= 44 - 1e-6, `${width} ${limit}`);
    }
});

test('ticks start at the first round value after the start; only the label at the end is drawn leftward', () => {
  const {ticks} = rulerTicks(0.3, 1, 300);
  assert.equal(ticks[0].text, '0.50');
  assert.ok(Math.abs(ticks[0].left - 20) < 1e-9);
  assert.equal(ticks.at(-1).text, '1.25');
  assert.deepEqual(
    ticks.map(t => t.end),
    ticks.map((_, i) => i === ticks.length - 1)
  );
  assert.deepEqual(
    rulerTicks(0, 2, 200).ticks.map(t => t.text),
    ['0.0', '0.5', '1.0', '1.5', '2.0']
  );
});
