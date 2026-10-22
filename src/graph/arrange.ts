import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {cardHeight, cardWidth, summaryHeight} from './cardPresentation.ts';

/** The graph `arrange` places: projected nodes (with a measured height where the canvas drew them) and edges. */
export type ArrangeGraph = {nodes: (FlatNode & {measured?: {height?: number}})[]; edges: GraphEdge[]};
export type ArrangeOptions = {
  /** The graph pane: blocks are packed to fill its shape. */
  view?: {w: number; h: number};
  /** HKX cards are drawn as summaries: their summary height replaces the measured one. */
  summary?: boolean;
  /** Lines the canvas does not draw (a wait a QTE's line stands for, graph/qteListen.ts): left out, so the
   *  cards sit where the drawn lines lead. */
  hidden?: Set<string>;
};
export type Arrangement = {
  positions: Record<string, {x: number; y: number}>;
  /** Each block's node ids (a route with everything it reaches), in placement order. */
  blocks: string[][];
  /** The shared stage's cards (empty when the start units share no transition). */
  hub: string[];
};

const GAP_X = 64,
  GAP_Y = 40,
  BLOCK_GAP = 160,
  // Between blocks packed into each other's gaps (docs/mockup-arrange-pack).
  PACK_GAP = 100,
  ORIGIN = 80,
  // With a shared stage: the start units stacked in columns, the hub right of them.
  UNIT_GAP = 80,
  HUB_GAP = 240;
const SPECIAL = new Set(['entry', 'eventRegistry']);
// Drawn after a card's own route: QTE cards last. A QTE started by an event (runtime 0.12.248, its 'qte-event:'
// card before it) is no side card: its event, the QTE and the events it sends are one lane.
const eventQte = (n: FlatNode) => n.kind === 'qte' && n.inputs.length > 0 && eventStarted.has(n.id);
let eventStarted = new Set<string>(),
  routing = new Set<string>();
const qte = (n: FlatNode) => n.kind === 'qte' && !eventQte(n);
const tailRank = (n: FlatNode) => (qte(n) ? 1 : 0);
// A QTE whose results lead on (10-19: an event's transition, another HKX) is a card of the route: HKX → QTE →
// transition → HKX on one row. A QTE that leads nowhere hangs at the side of the blocks that use it.
const shared = (n: FlatNode) => qte(n) && !routing.has(n.id);
// A transition between actions: the event or key that hands one HKX over to the next.
const transition = (n: FlatNode) => n.scope?.kind === 'link';
type Item = {id: string; x: number; y: number};
type Frame = {ids: string[]; items: Item[]; w: number; h: number};

/**
 * Lanes, packed (the arrange of docs/mockup-arrange):
 * - A route reads left to right: input, conditions, HKX, then the HKX's transitions (a transition key, its
 *   blend, the next HKX) on the same row.
 *   Every card of a row is top-aligned with the first card of its route.
 * - A second branch (fail, another transition) starts the next row; a row is as tall as its tallest card.
 * - A route that reaches an HKX already placed (another action's transition into it) joins that block; an
 *   action started both by its own key and by a transition keeps its key just left of the HKX.
 * - Unconnected blocks fill the graph pane's shape, left to right and top to bottom; cards with no
 *   connection at all are one block, last. The entry and the event registry are a column at the far left
 *   (the registry grows with its events).
 * - QTE cards several HKX share go right of the first block that uses them.
 * With a shared stage (docs/mockup-arrange-c, B): what two or more start units reach only through
 * transitions (the transitions, the HKX they lead to, and the QTE cards those units share) is one block, the
 * hub, right of everything else. Each unit is then its own block (its start, conditions and HKX, and what
 * only it reaches), and the units are stacked in the number of columns that fits the pane best. The lines
 * into the hub run as one bus (graph/edgeRouting.ts). Without a shared stage the arrange is the lanes above.
 * Only positions change; the result depends on the routes, not on stored order or coordinates.
 */
export function arrangeLayout(g: ArrangeGraph, options: ArrangeOptions = {}): Arrangement {
  const view = options.view ?? {w: 1180, h: 640};
  if (options.hidden?.size) g = {...g, edges: g.edges.filter(e => !options.hidden!.has(e.id))};
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  eventStarted = new Set(g.nodes.filter(n => n.id.startsWith('qte-event:')).map(n => 'qte:' + n.id.slice(10)));
  const height = (n: FlatNode & {measured?: {height?: number}}) =>
    n.kind === 'hkxPlay' && options.summary ? summaryHeight(n) : cardHeight(n);
  const width = (n: FlatNode) => cardWidth(n);
  const owners = [...new Set(g.nodes.map(n => n.action).filter(Boolean))];
  const compare = (a: FlatNode, b: FlatNode) =>
    owners.indexOf(a.action) - owners.indexOf(b.action) || a.id.localeCompare(b.id, undefined, {numeric: true});
  const out = new Map<string, {to: string; pin: string; rank?: number}[]>(),
    into = new Map<string, Set<string>>();
  for (const e of g.edges) {
    const s = byId.get(e.source),
      t = byId.get(e.target);
    if (!s || !t || SPECIAL.has(s.kind) || SPECIAL.has(t.kind) || s.id === t.id) continue;
    // A branch's fail onto a branch of its own fan (①'s fail to ③) does not pull that branch out of the fan.
    if (s.fan && t.fan && s.fan.parent === t.fan.parent) continue;
    const list = out.get(s.id) ?? [];
    if (!list.some(x => x.to === t.id)) list.push({to: t.id, pin: e.pin, rank: e.rank});
    out.set(s.id, list);
    into.set(t.id, (into.get(t.id) ?? new Set()).add(s.id));
  }
  routing = new Set([...out.keys()].filter(id => byId.get(id)?.kind === 'qte'));
  const children = new Map<string, string[]>();
  for (const [id, list] of out) {
    const ports: string[] = byId.get(id)!.outputs;
    const pinRank = (pin: string) =>
      pin === 'pass' ? 0 : pin === 'fail' ? 1 : ports.indexOf(pin) >= 0 ? ports.indexOf(pin) : ports.length;
    children.set(
      id,
      [...list]
        .sort(
          (a, b) =>
            tailRank(byId.get(a.to)!) - tailRank(byId.get(b.to)!) ||
            pinRank(a.pin) - pinRank(b.pin) ||
            // A fan's branches stand in their stored order (graph/conditionFans.ts), not the cards' places.
            (a.rank ?? 0) - (b.rank ?? 0) ||
            compare(byId.get(a.to)!, byId.get(b.to)!)
        )
        .map(x => x.to)
    );
  }
  const movable = g.nodes.filter(n => !SPECIAL.has(n.kind) && !shared(n)).sort(compare);
  const isolated = movable.filter(n => !out.has(n.id) && !into.has(n.id));
  const connected = movable.filter(n => out.has(n.id) || into.has(n.id));
  const reach = (id: string, enter = (_: FlatNode) => true) => {
    const seen = new Set([id]),
      stack = [id];
    while (stack.length)
      for (const t of children.get(stack.pop()!) ?? [])
        if (!seen.has(t) && enter(byId.get(t)!)) (seen.add(t), stack.push(t));
    return seen;
  };
  // Roots: no incoming route. A cycle with no entrance is entered at its first card.
  const roots = connected.filter(n => !into.has(n.id));
  const covered = new Set(roots.flatMap(r => [...reach(r.id)]));
  for (const n of connected)
    if (!covered.has(n.id)) {
      roots.push(n);
      for (const id of reach(n.id)) covered.add(id);
    }
  const reaches = new Map(roots.map(r => [r.id, reach(r.id)]));
  // Groups of roots whose routes meet, in root order (a root joins the first group it meets).
  const grouped = (sets: Map<string, Set<string>>) => {
    const groups: FlatNode[][] = [];
    for (const r of roots) {
      const hit = groups.find(group => group.some(o => [...sets.get(r.id)!].some(id => sets.get(o.id)!.has(id))));
      if (hit) hit.push(r);
      else groups.push([r]);
    }
    return groups;
  };
  // The hub: what two or more start units reach only through transitions. A unit is a root with the cards
  // it reaches without taking a transition or a QTE; units whose cards meet are one unit.
  // A QTE is never a unit's own card: one several units use belongs to the shared stage with what it leads to.
  const unitReach = new Map(roots.map(r => [r.id, reach(r.id, n => !transition(n) && !qte(n))]));
  const unitOf = new Map(grouped(unitReach).flatMap((u, i) => u.map(r => [r.id, i] as const)));
  const own = new Set([...unitReach.values()].flatMap(set => [...set]));
  const reachedBy = new Map<string, Set<number>>();
  for (const r of roots)
    for (const id of reaches.get(r.id)!)
      if (!own.has(id)) reachedBy.set(id, (reachedBy.get(id) ?? new Set()).add(unitOf.get(r.id)!));
  let hub = new Set([...reachedBy].filter(([, by]) => by.size > 1).map(([id]) => id));
  // QTE cards alone are no shared stage: they stay right of the first block that uses them.
  if ([...hub].every(id => shared(byId.get(id)!))) hub = new Set();
  const outside = (id: string) => !hub.has(id);
  const groups = grouped(new Map(roots.map(r => [r.id, new Set([...reaches.get(r.id)!].filter(outside))])));
  const placed = new Map<string, {col: number; y: number}>();
  // One block in lanes: its roots in order, entering only the cards `inside` accepts.
  const lay = (group: FlatNode[], inside: (id: string) => boolean) => {
    const mine: string[] = [];
    let cursor = 0;
    // A card the flows of two or more actions lead to (a merge between actions) waits for all of them and sits a
    // column right of the last (10-19, Grapple's RKO: placed after Pounding's flow, GrappleFront's line ran back
    // through three cards). Inside one action a route keeps its row and a later branch draws back to the card
    // (Arrange B). A source the merge itself leads to (a loop) is not waited for.
    const enters = (n: FlatNode) => inside(n.id) && !shared(n);
    const block = new Set(group.flatMap(r => [...reach(r.id, enters)]));
    const waits = new Map<string, string[]>();
    const waitsFor = (t: string) => {
      let list = waits.get(t);
      if (!list) {
        const after = reach(t, enters);
        list = [...(into.get(t) ?? [])].filter(p => p !== t && block.has(p) && !after.has(p));
        if (new Set(list.map(p => byId.get(p)!.action)).size < 2) list = [];
        waits.set(t, list);
      }
      return list;
    };
    // Depth first, in route order: a card, its routes, then the row below starts under both.
    const visit = (root: string) => {
      type Open = {id: string; col: number; top: number; kids: string[]; next: number};
      const stack: Open[] = [];
      const open = (id: string, col: number) => {
        placed.set(id, {col, y: cursor});
        mine.push(id);
        const kids = (children.get(id) ?? []).filter(
          t => !placed.has(t) && !shared(byId.get(t)!) && inside(t) && waitsFor(t).every(p => placed.has(p))
        );
        if (kids.length) stack.push({id, col, top: cursor, kids, next: 0});
        else cursor += height(byId.get(id)!) + GAP_Y;
      };
      open(root, 0);
      while (stack.length) {
        const f = stack[stack.length - 1];
        if (f.next < f.kids.length) {
          const k = f.kids[f.next++];
          if (!placed.has(k)) open(k, Math.max(f.col + 1, ...waitsFor(k).map(p => (placed.get(p)?.col ?? f.col) + 1)));
          continue;
        }
        cursor = Math.max(cursor, f.top + height(byId.get(f.id)!) + GAP_Y);
        stack.pop();
      }
    };
    const later: {root: FlatNode; first: string}[] = [];
    for (const r of group) {
      // A card a route before it already reached (a hub card after its entrance) keeps that place.
      if (placed.has(r.id)) continue;
      const kids = (children.get(r.id) ?? []).filter(inside);
      if (kids.length && kids.every(k => placed.has(k))) later.push({root: r, first: kids[0]});
      else visit(r.id);
    }
    // A second entrance: left of the card it starts, in the first free place of that column.
    for (const {root: r, first} of later) {
      const target = placed.get(first)!,
        col = target.col - 1,
        h = height(r);
      const taken = mine
        .filter(id => placed.get(id)!.col === col)
        .map(id => [placed.get(id)!.y, placed.get(id)!.y + height(byId.get(id)!)] as const)
        .sort((a, b) => a[0] - b[0]);
      let y = target.y;
      for (const [top, end] of taken) if (y < end + GAP_Y && y + h + GAP_Y > top) y = end + GAP_Y;
      placed.set(r.id, {col, y});
      mine.push(r.id);
    }
    // A merge whose sources never all came (a guard: every source is placed above, so none should be left).
    for (const id of block) if (!placed.has(id)) visit(id);
    const cols = [...new Set(mine.map(id => placed.get(id)!.col))].sort((a, b) => a - b);
    const xs = new Map<number, number>();
    let x = 0;
    for (const c of cols) {
      xs.set(c, x);
      x += Math.max(...mine.filter(id => placed.get(id)!.col === c).map(id => width(byId.get(id)!))) + GAP_X;
    }
    return mine.map(id => ({id, x: xs.get(placed.get(id)!.col)!, y: placed.get(id)!.y}));
  };
  const frames: Frame[] = [];
  for (const group of groups) {
    group.sort((a, b) => reaches.get(b.id)!.size - reaches.get(a.id)!.size || compare(a, b));
    const items = lay(group, outside);
    const mine = new Set(items.map(i => i.id));
    for (const n of g.nodes.filter(n => shared(n) && !placed.has(n.id) && outside(n.id))) {
      if (![...(into.get(n.id) ?? [])].some(s => mine.has(s))) continue;
      const right = Math.max(...items.map(i => i.x + width(byId.get(i.id)!))) + GAP_X;
      const below = items
        .filter(i => i.x === right)
        .reduce((m, i) => Math.max(m, i.y + height(byId.get(i.id)!) + GAP_Y), 0);
      placed.set(n.id, {col: Infinity, y: below});
      items.push({id: n.id, x: right, y: below});
    }
    frames.push(frame(items));
  }
  // The hub: its entrances (the shared transitions) in the first column, what they lead to right of them,
  // the shared QTE cards under the entrances, so every line into the hub ends at the one column.
  let hubFrame: Frame | undefined;
  if (hub.size) {
    const inside = (id: string) => hub.has(id);
    const cards = g.nodes.filter(n => hub.has(n.id) && !shared(n)).sort(compare);
    const entrances = cards.filter(n => ![...(into.get(n.id) ?? [])].some(inside));
    const items = lay([...entrances, ...cards.filter(n => !entrances.includes(n))], inside);
    let below = items.filter(i => i.x === 0).reduce((m, i) => Math.max(m, i.y + height(byId.get(i.id)!) + GAP_Y), 0);
    for (const n of g.nodes.filter(n => hub.has(n.id) && shared(n)).sort(compare)) {
      placed.set(n.id, {col: 0, y: below});
      items.push({id: n.id, x: 0, y: below});
      below += height(n) + GAP_Y;
    }
    hubFrame = frame(items);
  }
  // A QTE card no placed route reaches, and every card with no connection: one block, last.
  const loose = [...isolated, ...g.nodes.filter(n => shared(n) && !placed.has(n.id)).sort(compare)];
  if (loose.length) {
    let y = 0;
    const items = loose.map(n => {
      const item = {id: n.id, x: 0, y};
      y += height(n) + GAP_Y;
      return item;
    });
    frames.push(frame(items));
  }
  function frame(items: Item[]): Frame {
    return {
      ids: items.map(i => i.id),
      items,
      w: Math.max(...items.map(i => i.x + width(byId.get(i.id)!))),
      h: Math.max(...items.map(i => i.y + height(byId.get(i.id)!))),
    };
  }
  // The entry and the event registry: a column at the far left, the entry above.
  const left: Item[] = [];
  let leftY = 0;
  for (const kind of ['entry', 'eventRegistry'])
    for (const n of g.nodes.filter(n => n.kind === kind).sort(compare)) {
      left.push({id: n.id, x: 0, y: leftY});
      leftY += height(n) + GAP_Y;
    }
  const leftW = left.length ? Math.max(...left.map(i => width(byId.get(i.id)!))) + BLOCK_GAP : 0,
    leftH = leftY ? leftY - GAP_Y : 0;
  let best: {zoom: number; pos: Map<string, {x: number; y: number}>} | undefined;
  const consider = (pos: Map<string, {x: number; y: number}>, w: number, h: number) => {
    const zoom = Math.min(view.w / Math.max(1, leftW + w), view.h / Math.max(1, leftH, h));
    if (!best || zoom > best.zoom + 1e-9) best = {zoom, pos};
  };
  if (hubFrame) {
    // The units in 1 to 4 columns (the widest units first, each column in route order), the hub right of them
    // and centred on them; the count that fits the pane at the largest zoom.
    const order = frames.map((f, i) => ({f, i})).sort((a, b) => b.f.w - a.f.w || a.i - b.i);
    const total = frames.reduce((s, f) => s + f.h + UNIT_GAP, 0);
    for (let count = 1; count <= Math.min(4, frames.length); count++) {
      const columns: {f: Frame; i: number}[][] = [[]];
      let filled = 0;
      for (const u of order) {
        if (columns.at(-1)!.length && columns.length < count && filled + u.f.h > total / count) {
          columns.push([]);
          filled = 0;
        }
        columns.at(-1)!.push(u);
        filled += u.f.h + UNIT_GAP;
      }
      const pos = new Map<string, {x: number; y: number}>();
      let x = 0,
        h = 0;
      for (const column of columns) {
        let y = 0;
        for (const {f} of column.sort((a, b) => a.i - b.i)) {
          for (const i of f.items) pos.set(i.id, {x: leftW + x + i.x, y: y + i.y});
          y += f.h + UNIT_GAP;
        }
        x += Math.max(...column.map(u => u.f.w)) + BLOCK_GAP;
        h = Math.max(h, y - UNIT_GAP);
      }
      x += HUB_GAP - BLOCK_GAP;
      const top = Math.max(0, (h - hubFrame.h) / 2);
      for (const i of hubFrame.items) pos.set(i.id, {x: leftW + x + i.x, y: top + i.y});
      consider(pos, x + hubFrame.w, Math.max(h, hubFrame.h));
    }
  } else {
    // Gap-filling (docs/mockup-arrange-pack, 10-19: rows left half of Grapple's graph empty): the tallest block
    // first, each in the highest, then leftmost, free place within the width, the room under the entry and registry
    // column included. A block keeps its own arrangement; only where it sits changes. The width is the one whose
    // whole fits the pane at the largest zoom.
    type Rect = {x: number; y: number; w: number; h: number};
    const total = frames.reduce((s, f) => s + f.w + BLOCK_GAP, 0);
    const widest = frames.length ? Math.max(...frames.map(f => f.w)) : 0;
    const step = Math.max(100, Math.ceil((total - widest) / 120));
    const order = frames.map((f, i) => ({f, i})).sort((a, b) => b.f.h - a.f.h || b.f.w - a.f.w || a.i - b.i);
    const column: Rect | undefined = left.length ? {x: 0, y: 0, w: leftW - BLOCK_GAP, h: leftH} : undefined;
    for (let limit = widest; limit <= Math.max(widest, total); limit += step) {
      const pos = new Map<string, {x: number; y: number}>();
      const taken: Rect[] = column ? [column] : [];
      const spots = [{x: leftW, y: 0}, ...(column ? [{x: 0, y: column.h + PACK_GAP}] : [])];
      const free = (x: number, y: number, w: number, h: number) =>
        x + w <= leftW + limit &&
        taken.every(
          o =>
            x + w + PACK_GAP <= o.x || o.x + o.w + PACK_GAP <= x || y + h + PACK_GAP <= o.y || o.y + o.h + PACK_GAP <= y
        );
      for (const {f} of order) {
        let at: {x: number; y: number} | undefined;
        for (const s of spots) {
          if (!free(s.x, s.y, f.w, f.h)) continue;
          // Slid up into the hole above it, as far as it stays free.
          let y = s.y;
          for (const o of taken) {
            const under = o.y + o.h + PACK_GAP;
            if (under < y && free(s.x, under, f.w, f.h)) y = under;
          }
          if (y > 0 && free(s.x, 0, f.w, f.h)) y = 0;
          if (!at || y < at.y || (y === at.y && s.x < at.x)) at = {x: s.x, y};
        }
        at ??= {x: leftW, y: Math.max(0, ...taken.map(o => o.y + o.h)) + PACK_GAP};
        taken.push({...at, w: f.w, h: f.h});
        spots.push({x: at.x + f.w + PACK_GAP, y: at.y}, {x: at.x, y: at.y + f.h + PACK_GAP});
        for (const i of f.items) pos.set(i.id, {x: at.x + i.x, y: at.y + i.y});
      }
      const w = Math.max(leftW, ...taken.map(o => o.x + o.w)),
        h = Math.max(0, ...taken.map(o => o.y + o.h));
      consider(pos, w - leftW, h);
    }
  }
  const positions: Record<string, {x: number; y: number}> = {};
  for (const i of left) positions[i.id] = {x: ORIGIN + i.x, y: ORIGIN + i.y};
  for (const [id, p] of best?.pos ?? []) positions[id] = {x: ORIGIN + p.x, y: ORIGIN + p.y};
  // The loose block stays last, after the hub.
  const blocks = frames.map(f => f.ids);
  if (hubFrame) blocks.splice(loose.length ? blocks.length - 1 : blocks.length, 0, hubFrame.ids);
  return {positions, blocks, hub: hubFrame?.ids ?? []};
}
