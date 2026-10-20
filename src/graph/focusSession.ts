import type {ViewGraph} from './navigation.ts';
import type {ArrangeOptions} from './arrange.ts';
import {actionFlow} from './navigation.ts';
export type FocusSession = {
  members: string[];
  known: string[];
  positions: Record<string, {x: number; y: number}>;
  /** Other actions' cards the flow hands over to: dimmed, and only the lines into them are drawn. */
  neighbors?: string[];
};
export function beginFocus(g: ViewGraph, action: string, node?: string, options?: ArrangeOptions): FocusSession {
  const view = actionFlow(g, action, node, options);
  return {
    members: view.nodes.map(n => n.id),
    known: g.nodes.map(n => n.id),
    positions: Object.fromEntries(view.nodes.map(n => [n.id, n.position])),
    neighbors: view.nodes.filter(n => n.neighbor).map(n => n.id),
  };
}
export function retainFocus(
  g: ViewGraph,
  session: FocusSession,
  aliases: Record<string, string> = {}
): {session: FocusSession; graph: ViewGraph} {
  const known = new Set(session.known),
    members = new Set(session.members),
    positions = {...session.positions};
  let changed = false;
  for (const id of session.members)
    if (aliases[id] && !members.has(aliases[id])) {
      members.add(aliases[id]);
      positions[aliases[id]] = positions[id];
      changed = true;
    }
  for (const n of g.nodes)
    if (!known.has(n.id)) {
      known.add(n.id);
      members.add(n.id);
      positions[n.id] ??= n.position;
      changed = true;
    }
  const neighbors = new Set(session.neighbors);
  const nodes = g.nodes
    .filter(n => members.has(n.id))
    .map(n => ({...n, position: positions[n.id] ?? n.position, ...(neighbors.has(n.id) ? {neighbor: true} : {})}));
  const shown = new Set(nodes.map(n => n.id));
  return {
    session: changed ? {...session, members: [...members], known: [...known], positions} : session,
    graph: {
      nodes,
      edges: g.edges.filter(e => shown.has(e.source) && shown.has(e.target) && !neighbors.has(e.source)),
    },
  };
}
