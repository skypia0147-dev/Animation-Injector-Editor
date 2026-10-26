import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {parseNodeId} from './nodeRef.ts';
import {tr} from '../i18n/korean.ts';
/** Event transitions drawn as one receiver (XML carries no sharing: an import joins equal ones, shareEventReceivers).
 *  A member is a link id. */
export type SharedRule = {kind: 'link'; members: string[]};
const key = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
/** A link's settings but its source and place: what its group shares. */
function linkValue(w: Workspace, member: string): unknown {
  const l = w.links.find(l => l.id === member);
  if (!l) return;
  const {id, from, position, ...value} = l;
  return value;
}
// One event receiver per event: XML carries no sharing, so an import drew a receiver per source.
// Event links equal but for their source join a link rule (what reusing a receiver builds). Links that differ
// elsewhere (another destination or window) stay apart: one node would draw routes that do not exist. Existing
// rules are kept.
export function shareEventReceivers(w: Workspace): Workspace {
  const taken = new Set((w.sharedRules ?? []).flatMap(g => g.members)),
    groups = new Map<string, SharedRule>();
  for (const l of w.links) {
    if (l.mode !== 'event' || taken.has(l.id)) continue;
    const signature = key(linkValue(w, l.id)),
      g = groups.get(signature) ?? {kind: 'link' as const, members: []};
    g.members.push(l.id);
    groups.set(signature, g);
  }
  const shared = [...groups.values()].filter(g => g.members.length > 1);
  return shared.length ? {...w, sharedRules: [...(w.sharedRules ?? []), ...shared]} : w;
}
/** After an edit: a change to one member of a group is made to every member. */
export function synchronizeRules(before: Workspace, next: Workspace): Workspace {
  for (const group of next.sharedRules ?? []) {
    const previous = before.sharedRules?.find(g => g.members.some(m => group.members.includes(m)));
    if (!previous) continue;
    const changed = group.members.find(m => key(linkValue(before, m)) !== key(linkValue(next, m)));
    if (!changed) continue;
    const value = linkValue(next, changed);
    // Deleting a link removes its membership, not the others' shared settings.
    if (value === undefined) {
      group.members = group.members.filter(m => linkValue(next, m) !== undefined);
      continue;
    }
    for (const member of group.members) {
      const l = next.links.find(l => l.id === member);
      if (l) Object.assign(l, structuredClone(value));
    }
  }
  next.sharedRules = next.sharedRules?.filter(g => g.members.length > 1);
  return next;
}
/** A group member's canvas node. */
export const ruleNode = (_kind: SharedRule['kind'], member: string, _w?: Workspace) => 'transition:' + member;
/** The action a group member belongs to (the link's source). */
export function ruleOwner(w: Workspace, kind: SharedRule['kind'], member: string): string | undefined {
  const ref = parseNodeId(ruleNode(kind, member));
  if (ref.kind === 'transition') {
    const link = ref.link;
    return w.links.find(l => l.id === link)?.from;
  }
}
export function compactGraph(w: Workspace, graph: {nodes: FlatNode[]; edges: GraphEdge[]}) {
  // Only titles, summaries and pin lists change below: a copy of each node with its own pin lists (the
  // input may be the rendered document's cached graph, graph/renderCache.ts).
  const nodes = graph.nodes.map(n => ({...n, inputs: [...n.inputs], outputs: [...n.outputs]})),
    aliases = new Map<string, string>(),
    hidden = new Set<string>();
  // Lookups by id and action, and the edges by endpoint: the loops below ran a scan per edge or node.
  const byId = new Map<string, FlatNode>(),
    byAction = new Map<string, FlatNode[]>();
  for (const n of nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n);
    if (n.action) {
      const list = byAction.get(n.action);
      if (list) list.push(n);
      else byAction.set(n.action, [n]);
    }
  }
  for (const a of w.actions) {
    const own = byAction.get(a.uid) ?? [];
    const play = own.find(n => n.kind === 'hkxPlay');
    if (!play) continue;
    for (const n of own.filter(n => ['state', 'pairedPlay', 'findPartner'].includes(n.kind))) {
      aliases.set(n.id, play.id);
      hidden.add(n.id);
    }
    play.title = a.config.name || play.title;
    if (a.pair) play.summary = tr('페어 · ') + play.summary;
    for (const n of own.filter(n => n.kind === 'outputPose')) hidden.add(n.id);
  }
  for (const group of w.sharedRules ?? []) {
    const ids = group.members.map(m => ruleNode(group.kind, m, w)).filter(id => byId.has(id));
    const first = byId.get(ids[0]);
    if (!first || ids.length < 2) continue;
    first.summary += tr(' · 공유 {length}개 동작', {length: ids.length});
    ids.slice(1).forEach(id => {
      aliases.set(id, first.id);
      hidden.add(id);
    });
  }
  const resolve = (id: string): string => (aliases.has(id) ? resolve(aliases.get(id)!) : id);
  const edges: GraphEdge[] = [],
    edgeById = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const source = resolve(e.source),
      target = resolve(e.target);
    if (source === target || hidden.has(source) || hidden.has(target)) continue;
    const s = byId.get(source),
      t = byId.get(target);
    if (!s || !t) continue;
    if (!s.outputs.includes(e.pin)) s.outputs.push(e.pin);
    const pin = e.targetPin ?? e.pin;
    if (!t.inputs.includes(pin)) t.inputs.push(pin);
    const id = (e.id.startsWith('operand:') ? 'operand:' : '') + `${source}>${target}:${e.pin}:${pin}`;
    const origins = e.origins ?? [{source: e.source, target: e.target, pin: e.pin, targetPin: e.targetPin}],
      previous = edgeById.get(id);
    if (previous) previous.origins!.push(...origins);
    else {
      const edge = {...e, id, source, target, origins: [...origins]};
      edges.push(edge);
      edgeById.set(id, edge);
    }
  }
  const visible = nodes.filter(n => !hidden.has(n.id)),
    visibleEdges = edges.filter(e => !hidden.has(e.source) && !hidden.has(e.target));
  const conditionTargets = new Set(visibleEdges.filter(e => (e.targetPin ?? e.pin) === 'condition').map(e => e.target)),
    conditionSources = new Set(visibleEdges.filter(e => e.pin === 'condition').map(e => e.source));
  for (const n of visible) {
    n.inputs = n.inputs.filter(p => p !== 'condition' || conditionTargets.has(n.id));
    n.outputs = n.outputs.filter(p => p !== 'condition' || conditionSources.has(n.id));
  }
  return {nodes: visible, edges: visibleEdges};
}
