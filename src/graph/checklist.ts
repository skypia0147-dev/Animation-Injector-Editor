import type {Workspace} from '../workspace.ts';
import {flatGraph, deleteFlat, type FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {copyNodes, pasteNodes, type NodeClipboard} from './clipboard.ts';
import {retirePlayback} from './deletePlayback.ts';
import {compactGraph} from './sharing.ts';
import {tr} from '../i18n/korean.ts';

export const internalKinds = new Set([
  'stateCondition',
  'cameraRestore',
  'fireArrow',
  'carryRelease',
  'carryFix',
  'suppress',
  'carry',
  'findPartner',
  'pairedPlay',
]);
export const eventItem = (n: FlatNode) =>
  n.kind === 'cameraRestore' ||
  n.kind === 'fireArrow' ||
  n.kind === 'carryRelease' ||
  n.kind === 'carryFix' ||
  (!!n.notify && n.notify.startsWith('effect:'));
export type ChecklistItem = {
  node: FlatNode;
  bindings: GraphEdge[];
  /** The card's 「삭제」 button: everything but the pair's own pieces (partner search, paired play, carry fix). */
  removable: boolean;
  scope: string;
  category: 'feature' | 'event';
  /** A blend item's role: the start blend leads the card's list, the end blend closes it (graph/momentOrder.ts). */
  blend?: 'enter' | 'exit';
};
/** An HKX card's items: its features, moments and blends, each a node of the flat graph drawn inside the card.
 *  `raw` is the workspace's flat graph (graph/renderCache.ts passes the one it already has). */
export function checklistModel(w: Workspace, raw = flatGraph(w)) {
  const plays = raw.nodes.filter(n => n.kind === 'hkxPlay');
  const connected = new Map<string, GraphEdge[]>();
  for (const e of raw.edges)
    for (const id of new Set([e.source, e.target])) {
      const list = connected.get(id) ?? [];
      list.push(e);
      connected.set(id, list);
    }
  const items = new Map<string, ChecklistItem[]>(),
    owners = new Map<string, string[]>(),
    hidden = new Set<string>();
  for (const p of plays) items.set(p.id, []);
  for (const n of raw.nodes) {
    const blend = n.kind === 'blend' ? (n.original === 'blendIn' ? ('enter' as const) : ('exit' as const)) : undefined;
    const eligible = !!blend || (!!n.notify && !['transition'].includes(n.kind)) || internalKinds.has(n.kind);
    if (!eligible || !n.action) continue;
    const bindings = connected.get(n.id) ?? [];
    // A clip's own recovery belongs to that clip; anything else to the action's card.
    const parents = n.notify?.startsWith('recovery:')
      ? plays.filter(p => bindings.some(e => e.source === p.id || e.target === p.id))
      : plays.filter(p => p.action === n.action);
    if (!parents.length) continue;
    hidden.add(n.id);
    owners.set(
      n.id,
      parents.map(p => p.id)
    );
    for (const p of parents)
      items.get(p.id)!.push({
        node: n,
        bindings,
        removable: !['findPartner', 'pairedPlay', 'carryFix'].includes(n.kind),
        scope: parents.length > 1 ? tr('동작 공통 · {length}클립', {length: parents.length}) : tr('이 클립'),
        category: eventItem(n) ? 'event' : 'feature',
        ...(blend ? {blend} : {}),
      });
  }
  return {raw, live: raw.edges, items, owners, hidden, unassigned: [] as FlatNode[]};
}
/** The canvas: every node but the items drawn inside their cards; a carry's line to its putdown leaves its card. */
export function checklistProjection(w: Workspace, model = checklistModel(w)) {
  const {raw, hidden, owners} = model;
  const rawById = new Map<string, FlatNode>();
  for (const n of raw.nodes) if (!rawById.has(n.id)) rawById.set(n.id, n);
  const edges = raw.edges.flatMap(e => {
    if (hidden.has(e.target)) return [];
    if (!hidden.has(e.source)) return [e];
    const n = rawById.get(e.source);
    // Preserve outgoing execution paths (e.g. carry release); attachment wires disappear.
    if (n?.kind !== 'carry') return [];
    return (owners.get(e.source) ?? []).map(owner => ({
      ...e,
      id: `checklist:${owner}:${e.id}`,
      source: owner,
      pin: `embedded:${encodeURIComponent(e.source)}:${e.pin}` as GraphEdge['pin'],
      origins: e.origins ?? [e],
    }));
  });
  let graph = compactGraph(w, {nodes: raw.nodes.filter(n => !hidden.has(n.id)), edges});
  // Each node's pins, gathered in one pass over the edges (in edge order).
  const incoming = new Map<string, string[]>(),
    outgoing = new Map<string, string[]>();
  const append = (map: Map<string, string[]>, id: string, pin: string) => {
    const list = map.get(id);
    if (list) list.push(pin);
    else map.set(id, [pin]);
  };
  for (const e of graph.edges) {
    append(incoming, e.target, e.targetPin ?? e.pin);
    append(outgoing, e.source, e.pin);
  }
  graph = {
    ...graph,
    nodes: graph.nodes.map(n => ({
      ...n,
      inputs: [
        ...new Set([...(n.kind === 'hkxPlay' ? ['trigger' as const] : n.inputs), ...(incoming.get(n.id) ?? [])]),
      ],
      outputs: [
        ...new Set([...(n.kind === 'hkxPlay' ? ['trigger' as const] : n.outputs), ...(outgoing.get(n.id) ?? [])]),
      ],
    })) as typeof graph.nodes,
  };
  return graph;
}
export function copyChecklistNodes(w: Workspace, ids: string[]): NodeClipboard {
  const model = checklistModel(w),
    selected = new Set(ids.filter(id => id !== 'eventRegistry'));
  const carried = new Set<string>();
  for (const id of ids)
    for (const item of model.items.get(id) ?? []) {
      selected.add(item.node.id);
      carried.add(item.node.id);
    }
  return {...copyNodes(w, model.raw, [...selected]), cardItems: [...carried]};
}
export function deleteChecklistNode(w: Workspace, id: string): Workspace {
  const n = flatGraph(w).nodes.find(n => n.id === id),
    a = w.actions.find(a => a.uid === n?.action);
  if (n?.kind === 'hkxPlay' && a?.config.steps.length === 1) return retirePlayback(w, a.uid, false);
  return deleteFlat(w, id);
}
/** A feature or moment dragged onto another HKX card (unify ⑪): it goes there with its settings, as a pasted item
 *  does; `copy` (Ctrl held) leaves it where it was too. One the card cannot take (a feature it has once already) is
 *  refused. */
export function transferItem(w: Workspace, id: string, toAction: string, copy: boolean): Workspace {
  const raw = flatGraph(w),
    node = raw.nodes.find(n => n.id === id);
  if (!node?.action) throw Error(tr('기능을 찾지 못했습니다.'));
  if (node.action === toAction) return w;
  const r = pasteNodes(w, copyNodes(w, raw, [id]), node.position, toAction);
  if (!r.ids.length) throw Error(tr('그 HKX 카드에는 넣을 수 없는 기능입니다(이미 있는 기능은 하나만).'));
  return copy ? r.workspace : deleteChecklistNode(r.workspace, id);
}
