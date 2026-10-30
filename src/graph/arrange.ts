import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {cardHeight, cardWidth, pinTop, summaryHeight} from './cardPresentation.ts';
import {STUB_SOURCES} from './sharedTransitionLines.ts';

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
  // A condition card picking this many HKX or more is a unit with them (docs/mockup-arrange-fan C); a true/false
  // pair stays a route's row and the row below.
  FAN = 3,
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
  // One block in layers (10-26, user report on DynamicSprintStop.xml: its HKX cards stood in two columns and a
  // condition card under twelve HKX cards). A card's column is its longest route from the block's roots, so a card
  // several routes lead to sits right of all of them; the HKX cards a start or a condition plays share one column,
  // the block's last such; a card stands at the height of the line into it (its first source's pin) and moves down
  // only to clear the card above it in its column. A second entrance (a key into an HKX a route already reaches)
  // stands just left of the card it starts. Lines that close a loop do not count.
  const lay = (group: FlatNode[], inside: (id: string) => boolean) => {
    const enters = (n: FlatNode) => inside(n.id) && !shared(n);
    const block = new Set(group.flatMap(r => [...reach(r.id, enters)]).filter(id => !placed.has(id)));
    const kids = (id: string) => (children.get(id) ?? []).filter(t => block.has(t));
    // Route order (depth first from the roots in order), and the lines back to a card still open (a loop).
    const index = new Map<string, number>(),
      state = new Map<string, 'open' | 'done'>(),
      back = new Set<string>(),
      post: string[] = [];
    const visit = (id: string) => {
      state.set(id, 'open');
      index.set(id, index.size);
      for (const t of kids(id))
        if (state.get(t) === 'open') back.add(id + '>' + t);
        else if (!state.has(t)) visit(t);
      state.set(id, 'done');
      post.push(id);
    };
    for (const r of group) if (block.has(r.id) && !state.has(r.id)) visit(r.id);
    for (const id of block) if (!state.has(id)) visit(id);
    const topo = [...post].reverse();
    const ahead = (id: string) => kids(id).filter(t => !back.has(id + '>' + t));
    const sources = new Map<string, string[]>();
    for (const id of topo) for (const t of ahead(id)) sources.set(t, [...(sources.get(t) ?? []), id]);
    for (const list of sources.values()) list.sort((a, b) => index.get(a)! - index.get(b)!);
    const col = new Map<string, number>();
    const layer = () => {
      for (const id of topo)
        col.set(id, Math.max(col.get(id) ?? 0, ...(sources.get(id) ?? []).map(p => col.get(p)! + 1)));
    };
    layer();
    const played = [...block].filter(
      id =>
        byId.get(id)!.kind === 'hkxPlay' &&
        !!sources.get(id)?.length &&
        sources.get(id)!.every(p => byId.get(p)!.kind !== 'hkxPlay' && !transition(byId.get(p)!))
    );
    if (played.length > 1) {
      const last = Math.max(...played.map(id => col.get(id)!));
      for (const id of played) col.set(id, last);
      layer();
    }
    // A card no route leads to stands just left of the first card it leads to.
    for (const id of topo)
      if (!sources.get(id)?.length && ahead(id).length)
        col.set(id, Math.max(col.get(id)!, Math.min(...ahead(id).map(t => col.get(t)!)) - 1));
    const pin = (s: string, t: string) => {
      const n = byId.get(s)!,
        at = (n.outputs as string[]).indexOf(out.get(s)?.find(x => x.to === t)?.pin ?? '');
      return pinTop(n) + Math.max(0, at) * 24;
    };
    const ys = new Map<string, number>();
    const taken = new Map<number, [number, number][]>();
    const put = (id: string, want: number) => {
      const c = col.get(id)!,
        h = height(byId.get(id)!),
        spans = taken.get(c) ?? [];
      let y = Math.max(0, want);
      for (const [top, end] of [...spans].sort((a, b) => a[0] - b[0]))
        if (y < end + GAP_Y && y + h + GAP_Y > top) y = end + GAP_Y;
      spans.push([y, y + h]);
      taken.set(c, spans);
      ys.set(id, y);
    };
    // Column by column: each card at its first placed source's pin, in that order; the roots of the block's routes
    // under each other; a second entrance last, beside the card it starts.
    const later: string[] = [];
    for (const c of [...new Set(col.values())].sort((a, b) => a - b)) {
      const here = topo.filter(id => col.get(id) === c);
      const wants: [string, number][] = [];
      for (const id of here) {
        const from = (sources.get(id) ?? []).find(p => ys.has(p));
        // The first card a source leads to shares its top (one row, as before 10-26: an HKX's transition was 24 px
        // lower when its line left the second pin); the others stand at their pins.
        if (from)
          wants.push([
            id,
            ahead(from)[0] === id ? ys.get(from)! : ys.get(from)! + pin(from, id) - pinTop(byId.get(id)!),
          ]);
        else if (
          !sources.get(id)?.length &&
          ahead(id).length &&
          ahead(id).every(t => (sources.get(t)?.length ?? 0) > 1)
        )
          later.push(id);
        else wants.push([id, Number.MAX_SAFE_INTEGER]);
      }
      wants.sort((a, b) => a[1] - b[1] || index.get(a[0])! - index.get(b[0])!);
      for (const [id, want] of wants) {
        const spans = taken.get(c) ?? [];
        put(id, want === Number.MAX_SAFE_INTEGER ? Math.max(0, ...spans.map(([, end]) => end + GAP_Y)) : want);
      }
    }
    for (const id of later)
      put(
        id,
        Math.min(
          ...ahead(id)
            .filter(t => ys.has(t))
            .map(t => ys.get(t)!),
          Infinity
        )
      );
    for (const id of later) if (!Number.isFinite(ys.get(id)!)) put(id, 0);
    const mine = [...block].sort((a, b) => index.get(a)! - index.get(b)!);
    for (const id of mine) placed.set(id, {col: col.get(id)!, y: ys.get(id)!});
    const cols = [...new Set(mine.map(id => col.get(id)!))].sort((a, b) => a - b);
    const xs = new Map<number, number>();
    let x = 0;
    for (const c of cols) {
      xs.set(c, x);
      x += Math.max(...mine.filter(id => col.get(id) === c).map(id => width(byId.get(id)!))) + GAP_X;
    }
    return (
      branchColumns(mine, sources, ahead, kids) ??
      fanUnits(
        mine.map(id => ({id, x: xs.get(col.get(id)!)!, y: ys.get(id)!})),
        played,
        sources,
        ahead,
        index
      )
    );
  };
  // A route that splits into branches of their own (docs/mockup-arrange-branches, 10-30, user report on Dynamic Block
  // Hit: the five weapons' hit and stamina cards stood in two columns at the left, the units they pick in one row far
  // below them, and lines ran from one corner to the other). The cards from the start up to the first card with
  // several destinations (the split) are the head, left to right. Each of the split's destinations with all it
  // reaches is a branch, laid out on its own: the cards before its units on its top line, left to right (a card's
  // other destinations stacked under one another right of it), its units (arrange C) in a row under them, each under
  // the card that picks it when there is room. The branches stand side by side in the split's order, wrapped into as
  // many rows as fits the pane best. What the HKX lead on to (a shared transition back to the head) goes under the
  // head card it returns to when its lines are not drawn (graph/sharedTransitionLines.ts), else right of everything.
  // Only for branches that are trees, meet nowhere and hold a unit; anything else keeps the arrange above.
  function branchColumns(
    mine: string[],
    sources: Map<string, string[]>,
    ahead: (id: string) => string[],
    kids: (id: string) => string[]
  ): Item[] | undefined {
    const roots = mine.filter(id => !sources.get(id)?.length);
    if (roots.length !== 1) return;
    const head = [roots[0]];
    while (ahead(head.at(-1)!).length === 1 && head.length < mine.length) {
      const next = ahead(head.at(-1)!)[0];
      if (head.includes(next) || byId.get(next)!.kind === 'hkxPlay') return;
      head.push(next);
    }
    const branches = ahead(head.at(-1)!);
    if (branches.length < 2) return;
    const hkx = (id: string) => byId.get(id)!.kind === 'hkxPlay';
    // A branch's cards: what its first card reaches, not past an HKX (what the HKX lead to is `after`).
    const tree = (id: string) => (hkx(id) ? [] : ahead(id));
    const sets: Set<string>[] = [];
    const taken = new Set(head);
    for (const b of branches) {
      const set = new Set([b]),
        stack = [b];
      while (stack.length)
        for (const t of tree(stack.pop()!)) {
          // A tree: every card one source, inside the branch.
          if (set.has(t) || taken.has(t) || sources.get(t)!.length !== 1) return;
          set.add(t);
          stack.push(t);
        }
      for (const id of set) taken.add(id);
      sets.push(set);
    }
    const after = mine.filter(id => !taken.has(id));
    // What follows the HKX ends there, entered from HKX only.
    if (after.some(id => ahead(id).length || sources.get(id)!.some(s => !hkx(s)))) return;
    const isUnit = (id: string) => !hkx(id) && tree(id).length >= FAN && tree(id).every(hkx);
    if (!sets.some(set => [...set].some(isUnit))) return;
    const blocks = branches.map((b, i) => {
      const local = new Map<string, {x: number; y: number}>(),
        units: {id: string; parent: string}[] = [];
      // The top line from (x, y); returns the bottom of what it placed.
      const line = (id: string, x: number, y: number): number => {
        local.set(id, {x, y});
        let bottom = y + height(byId.get(id)!),
          next = y;
        for (const t of tree(id)) {
          if (isUnit(t)) {
            units.push({id: t, parent: id});
            continue;
          }
          next = line(t, x + width(byId.get(id)!) + GAP_X, next) + GAP_Y;
          bottom = Math.max(bottom, next - GAP_Y);
        }
        return bottom;
      };
      const top = line(b, 0, 0) + UNIT_GAP;
      let cursor = 0;
      for (const {id, parent} of units) {
        const x = Math.max(local.get(parent)!.x, cursor);
        local.set(id, {x, y: top});
        const column = x + width(byId.get(id)!) + GAP_X;
        let y = top;
        for (const h of tree(id)) {
          local.set(h, {x: column, y});
          y += height(byId.get(h)!) + GAP_Y;
        }
        cursor = column + Math.max(...tree(id).map(h => width(byId.get(h)!))) + UNIT_GAP;
      }
      if (local.size !== sets[i].size) return undefined;
      const ids = [...local.keys()];
      return {
        local,
        w: Math.max(...ids.map(id => local.get(id)!.x + width(byId.get(id)!))),
        h: Math.max(...ids.map(id => local.get(id)!.y + height(byId.get(id)!))),
        // Where its units' row starts; a branch that is a unit itself stands on its row's units' row.
        units: units.length ? top : undefined,
        lone: isUnit(b),
      };
    });
    if (blocks.some(b => !b)) return;
    const by = new Map<string, {x: number; y: number}>();
    let x = 0;
    for (const id of head) {
      by.set(id, {x, y: 0});
      x += width(byId.get(id)!) + GAP_X;
    }
    const left = x,
      headBottom = Math.max(...head.map(id => height(byId.get(id)!)));
    // The branches in rows of `count`, side by side in the split's order.
    const rows = (count: number) => {
      const pos = new Map<string, {x: number; y: number}>();
      let bx = left,
        by0 = 0,
        rowH = 0,
        right = left;
      blocks.forEach((b, i) => {
        if (i && i % count === 0) {
          by0 += rowH + BLOCK_GAP;
          bx = left;
          rowH = 0;
        }
        const row = blocks.slice(i - (i % count), i - (i % count) + count),
          dy = b!.lone ? Math.max(0, ...row.map(o => o!.units ?? 0)) : 0;
        for (const [id, p] of b!.local) pos.set(id, {x: bx + p.x, y: by0 + dy + p.y});
        bx += b!.w + BLOCK_GAP;
        right = Math.max(right, bx - BLOCK_GAP);
        rowH = Math.max(rowH, dy + b!.h);
      });
      return {pos, w: right, h: Math.max(headBottom, by0 + rowH)};
    };
    const zoom = (r: {w: number; h: number}) => Math.min(view.w / r.w, view.h / r.h);
    const best = blocks.map((_, i) => rows(i + 1)).reduce((a, b) => (zoom(b) > zoom(a) + 1e-9 ? b : a));
    for (const [id, p] of best.pos) by.set(id, p);
    // After the HKX: a shared transition whose lines are not drawn under the head card it returns to; else right of
    // everything, at the top.
    let under = headBottom + UNIT_GAP,
      right = best.w + BLOCK_GAP;
    for (const id of after) {
      const back = kids(id).find(t => head.includes(t));
      if (back && new Set(sources.get(id)).size >= STUB_SOURCES) {
        by.set(id, {x: by.get(back)!.x, y: under});
        under += height(byId.get(id)!) + GAP_Y;
      } else {
        by.set(id, {x: right, y: 0});
        right += width(byId.get(id)!) + GAP_X;
      }
    }
    return mine.map(id => ({id, ...by.get(id)!}));
  }
  // A condition card picking several HKX (docs/mockup-arrange-fan C, 10-29, the user's own arrange of Dynamic Block
  // Hit: fifteen HKX in one column, 4,000 tall): the card and those HKX, a column right of it in its rows' order, are
  // one unit. The units go in a row under the cards above them, in route order, each under the card that leads to it
  // when there is room. A card picking one HKX keeps it right of itself, level. What the HKX lead on to moves right
  // of them, at its first source's height. A block whose unit HKX lead to cards of their own (a transition to a
  // further row), or to a route that goes on, keeps the arrange above: the unit would tear its rows apart.
  function fanUnits(
    items: Item[],
    played: string[],
    sources: Map<string, string[]>,
    ahead: (id: string) => string[],
    index: Map<string, number>
  ): Item[] {
    const by = new Map(items.map(i => [i.id, {...i}]));
    const picked = new Map<string, string[]>();
    for (const id of played) {
      const s = sources.get(id)![0];
      picked.set(s, [...(picked.get(s) ?? []), id]);
    }
    for (const [s, list] of picked) {
      const order = ahead(s);
      list.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    const fans = [...picked.keys()]
      .filter(s => picked.get(s)!.length >= FAN)
      .sort((a, b) => index.get(a)! - index.get(b)!);
    if (!fans.length) return items;
    const unit = new Set(fans.flatMap(s => [s, ...picked.get(s)!]));
    const playedSet = new Set(played);
    // What the HKX lead on to: everything reached from them but the units and the cards before them.
    const after = new Set<string>();
    const stack = [...played];
    while (stack.length)
      for (const t of ahead(stack.pop()!))
        if (by.has(t) && !playedSet.has(t) && !after.has(t)) (after.add(t), stack.push(t));
    for (const s of fans)
      for (const h of picked.get(s)!) if (ahead(h).some(t => (sources.get(t)?.length ?? 0) < 2)) return items;
    // What follows the HKX ends there (a shared transition, its line back to the start aside): a longer route after
    // them (Grapple's QTE, its transitions and the HKX they lead to) keeps the rows it is laid out in.
    if ([...after].some(id => ahead(id).length)) return items;
    const box = (id: string) => {
      const p = by.get(id)!,
        n = byId.get(id)!;
      return {x: p.x, y: p.y, w: width(n), h: height(n)};
    };
    const overlaps = (a: {x: number; y: number; w: number; h: number}, b: typeof a) =>
      a.x < b.x + b.w + GAP_X / 2 &&
      b.x < a.x + a.w + GAP_X / 2 &&
      a.y < b.y + b.h + GAP_Y / 2 &&
      b.y < a.y + a.h + GAP_Y / 2;
    type Rect = {x: number; y: number; w: number; h: number};
    const obstacles: Rect[] = items
      .map(i => i.id)
      .filter(id => !unit.has(id) && !after.has(id) && !playedSet.has(id))
      .map(box);
    const oldRight = Math.max(...played.map(id => box(id).x + box(id).w));
    const moved = new Map<string, number>();
    // A card picking one or two HKX keeps them right of itself, from its top, down past what is in the way; the cards
    // in route order (a true branch before its false).
    for (const s of [...picked.keys()].filter(s => !unit.has(s)).sort((a, b) => index.get(a)! - index.get(b)!)) {
      const src = box(s);
      let y = src.y;
      for (const h of picked.get(s)!) {
        const before = by.get(h)!.y;
        let want = {x: src.x + src.w + GAP_X, y, w: box(h).w, h: box(h).h};
        for (let guard = 0; guard < 200; guard++) {
          const hit = obstacles.filter(o => overlaps(want, o));
          if (!hit.length) break;
          want = {...want, y: Math.max(...hit.map(o => o.y + o.h)) + GAP_Y};
        }
        by.set(h, {id: h, x: want.x, y: want.y});
        moved.set(h, want.y - before);
        obstacles.push(box(h));
        y = want.y + want.h + GAP_Y;
      }
    }
    // Each unit where its card stands when it fits there. Else under what is in its way, the one of two places that
    // leaves the block fitting the pane at the larger zoom (as blocks are placed): down in its own column (sibling
    // conditions, DynamicDodgeShot's true and false), or in a row from under the card that leads to it, right of the
    // units before it (Dynamic Block Hit's two chance cards at different depths).
    const span = (s: string, x: number, y: number): Rect => {
      const list = picked.get(s)!,
        w = width(byId.get(s)!) + GAP_X + Math.max(...list.map(h => width(byId.get(h)!))),
        h = Math.max(
          height(byId.get(s)!),
          list.reduce((sum, id) => sum + height(byId.get(id)!) + GAP_Y, -GAP_Y)
        );
      return {x, y, w, h};
    };
    let cursor = 0,
      row: number | undefined;
    for (const s of fans) {
      const own = by.get(s)!;
      let at = span(s, Math.max(own.x, cursor), own.y);
      if (own.x < cursor || obstacles.some(o => overlaps(at, o))) {
        const parent = (sources.get(s) ?? []).find(p => by.has(p) && !unit.has(p));
        const below = (r: Rect) => {
          for (let guard = 0; guard < 200; guard++) {
            const hit = obstacles.filter(o => overlaps(r, o));
            if (!hit.length) break;
            r = {...r, y: Math.max(...hit.map(o => o.y + o.h)) + 2 * GAP_Y};
          }
          return r;
        };
        const fit = (r: Rect) => {
          const all = [...obstacles, r],
            left = Math.min(...all.map(o => o.x)),
            top = Math.min(...all.map(o => o.y));
          return Math.min(
            view.w / Math.max(1, Math.max(...all.map(o => o.x + o.w)) - left),
            view.h / Math.max(1, Math.max(...all.map(o => o.y + o.h)) - top)
          );
        };
        const down = below(span(s, own.x, own.y)),
          beside = below(span(s, Math.max(parent ? by.get(parent)!.x : own.x, cursor), Math.max(own.y, row ?? 0)));
        at = fit(down) > fit(beside) + 1e-9 ? down : beside;
        if (at === beside) row = at.y;
      }
      obstacles.push(at);
      by.set(s, {id: s, x: at.x, y: at.y});
      const column = at.x + width(byId.get(s)!) + GAP_X;
      let y = at.y;
      for (const h of picked.get(s)!) {
        moved.set(h, y - by.get(h)!.y);
        by.set(h, {id: h, x: column, y});
        y += height(byId.get(h)!) + GAP_Y;
      }
      cursor = at.x + at.w + 1.5 * GAP_X;
    }
    // After the HKX: right of the units, at the height of the first source they follow.
    const shift = Math.max(...played.map(id => box(id).x + box(id).w)) - oldRight;
    const rest = [...after].sort((a, b) => index.get(a)! - index.get(b)!);
    for (const id of rest) {
      const first = (sources.get(id) ?? []).find(p => moved.has(p));
      const dy = first === undefined ? 0 : moved.get(first)!;
      by.set(id, {id, x: by.get(id)!.x + shift, y: by.get(id)!.y + dy});
      moved.set(id, dy);
    }
    for (const id of rest) {
      const others = [...by.keys()].filter(o => o !== id);
      let b = box(id);
      for (let guard = 0; guard < 200 && others.some(o => overlaps(b, box(o))); guard++) {
        by.set(id, {id, x: b.x, y: b.y + GAP_Y});
        b = box(id);
      }
    }
    const placedAt = [...by.values()];
    const minY = Math.min(...placedAt.map(i => i.y));
    return placedAt.map(i => ({...i, y: i.y - minY}));
  }
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
