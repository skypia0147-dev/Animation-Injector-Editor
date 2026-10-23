import {selectsOnly, type Workspace} from '../workspace.ts';
import {flatGraph, type FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {visibleEdges, disconnectEdge} from './disconnect.ts';
import {blendBinding, blendNodes, entryBlendActions} from './blends.ts';
import {tableProjection} from './conditionTables.ts';
import {copyNodes, type NodeClipboard} from './clipboard.ts';
import {retirePlayback} from './deletePlayback.ts';
import {deleteFlat} from './flat.ts';
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
// A selecting action's settings the runtime reads (workspace.ts SELECTING: Require, Suppress).
const SELECTING_ITEMS = new Set(['stateCondition', 'suppress']);
export const eventItem = (n: FlatNode) =>
  n.kind === 'cameraRestore' ||
  n.kind === 'fireArrow' ||
  n.kind === 'carryRelease' ||
  n.kind === 'carryFix' ||
  (!!n.notify && n.notify.startsWith('effect:'));
export type ChecklistItem = {
  node: FlatNode;
  bindings: GraphEdge[];
  enabled: boolean;
  toggleable: boolean;
  scope: string;
  category: 'feature' | 'event';
  /** A blend item's role: the start blend leads the card's list, the end blend closes it (graph/momentOrder.ts). */
  blend?: 'enter' | 'exit';
};
/** `raw` is the workspace's flat graph (graph/renderCache.ts passes the one it already has). */
export function checklistModel(w: Workspace, raw = flatGraph(w)) {
  const live = visibleEdges(w, raw.edges),
    plays = raw.nodes.filter(n => n.kind === 'hkxPlay');
  const liveIds = new Set(live.map(e => e.id)),
    blends = new Map(blendNodes(w).map(b => [b.id, b]));
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
  const unassigned = raw.nodes.filter(
    n => n.id.startsWith('draft:') && (internalKinds.has(n.kind) || n.kind === 'notify' || !!n.notify)
  );
  for (const n of unassigned) hidden.add(n.id);
  for (const p of plays) items.set(p.id, []);
  for (const n of raw.nodes) {
    if (n.id.startsWith('draft:')) continue;
    let eligible =
      (!!n.notify && !['transition', 'keyInput', 'markerReceive'].includes(n.kind)) || internalKinds.has(n.kind);
    let inherited: string[] = [];
    let blend: 'enter' | 'exit' | undefined;
    if (n.kind === 'blend')
      try {
        const b = blends.get(n.id);
        if (b) {
          const role = blendBinding(w, b);
          eligible = ['enter', 'exit'].includes(role.kind);
          if (role.kind === 'enter' || role.kind === 'exit') blend = role.kind;
          if (role.kind === 'enter') inherited = entryBlendActions(w, role.action);
        }
      } catch {}
    if (!eligible) continue;
    const bindings = connected.get(n.id) ?? [];
    const common = !n.notify?.startsWith('recovery:');
    let parents =
      common && n.action
        ? plays.filter(p => p.action === n.action)
        : plays.filter(p => bindings.some(e => e.source === p.id || e.target === p.id));
    if (!parents.length && n.action) parents = plays.filter(p => p.action === n.action);
    if (inherited.length) parents = plays.filter(p => inherited.includes(p.action ?? ''));
    if (!parents.length) continue;
    hidden.add(n.id);
    owners.set(
      n.id,
      parents.map(p => p.id)
    );
    for (const p of parents) {
      const direct = bindings.filter(e => e.source === p.id || e.target === p.id),
        applies = common ? bindings : direct.length ? direct : bindings;
      items.get(p.id)!.push({
        node: n,
        bindings: applies,
        enabled: applies.length === 0 || applies.every(e => liveIds.has(e.id)),
        // Every carry fixes its target (at the lift's end by default): the fix item is not switched off.
        toggleable: !['findPartner', 'pairedPlay', 'carryFix'].includes(n.kind),
        scope:
          inherited.length > 1
            ? tr('상위 진입 경로 · {length}개 동작', {length: inherited.length})
            : parents.length > 1
              ? tr('동작 공통 · {length}클립', {length: parents.length})
              : tr('이 클립'),
        category: eventItem(n) ? 'event' : 'feature',
        ...(blend ? {blend} : {}),
      });
    }
  }
  // The game's start is no card either: every start input already begins there. An imported action (no
  // nodeAuthored) draws it with a line to each start; an action made in the editor never did, so a project
  // looks the same whether it was made here or read from its XML.
  for (const n of raw.nodes.filter(n => n.kind === 'entry')) hidden.add(n.id);
  // The end of an action is no card: its exit blend is an item of the HKX card. Choosing an output pose (a
  // check's location) shows the HKX card.
  for (const n of raw.nodes.filter(n => n.kind === 'outputPose')) {
    hidden.add(n.id);
    const own = plays.filter(p => p.action === n.action);
    if (own.length && !owners.has(n.id))
      owners.set(
        n.id,
        own.map(p => p.id)
      );
  }
  // Only expression roots are canvas nodes. Child checks remain in their parent editor.
  for (const a of w.actions) {
    const tests = a.flow?.tests ?? [];
    for (const t of tests) {
      const id = `flow:${a.uid}:${t.id}`;
      if (w.conditionTables?.includes(a.uid)) {
        owners.set(id, [`conditionTable:${a.uid}`]);
        continue;
      }
      let parent = tests.find(p => p.operands?.includes(t.id));
      if (!parent) continue;
      hidden.add(id);
      const seen = new Set([t.id]);
      while (!seen.has(parent.id)) {
        seen.add(parent.id);
        const next = tests.find(p => p.operands?.includes(parent!.id));
        if (!next) break;
        parent = next;
      }
      owners.set(id, [`flow:${a.uid}:${parent.id}`]);
    }
  }
  // A selecting action (workspace.ts selectsOnly) never plays its own clip and has no card
  // (graph/sharing.ts). What the runtime reads before it picks (its conditions and the events it
  // suppresses) shows on the decision card; nothing else of its playback is written.
  for (const a of w.actions) {
    const f = a.flow;
    if (!f || !selectsOnly(a)) continue;
    const target = w.conditionTables?.includes(a.uid) ? `conditionTable:${a.uid}` : `flow:${a.uid}:${f.entry}`;
    const list = new Map<string, ChecklistItem>();
    for (const p of plays.filter(p => p.action === a.uid)) {
      const own = items.get(p.id) ?? [];
      for (const item of own.filter(i => SELECTING_ITEMS.has(i.node.kind))) {
        list.set(item.node.id, {...item, scope: tr('분기 진입 공통')});
        owners.set(item.node.id, [...new Set((owners.get(item.node.id) ?? []).map(id => (id === p.id ? target : id)))]);
      }
      items.set(p.id, []);
    }
    items.set(target, [...list.values()]);
  }
  return {raw, live, items, owners, hidden, unassigned};
}
export function setChecklistEnabled(w: Workspace, item: ChecklistItem, enabled: boolean): Workspace {
  if (!item.toggleable) return w;
  if (!enabled) {
    const next = item.bindings.reduce((n, e) => disconnectEdge(n, e), w);
    next.disconnections = next.disconnections?.map(c =>
      item.bindings.some(e => e.source === c.source && e.target === c.target && e.pin === c.pin)
        ? {...c, setting: true}
        : c
    );
    return next;
  }
  const keys = new Set(
    item.bindings
      .flatMap(e => e.origins ?? [e])
      .map(e => JSON.stringify([e.source, e.target, e.pin, e.targetPin ?? e.pin]))
  );
  return {
    ...w,
    disconnections: w.disconnections?.flatMap(c => {
      const bindings = c.bindings.filter(
        e => !keys.has(JSON.stringify([e.source, e.target, e.pin, e.targetPin ?? e.pin]))
      );
      return bindings.length ? [{...c, bindings}] : [];
    }),
  };
}
export function checklistProjection(w: Workspace, model = checklistModel(w)) {
  const {raw, live, hidden, owners} = model;
  let edges = visibleEdges({...w, disconnections: w.disconnections?.filter(c => !c.setting)}, raw.edges).map(e => ({
    ...e,
  }));
  // Contract a blend's visible path, retaining the original runtime bindings for deletion.
  for (const n of raw.nodes.filter(
    n => hidden.has(n.id) && ['blend', 'pairedPlay', 'cameraRestore'].includes(n.kind)
  )) {
    const incoming = edges.filter(e => e.target === n.id),
      outgoing = edges.filter(e => e.source === n.id);
    edges = edges.filter(e => e.source !== n.id && e.target !== n.id);
    for (const a of incoming)
      for (const b of outgoing)
        edges.push({
          ...a,
          id: `checklist:${a.id}:${b.id}`,
          target: b.target,
          targetPin: b.targetPin ?? b.pin,
          origins: [...(a.origins ?? [a]), ...(b.origins ?? [b])],
        });
  }
  const rawById = new Map<string, FlatNode>();
  for (const n of raw.nodes) if (!rawById.has(n.id)) rawById.set(n.id, n);
  edges = edges.flatMap(e => {
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
  let graph = tableProjection(w, compactGraph(w, {nodes: raw.nodes.filter(n => !hidden.has(n.id)), edges}));
  // Each node's pins, gathered in one pass over the edges (in edge order, as before).
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
      const playback = model.raw.nodes.some(n => n.id === id && n.kind === 'hkxPlay');
      if (playback || item.toggleable) selected.add(item.node.id);
      if (playback) carried.add(item.node.id);
    }
  const visible = checklistProjection(w, model),
    synthetic = visible.nodes.filter(n => selected.has(n.id) && !model.raw.nodes.some(r => r.id === n.id)),
    syntheticIds = new Set(synthetic.map(n => n.id));
  const graph = {
    nodes: [...model.raw.nodes, ...synthetic],
    edges: [...model.raw.edges, ...visible.edges.filter(e => syntheticIds.has(e.source) || syntheticIds.has(e.target))],
  };
  return {...copyNodes(w, graph, [...selected]), cardItems: [...carried]};
}
export function deleteChecklistNode(w: Workspace, id: string): Workspace {
  const n = flatGraph(w).nodes.find(n => n.id === id),
    a = w.actions.find(a => a.uid === n?.action);
  if (n?.kind === 'hkxPlay' && a?.config.steps.length === 1) return retirePlayback(w, a.uid, false);
  const next = deleteFlat(w, id);
  // A selecting action with no HKX of its own whose last condition is gone plays nothing: it goes too (its hidden
  // HKX card came back empty and its entry settings stayed in the XML), its start card left as a loose card.
  const left = a && next.actions.find(x => x.uid === a.uid);
  return left && selectsOnly(a) && !a.config.steps[0]?.clip && !left.flow?.tests.length
    ? retirePlayback(next, a.uid, false)
    : next;
}
