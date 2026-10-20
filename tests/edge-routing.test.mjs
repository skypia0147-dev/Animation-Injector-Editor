import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getBezierPath, Position} from '@xyflow/react';
import {connectionPath, forwardRoute, returnLane} from '../src/graph/edgeRouting.ts';

const endpoints = (sourceY, targetY) => ({
  sourceX: 2380,
  sourceY,
  targetX: 1100,
  targetY,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
});

function points(path) {
  const tokens = path.match(/[MLQC]|-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi);
  let i = 0,
    start;
  const result = [],
    point = () => ({x: Number(tokens[i++]), y: Number(tokens[i++])});
  while (i < tokens.length) {
    const op = tokens[i++],
      controls = op === 'Q' ? [point()] : op === 'C' ? [point(), point()] : [],
      end = point();
    if (op === 'M') result.push(end);
    else
      for (let j = 1; j <= 40; j++) {
        const t = j / 40,
          u = 1 - t;
        const [c1, c2] = controls;
        const at = k =>
          controls.length === 2
            ? u * u * u * start[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * end[k]
            : controls.length === 1
              ? u * u * start[k] + 2 * u * t * c1[k] + t * t * end[k]
              : u * start[k] + t * end[k];
        result.push({x: at('x'), y: at('y')});
      }
    start = end;
  }
  return result;
}

// The tightest turn along a sampled path: the circle through three consecutive samples.
function tightestTurn(samples) {
  let min = Infinity;
  for (let i = 2; i < samples.length; i++) {
    const [a, b, c] = [samples[i - 2], samples[i - 1], samples[i]];
    const ab = Math.hypot(b.x - a.x, b.y - a.y),
      bc = Math.hypot(c.x - b.x, c.y - b.y),
      ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 > 1e-9) min = Math.min(min, (ab * bc * ca) / (2 * area2));
  }
  return min;
}

test('forward connections retain the original curve', () => {
  const p = {...endpoints(100, 500), sourceX: 0};
  assert.deepEqual(connectionPath(p), getBezierPath(p));
});

test('return edges curve around outside both endpoint nodes, without corners, retracing or long outward spikes', () => {
  // Includes the Grapple stage return (39 units apart), equal rows, almost
  // equal rows, tall nodes, distant rows and both vertical directions.
  for (const [sourceTop, sourceHeight, targetTop, targetHeight, sy, ty] of [
    [225, 152, 288, 160, 303, 342],
    [100, 160, 100, 160, 154, 154],
    [100, 160, 100, 160, 154, 154.01],
    [100, 1200, 200, 160, 154, 254],
    [100, 160, 600, 160, 154, 654],
    [600, 160, 100, 160, 654, 154],
  ]) {
    const s = {top: sourceTop, bottom: sourceTop + sourceHeight};
    const t = {top: targetTop, bottom: targetTop + targetHeight};
    const p = endpoints(sy, ty),
      [path] = connectionPath(p, returnLane(s, t)),
      samples = points(path);
    assert.deepEqual(samples[0], {x: p.sourceX, y: sy});
    assert.deepEqual(samples.at(-1), {x: p.targetX, y: ty});
    let eastToWest = 0,
      westToEast = 0,
      lastDir = 1;
    for (let i = 0; i < samples.length; i++) {
      const q = samples[i];
      assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
      assert.ok(q.x <= p.sourceX + 60.001 && q.x >= p.targetX - 60.001);
      assert.ok(!(q.x > p.sourceX - 260 && q.x < p.sourceX && q.y > s.top && q.y < s.bottom));
      assert.ok(!(q.x > p.targetX && q.x < p.targetX + 260 && q.y > t.top && q.y < t.bottom));
      if (!i) continue;
      const prev = samples[i - 1],
        dx = q.x - prev.x,
        dy = q.y - prev.y;
      assert.ok(Math.hypot(dx, dy) > 0, 'no zero-length or folded-back segment');
      if (Math.abs(dx) > 1e-7) {
        const dir = Math.sign(dx);
        if (lastDir !== dir) {
          assert.ok(Math.abs(dy) > 0, 'turns must have vertical separation');
          if (dir < 0) eastToWest++;
          else westToEast++;
        }
        lastDir = dir;
      }
    }
    assert.equal(eastToWest, 1);
    assert.equal(westToEast, 1);
    // Curves, not right angles with rounded corners (the old route turned at a radius under 12).
    assert.ok(tightestTurn(samples) >= 20, `tightest turn ${tightestTurn(samples).toFixed(1)}`);
  }
});

test('return routing follows moved/resized nodes and has a safe unmeasured fallback', () => {
  const p = endpoints(154, 154);
  const lane = returnLane({top: 100, bottom: 260}, {top: 100, bottom: 260});
  assert.equal(lane, 76);
  assert.equal(returnLane({top: 600, bottom: 760}, {top: 600, bottom: 760}), lane + 500);
  assert.equal(returnLane({top: 100, bottom: 260}, {top: 600, bottom: 760}), 430);
  assert.equal(returnLane({top: 100, bottom: 500}, {top: 600, bottom: 760}), 550);
  const [path] = connectionPath(p);
  assert.ok(points(path).some(q => Math.abs(q.y - p.sourceY) >= 36));
});

// Long forward lines (docs/mockup-arrange-c, B): one bus left of the target column, around the cards between.
const forward = (sourceX, sourceY, targetX, targetY) => ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
});
const box = (id, x, y, w = 260, h = 160) => ({id, x, y, w, h});
function clearOf(samples, boxes) {
  for (const q of samples)
    for (const b of boxes)
      assert.ok(!(q.x > b.x && q.x < b.x + b.w && q.y > b.y && q.y < b.y + b.h), `passes ${b.id} at ${q.x},${q.y}`);
}

test('short and backward lines keep their curves; a long line with nothing in the way runs along the bus', () => {
  const s = box('s', 0, 0),
    t = box('t', 900, 400);
  assert.equal(forwardRoute(forward(260, 54, 360, 454), [s, {...t, x: 360}], 's', 't'), undefined);
  assert.equal(forwardRoute(forward(900, 54, 100, 454), [s, t], 's', 't'), undefined);
  const p = forward(260, 54, 900, 454),
    route = forwardRoute(p, [s, t], 's', 't');
  assert.deepEqual(route, {x: 852});
  const samples = points(connectionPath(p, undefined, route)[0]);
  assert.deepEqual(samples[0], {x: 260, y: 54});
  assert.deepEqual(samples.at(-1), {x: 900, y: 454});
  assert.ok(samples.every(q => q.x <= 900 && q.x >= 260));
  assert.ok(tightestTurn(samples) >= 20, `tightest turn ${tightestTurn(samples).toFixed(1)}`);
  // Every line into the column shares the one bus.
  assert.equal(forwardRoute(forward(260, 300, 900, 120), [s, t], 's', 't').x, route.x);
});

test('a long line with cards in its way rises in the first free gap to a lane above them', () => {
  const s = box('s', 0, 300),
    t = box('t', 1400, 200),
    tall = box('tall', 400, 120, 380, 500),
    row = box('row', 860, 280);
  const p = forward(260, 354, 1400, 254),
    route = forwardRoute(p, [s, t, tall, row], 's', 't');
  assert.ok(route.gutter > 260 && route.gutter < 400, 'rises in the gap right of the source');
  assert.ok(route.lane < 120, 'the lane is above the cards between');
  const samples = points(connectionPath(p, undefined, route)[0]);
  assert.deepEqual(samples[0], {x: 260, y: 354});
  assert.deepEqual(samples.at(-1), {x: 1400, y: 254});
  clearOf(samples, [tall, row]);
  assert.ok(tightestTurn(samples) >= 20, `tightest turn ${tightestTurn(samples).toFixed(1)}`);
  // Nearly level and clear: one gentle S, no tight corners.
  const level = forward(260, 54, 1400, 80),
    flat = forwardRoute(level, [box('s', 0, 0), t], 's', 't');
  assert.ok(tightestTurn(points(connectionPath(level, undefined, flat)[0])) >= 20);
});
test('a nearby target past a card on its row turns in the first free gap and runs level into it', () => {
  // A condition's fail into an HKX two columns on, a row above: the pass HKX sits on the condition's row.
  const s = box('s', 0, 300, 380, 420),
    pass = box('pass', 444, 300, 380, 196),
    above = box('above', 444, 0, 380, 196),
    t = box('t', 888, 200, 380, 196);
  const p = forward(380, 400, 888, 254),
    route = forwardRoute(p, [s, pass, above, t], 's', 't');
  assert.ok(route.x > 380 && route.x < 444 && route.lane === undefined, JSON.stringify(route));
  const samples = points(connectionPath(p, undefined, route)[0]);
  clearOf(samples, [pass, above]);
  assert.deepEqual(samples.at(-1), {x: 888, y: 254});
});
