import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {arrangeLayout, type ArrangeOptions} from './arrange.ts';
import {tr} from '../i18n/korean.ts';
export type ViewGraph = {nodes: FlatNode[]; edges: GraphEdge[]};

/** Whether boxes (graph units) fit a pane (screen pixels) at a zoom of at least `min`, with fitView's padding
 *  (a fraction of the bounds added). */
export function fitsAt(
  boxes: {x: number; y: number; w: number; h: number}[],
  pane: {w: number; h: number},
  padding: number,
  min: number
) {
  if (!boxes.length) return true;
  const width = Math.max(...boxes.map(b => b.x + b.w)) - Math.min(...boxes.map(b => b.x)),
    height = Math.max(...boxes.map(b => b.y + b.h)) - Math.min(...boxes.map(b => b.y));
  const zoom = Math.min(pane.w / (width * (1 + padding) || 1), pane.h / (height * (1 + padding) || 1));
  return zoom >= min;
}
export function neighbors(g: ViewGraph, id: string): string[] {
  const ids = new Set([id]);
  for (const e of g.edges)
    if (e.source === id || e.target === id) {
      ids.add(e.source);
      ids.add(e.target);
    }
  return g.nodes.filter(n => ids.has(n.id)).map(n => n.id);
}

// Focus on one playback and its prerequisites/effects, never traverse a sibling
// playback or use a shared attachment as a bridge to its other users. Where the flow
// hands over (a transition's destination, another HKX a condition picks) is shown one
// step further, as a neighbor (docs/mockup-arrange-c, flow view 1): dimmed, not entered.
export function actionFlow(g: ViewGraph, action: string, selected?: string, options?: ArrangeOptions): ViewGraph {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  // A selecting action has no HKX card (graph/sharing.ts): its flow starts at its decision card.
  const decision = (n: ViewGraph['nodes'][number]) =>
    n.id === `conditionTable:${action}` ||
    (n.id.startsWith(`flow:${action}:`) &&
      !g.edges.some(e => e.target === n.id && e.source.startsWith(`flow:${action}:`)));
  const seed =
    g.nodes.find(n => n.id === selected && n.kind === 'hkxPlay') ??
    g.nodes.find(n => n.action === action && n.kind === 'hkxPlay') ??
    g.nodes.find(decision);
  if (!seed) return {nodes: [], edges: []};
  const incoming = new Map<string, GraphEdge[]>(),
    outgoing = new Map<string, GraphEdge[]>();
  for (const e of g.edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }
  const keep = new Set([seed.id]),
    keptEdges = new Set<GraphEdge>();
  const upstream = new Set<string>(),
    neighbors = new Set<string>();
  for (const reverse of [true, false]) {
    const seen = new Set([seed.id]),
      queue = [seed.id];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i],
        node = byId.get(id)!;
      if (node.kind === 'entry' || node.kind === 'outputPose') continue;
      for (const e of (reverse ? incoming : outgoing).get(id) ?? []) {
        const next = reverse ? e.source : e.target,
          n = byId.get(next);
        if (!n) continue;
        if (n.kind === 'hkxPlay' && n.id !== seed.id) {
          if (!reverse) {
            keptEdges.add(e);
            keep.add(next);
            neighbors.add(next);
          } else if (e.origins?.some(o => o.source.endsWith('|carry'))) {
            // The lift whose carry starts this putdown is where this flow starts: shown in full with its own
            // start route, never with its other outputs. (Other HKX before this one stay out.)
            keptEdges.add(e);
            keep.add(next);
            upstream.add(next);
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
          continue;
        }
        if (!reverse && n.kind === 'blend' && n.action && n.action !== action) continue;
        keptEdges.add(e);
        keep.add(next);
        if (reverse) upstream.add(next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }
  // The other HKX this action's own conditions pick: neighbors too. A decision another action owns (a
  // dispatch table) keeps its other candidates out.
  for (const id of upstream) {
    const node = byId.get(id)!;
    if (!['conditionBranch', 'conditionTable'].includes(node.kind) || node.action !== action) continue;
    for (const e of outgoing.get(id) ?? []) {
      const n = byId.get(e.target);
      if (n?.kind !== 'hkxPlay' || n.id === seed.id || (keep.has(n.id) && !neighbors.has(n.id))) continue;
      keptEdges.add(e);
      keep.add(n.id);
      neighbors.add(n.id);
    }
  }
  // Remove transition inputs that lead nowhere shown (a blend of another action).
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of keep) {
      const n = byId.get(id)!;
      if (
        id !== seed.id &&
        ['keyInput', 'markerReceive', 'blend'].includes(n.kind) &&
        (![...keptEdges].some(e => e.source === id) ||
          (!upstream.has(id) && (incoming.get(id)?.length ?? 0) > 0 && ![...keptEdges].some(e => e.target === id)))
      ) {
        keep.delete(id);
        for (const e of keptEdges) if (e.target === id || e.source === id) keptEdges.delete(e);
        changed = true;
      }
    }
  }
  // Condition operands belong to the visible route even when they are shared.
  const queue = [...keep];
  for (let i = 0; i < queue.length; i++)
    for (const e of incoming.get(queue[i]) ?? []) {
      if (!e.id.startsWith('operand:')) continue;
      keptEdges.add(e);
      if (!keep.has(e.source)) {
        keep.add(e.source);
        queue.push(e.source);
      }
    }
  const edges = g.edges.filter(e => keptEdges.has(e) && keep.has(e.source) && keep.has(e.target));
  const visible = g.nodes.filter(n => keep.has(n.id));
  const nodes = visible.map(n => {
    // Hide unrelated table output handles only in this view; keep author data intact.
    const inputs = n.inputs.filter(p => edges.some(e => e.target === n.id && (e.targetPin ?? e.pin) === p));
    const outputs = n.outputs.filter(p => edges.some(e => e.source === n.id && e.pin === p));
    const boundary =
      upstream.has(n.id) &&
      (incoming.get(n.id) ?? []).some(e => !keep.has(e.source) && byId.get(e.source)?.kind === 'hkxPlay');
    return {
      ...n,
      summary: boundary ? n.summary + tr(' · 이전 동작에서 전환') : n.summary,
      inputs,
      outputs,
      ...(neighbors.has(n.id) ? {neighbor: true} : {}),
    };
  });
  // Laid out as the whole graph is (graph/arrange.ts lanes): the route left to right, the HKX a condition
  // picks under the one it plays, the transitions on the HKX's row and where they lead right of them.
  const positions = arrangeLayout({nodes, edges}, options).positions;
  return {nodes: nodes.map(n => ({...n, position: positions[n.id]})), edges};
}

/** The whole graph arranged (graph/arrange.ts): positions only. */
export function regionLayout(g: ViewGraph, options?: ArrangeOptions): Record<string, {x: number; y: number}> {
  return arrangeLayout(g, options).positions;
}
