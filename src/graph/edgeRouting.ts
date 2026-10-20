import {getBezierPath, Position} from '@xyflow/react';

export type VerticalSpan = {top: number; bottom: number};
export type EdgeEndpoints = {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
};

const clearance = 24;
export const isReturnEdge = (p: EdgeEndpoints) =>
  p.sourcePosition === Position.Right && p.targetPosition === Position.Left && p.targetX < p.sourceX;

export function returnLane(source: VerticalSpan, target: VerticalSpan): number {
  // Prefer the gap between nodes. Overlapping rows go around their outer bounds.
  if (target.top - source.bottom >= clearance * 2) return (source.bottom + target.top) / 2;
  if (source.top - target.bottom >= clearance * 2) return (target.bottom + source.top) / 2;
  const above = Math.min(source.top, target.top) - clearance;
  const below = Math.max(source.bottom, target.bottom) + clearance;
  const middle = (source.top + source.bottom + target.top + target.bottom) / 4;
  return middle - above <= below - middle ? above : below;
}

// The control length of a turn between a port and the lane: close to a half circle for a short
// turn, at most 80 (the curve then bulges 60 past the port, less than the gap between columns).
const turn = (height: number) => Math.min(80, Math.max(16, Math.abs(height) * 0.66));

export function connectionPath(
  p: EdgeEndpoints,
  lane?: number,
  route?: ForwardRoute
): [string, number, number, number, number] {
  if (!isReturnEdge(p)) return route ? forwardPath(p, route) : getBezierPath(p);
  // A reverse cubic folds back on itself at nearly equal Y coordinates. Its
  // near-parallel segments become visible spikes at low zoom. A return edge
  // instead loops through a lane outside both cards: a curve out of the source
  // to the lane, the lane, a curve from the lane into the target. The pieces
  // join tangentially, so the edge has no corners.
  const {sourceX: sx, sourceY: sy, targetX: tx, targetY: ty} = p;
  const y = lane ?? Math.min(sy, ty) - clearance * 2;
  const ks = turn(y - sy),
    kt = turn(y - ty);
  const path =
    `M${sx},${sy} C${sx + ks},${sy} ${sx + ks},${y} ${sx},${y} L${tx},${y} ` +
    `C${tx - kt},${y} ${tx - kt},${ty} ${tx},${ty}`;
  const labelX = (sx + tx) / 2;
  return [path, labelX, y, Math.abs(labelX - sx), Math.abs(y - sy)];
}

/** A card as the router sees it: its id and its box on the canvas. */
export type Box = {id: string; x: number; y: number; w: number; h: number};
/** A long forward connection: along the bus at `x` (in the gap left of the target), and when cards are in
 *  the way first up the free column gap at `gutter` to the lane above them at `lane`. */
export type ForwardRoute = {x: number; gutter?: number; lane?: number};

// Shorter than a card and a column gap: a curve, as before.
const LONG = 200,
  // The bus runs at most this far left of the target, in the gap before it.
  BUS = 48,
  // A target this close turns in the first free gap right of the source instead of the lane above.
  NEAR = 900,
  // Room kept around a card a line passes, and the turn length of a corner.
  PAD = 12,
  CORNER = 32;

/**
 * The route of a forward connection that crosses at least a card's width (docs/mockup-arrange-c, B): the
 * lines into one column share a vertical bus in the gap left of it, so many sources into many shared cards
 * read as one bundle, not a fan of curves. A line runs level from its source to the bus when nothing is in
 * the way; to a target close by it turns in the first free gap right of its source; otherwise it rises in
 * that gap to a lane above the cards between and runs along it. Undefined: the curve (short, backward, or
 * no free way).
 */
export function forwardRoute(p: EdgeEndpoints, boxes: Box[], source: string, target: string): ForwardRoute | undefined {
  const {sourceX: sx, sourceY: sy, targetX: tx, targetY: ty} = p;
  if (isReturnEdge(p) || tx - sx < LONG) return undefined;
  const others = boxes.filter(b => b.id !== source && b.id !== target);
  // An axis-aligned segment against the cards, each grown by the padding.
  const blocked = (x1: number, y1: number, x2: number, y2: number) =>
    others.some(
      b =>
        Math.max(x1, x2) > b.x - PAD &&
        Math.min(x1, x2) < b.x + b.w + PAD &&
        Math.max(y1, y2) > b.y - PAD &&
        Math.min(y1, y2) < b.y + b.h + PAD
    );
  const spans = (b: Box, top: number, bottom: number) => b.y - PAD < bottom && b.y + b.h + PAD > top;
  // The bus: in the free gap left of the target, at most BUS from it (so a column's lines share one).
  const bus = (top: number, bottom: number) => {
    const left = Math.max(sx, ...others.filter(b => b.x + b.w <= tx && spans(b, top, bottom)).map(b => b.x + b.w));
    return tx - Math.min(BUS, (tx - left) / 2);
  };
  // The first gap right of the source wide enough for a line between `top` and `bottom`, near its middle.
  const gutter = (top: number, bottom: number) => {
    let at = sx;
    for (const b of others.filter(b => b.x + b.w > sx && spans(b, top, bottom)).sort((a, b) => a.x - b.x)) {
      if (b.x + b.w <= at) continue;
      if (b.x - at >= 2 * (PAD + 4)) return Math.min((at + b.x) / 2, at + CORNER + PAD);
      at = b.x + b.w;
    }
    return at + CORNER;
  };
  const x = bus(Math.min(sy, ty), Math.max(sy, ty));
  if (!blocked(sx, sy, x, sy) && !blocked(x, sy, x, ty) && !blocked(x, ty, tx, ty)) return {x};
  const near = gutter(Math.min(sy, ty), Math.max(sy, ty));
  if (tx - near <= NEAR && near < tx - PAD && !blocked(sx, sy, near, sy) && !blocked(near, ty, tx, ty))
    return {x: near};
  const between = others.filter(b => b.x < tx && b.x + b.w > sx);
  const lane = Math.min(sy, ty, ...between.map(b => b.y)) - 2 * PAD - CORNER;
  const up = gutter(lane, sy),
    down = bus(lane, ty);
  if (up > down - CORNER || blocked(down, lane, down, ty) || blocked(down, ty, tx, ty)) return undefined;
  return {x: down, gutter: up, lane};
}

// A polyline with each corner turned along a quadratic curve; the end segments may give a corner their
// whole length, the inner ones half (they turn at both ends).
function rounded(points: [number, number][]): string {
  const list = points.filter((q, i) => !i || Math.hypot(q[0] - points[i - 1][0], q[1] - points[i - 1][1]) > 0.5);
  let d = `M${list[0][0]},${list[0][1]}`;
  for (let i = 1; i < list.length - 1; i++) {
    const [px, py] = list[i - 1],
      [cx, cy] = list[i],
      [nx, ny] = list[i + 1];
    const a = Math.hypot(cx - px, cy - py),
      b = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(CORNER, i === 1 ? a : a / 2, i === list.length - 2 ? b : b / 2);
    d += ` L${cx - ((cx - px) / a) * r},${cy - ((cy - py) / a) * r} Q${cx},${cy} ${cx + ((nx - cx) / b) * r},${cy + ((ny - cy) / b) * r}`;
  }
  const [lx, ly] = list[list.length - 1];
  return d + ` L${lx},${ly}`;
}

function forwardPath(p: EdgeEndpoints, route: ForwardRoute): [string, number, number, number, number] {
  const {sourceX: sx, sourceY: sy, targetX: tx, targetY: ty} = p;
  const {x, gutter, lane} = route;
  if (gutter === undefined || lane === undefined) {
    // Almost level along the bus: one gentle S into the target instead of two tight corners.
    if (Math.abs(ty - sy) < 2 * CORNER && x >= tx - BUS - 0.5) {
      const bend = tx - 160;
      const path = `M${sx},${sy} L${bend},${sy} C${bend + 80},${sy} ${bend + 80},${ty} ${tx},${ty}`;
      return [path, bend, sy, Math.abs(bend - sx), 0];
    }
    const path = rounded([
      [sx, sy],
      [x, sy],
      [x, ty],
      [tx, ty],
    ]);
    return [path, x, (sy + ty) / 2, Math.abs(x - sx), Math.abs(ty - sy) / 2];
  }
  const path = rounded([
    [sx, sy],
    [gutter, sy],
    [gutter, lane],
    [x, lane],
    [x, ty],
    [tx, ty],
  ]);
  return [path, (gutter + x) / 2, lane, Math.abs((gutter + x) / 2 - sx), Math.abs(lane - sy)];
}
