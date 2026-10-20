import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qteLayout, qteBoundsOf, qteKeyWidth, qteResolutions, qteAnchors} from '../src/qteLayout.ts';
import {qteCases} from '../tools/qte-layout-cases.mjs';
const corners = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
test('QTE anchors stay inside every aspect ratio and scale proportionally', () => {
  for (const {bounds: b} of qteCases())
    for (const {width: w, height: h} of [...qteResolutions, {width: 64, height: 4096}, {width: 4096, height: 64}])
      for (const anchor of ['screen', ...Object.keys(qteAnchors)])
        for (const scale of [0.25, 1, 4])
          for (const offset of [-1, 0, 0.15, 1]) {
            const p = qteLayout(w, h, scale, offset, offset, anchor, b),
              d = qteLayout(w * 2, h * 2, scale, offset, offset, anchor, b);
            assert.ok(
              p.unit > 0 && p.x + b.left * p.unit >= p.padding - 1e-8 && p.x + b.right * p.unit <= w - p.padding + 1e-8
            );
            assert.ok(p.y + b.top * p.unit >= p.padding - 1e-8 && p.y + b.bottom * p.unit <= h - p.padding + 1e-8);
            for (const k of ['x', 'y', 'unit', 'padding']) assert.ok(Math.abs(d[k] - p[k] * 2) < 1e-8);
          }
});
test('QTE size changes keep a corner QTE at its corner and a middle QTE in place', () => {
  for (const {name, bounds: b} of qteCases()) {
    for (const anchor of corners) {
      const east = anchor.endsWith('Right'),
        south = anchor.startsWith('bottom');
      for (const scale of [0.5, 1, 1.5]) {
        const p = qteLayout(1920, 1080, scale, 0.05, 0.05, anchor, b),
          gapX = east ? 1920 - (p.x + b.right * p.unit) : p.x + b.left * p.unit,
          gapY = south ? 1080 - (p.y + b.bottom * p.unit) : p.y + b.top * p.unit;
        assert.ok(
          Math.abs(gapX - p.padding - 54) < 1e-8 && Math.abs(gapY - p.padding - 54) < 1e-8,
          `${name} ${anchor}`
        );
      }
    }
    for (const scale of [0.5, 1, 1.5]) {
      const m = qteLayout(1920, 1080, scale, 0.1, -0.1, 'center', b),
        s = qteLayout(1920, 1080, scale, 0.5, 0.5, 'screen', b);
      assert.ok(Math.abs(m.x - 1068) < 1e-8 && Math.abs(m.y - 432) < 1e-8, name);
      assert.ok(s.x === 960 && s.y === 540, name);
    }
  }
});
test('the circle at a corner touches it at every scale (it drifted 54, 94 and 174 pixels away before)', () => {
  const circle = qteBoundsOf('circle', 'splitArc', 0, qteKeyWidth('E'));
  for (const scale of [0.5, 1, 2]) {
    const p = qteLayout(1920, 1080, scale, 0, 0, 'topLeft', circle);
    assert.ok(Math.abs(p.x - 104 * p.unit - p.padding) < 1e-8 && Math.abs(p.y - 104 * p.unit - p.padding) < 1e-8);
  }
  assert.equal(qteBoundsOf('circle', 'splitArc', 0, 250).right, 126);
  assert.equal(qteKeyWidth('E'), 30);
  assert.equal(qteKeyWidth('Space'), 61);
});
test('QTE wide screens preserve center/corner offset and height-relative size', () => {
  const b = qteBoundsOf('circle', 'splitArc', 0, 30);
  for (const anchor of Object.keys(qteAnchors)) {
    const p = qteLayout(1920, 1080, 1, 0.1, 0.1, anchor, b),
      w = qteLayout(3840, 1080, 1, 0.1, 0.1, anchor, b);
    assert.equal(p.y, w.y);
    assert.equal(p.unit, w.unit);
    assert.equal(w.x - p.x, anchor === 'center' ? 960 : anchor.endsWith('Right') ? 1920 : 0);
  }
  const p = qteLayout(1920, 1080, 1, -0.1, -0.1, 'center', b);
  assert.equal(p.x, 852);
  assert.equal(p.y, 432);
  assert.equal(qteLayout(1080, 1920, 4, 0, 0, 'center', b).fitted, true);
  assert.equal(qteLayout(0, 1080, 1, 0, 0, 'screen', b).unit, 0);
  assert.equal(qteLayout(NaN, 1080, 1, 0, 0, 'screen', b).unit, 0);
  assert.equal(qteLayout(1920, 1080, 1, 0, 0, 'screen', {left: 0, top: 0, right: 0, bottom: 0}).unit, 0);
});
