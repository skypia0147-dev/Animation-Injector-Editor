import {featureValue, applyFeature} from './sharedFeatures.ts';
import type {FeatureValue} from './sharedFeatures.ts';
import {rows} from '../timeline/model.ts';
import {selectsOnly, type Workspace, defaultCamera} from '../workspace.ts';
import {clipEffects} from '../clipEffects.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {graphPosition} from './projection.ts';
import {nodeSettings, applyNodeSettings} from './nodeSettings.ts';
import {flatGraph, flatId} from './flat.ts';
import {animId, blendNodes} from './blends.ts';
import {nodeId, nodeOwner, parseNodeId} from './nodeRef.ts';
import {tr} from '../i18n/korean.ts';
export type SharedRule = {kind: 'effect' | 'link' | 'camera' | 'state' | 'feature' | 'node'; members: string[]};
const key = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
export function ruleValue(w: Workspace, kind: SharedRule['kind'], member: string): unknown {
  if (kind === 'node') return nodeSettings(w, member);
  if (kind === 'feature') return featureValue(w, member);
  if (kind === 'link') {
    const l = w.links.find(l => l.id === member);
    if (!l) return;
    const {id, from, position, ...value} = l;
    return value;
  }
  const [owner, id] = member.split('|'),
    a = w.actions.find(a => a.uid === owner);
  if (kind === 'state')
    return a ? Object.fromEntries(['air', 'cooldown'].map(k => [k, a.config[k as keyof typeof a.config]])) : undefined;
  if (kind === 'camera') return a?.cameraEnabled ? a.camera : undefined;
  if (!a || (a.pair && !a.pair.effectsEnabled)) return undefined;
  return clipEffects(a).find(e => e.id === id)?.values;
}
export function shareRules(w: Workspace): Workspace {
  const next = structuredClone(w),
    groups = new Map<string, SharedRule>();
  const add = (kind: SharedRule['kind'], member: string) => {
    const value = ruleValue(w, kind, member);
    if (value === undefined) return;
    const signature = kind + key(value),
      g = groups.get(signature) ?? {kind, members: []};
    g.members.push(member);
    groups.set(signature, g);
  };
  for (const a of w.actions) {
    for (const r of rows(w, a)) {
      if (r.effect) add('effect', a.uid + '|' + r.effect.id);
      else if (!r.transition && !r.effect) add('feature', a.uid + '|' + r.id);
    }
    if (a.pair) add('camera', a.uid);
  }
  for (const a of w.actions) if (a.config.air !== 'deny' || a.config.cooldown > 0) add('state', a.uid);
  next.sharedOutputPose = true;
  // Transition destinations belong to paths, so shared input settings omit them.
  const covered = new Set([...groups.values()].flatMap(g => g.members.map(m => ruleNode(g.kind, m, w))));
  for (const n of flatGraph(w).nodes)
    if (!covered.has(n.id) && parseNodeId(n.id).kind !== 'draft' && n.kind !== 'outputPose') add('node', n.id);
  next.sharedRules = [...groups.values()].filter(g => g.members.length > 1);
  return next;
}
// One event receiver per event: XML carries no sharing, so an import drew a receiver per source.
// Event links equal but for their source join a link rule (what reusing a receiver builds), start
// triggers with equal settings a node rule. Links that differ elsewhere (another destination or
// window) stay apart: one node would draw routes that do not exist. Existing rules are kept.
export function shareEventReceivers(w: Workspace): Workspace {
  const taken = new Set((w.sharedRules ?? []).flatMap(g => g.members.map(m => ruleNode(g.kind, m, w)))),
    groups = new Map<string, SharedRule>();
  const add = (kind: SharedRule['kind'], member: string) => {
    const value = ruleValue(w, kind, member);
    if (value === undefined || taken.has(ruleNode(kind, member, w))) return;
    const signature = kind + key(value),
      g = groups.get(signature) ?? {kind, members: []};
    g.members.push(member);
    groups.set(signature, g);
  };
  for (const l of w.links) if (l.mode === 'event') add('link', l.id);
  for (const a of w.actions)
    if (a.config.start.mode === 'event') add('node', flatId({kind: 'start', action: a.uid}, 'markerReceive'));
  const shared = [...groups.values()].filter(g => g.members.length > 1);
  return shared.length ? {...w, sharedRules: [...(w.sharedRules ?? []), ...shared]} : w;
}
export function shareNodeSettings(w: Workspace, source: string, target: string): Workspace {
  const value = nodeSettings(w, source),
    other = nodeSettings(w, target);
  if (!value || !other || value.kind !== other.kind) throw Error(tr('같은 기능의 설정만 공유할 수 있습니다.'));
  if (source === target) return w;
  const n = structuredClone(w),
    groups = (n.sharedRules ??= []);
  const sourceGroup = groups.find(g => g.members.some(m => ruleNode(g.kind, m, n) === source));
  const members = sourceGroup ? sourceGroup.members.map(m => ruleNode(sourceGroup.kind, m, n)) : [source];
  // Explicitly joining a shared definition detaches only the new member from its old definition.
  n.sharedRules = groups
    .map(g => ({
      ...g,
      members: g.members.filter(m => !members.includes(ruleNode(g.kind, m, n)) && ruleNode(g.kind, m, n) !== target),
    }))
    .filter(g => g.members.length > 1);
  applyNodeSettings(n, target, value);
  n.sharedRules.push({kind: 'node', members: [...new Set([...members, target])]});
  return n;
}
export function synchronizeRules(before: Workspace, next: Workspace): Workspace {
  for (const group of next.sharedRules ?? []) {
    const previous = before.sharedRules?.find(
      g => g.kind === group.kind && g.members.some(m => group.members.includes(m))
    );
    if (!previous) continue;
    const changed = group.members.find(
      m => key(ruleValue(before, group.kind, m)) !== key(ruleValue(next, group.kind, m))
    );
    if (!changed) continue;
    const value = ruleValue(next, group.kind, changed);
    // Deleting an action removes membership, not the shared definition for other actors.
    if (value === undefined) {
      group.members = group.members.filter(m => ruleValue(next, group.kind, m) !== undefined);
      continue;
    }
    for (const member of group.members) {
      if (group.kind === 'node') {
        applyNodeSettings(next, member, value as NonNullable<ReturnType<typeof nodeSettings>>);
        continue;
      }
      if (group.kind === 'feature') {
        applyFeature(next, member, value as FeatureValue);
        continue;
      }
      if (group.kind === 'link') {
        const l = next.links.find(l => l.id === member);
        if (l) Object.assign(l, structuredClone(value));
      } else {
        const [owner, id] = member.split('|'),
          a = next.actions.find(a => a.uid === owner);
        if (group.kind === 'state') {
          if (a) Object.assign(a.config, structuredClone(value));
          continue;
        }
        // Camera restore is any action's (10-16); the other effects are a pair's.
        if (group.kind === 'camera') {
          if (a) a.camera = {...(a.camera ?? defaultCamera()), ...structuredClone(value)};
          continue;
        }
        if (!a) continue;
        {
          const e = clipEffects(a).find(e => e.id === id);
          if (e) e.values = structuredClone(value) as Record<string, string>;
        }
      }
    }
  }
  next.sharedRules = next.sharedRules?.filter(g => g.members.length > 1);
  return next;
}
export function ruleNode(kind: SharedRule['kind'], member: string, w: Workspace): string {
  if (kind === 'node') return member;
  if (kind === 'feature') return `notify:${member}`;
  if (kind === 'state') return flatId({kind: 'start', action: member}, 'stateCondition');
  if (kind === 'effect') {
    const [a, e] = member.split('|');
    return nodeId({kind: 'notify', owner: a, local: 'effect:' + e});
  }
  if (kind === 'camera') return animId(member, 'cameraRestore');
  const l = w.links.find(l => l.id === member);
  return flatId({kind: 'link', link: member}, l?.mode === 'event' ? 'markerReceive' : 'keyInput');
}
export function ruleOwner(w: Workspace, kind: SharedRule['kind'], member: string): string | undefined {
  const id = ruleNode(kind, member, w),
    ref = parseNodeId(id);
  if (ref.kind === 'scoped' && ref.scope.kind === 'link') {
    const link = ref.scope.link;
    return w.links.find(l => l.id === link)?.from;
  }
  // Nodes inside an action's start, anim or transition graph, its notify rows and branches.
  if (ref.kind === 'notify' || ref.kind === 'branch' || ref.kind === 'scoped') return nodeOwner(ref);
  const b = blendNodes(w).find(b => b.id === id);
  if (b) {
    const endpoint = b.source === 'entry' ? b.target : b.source;
    return w.actions.find(a => a.uid === endpoint)?.uid ?? endpoint.split(':')[1];
  }
}
export function compactGraph(w: Workspace, graph: {nodes: FlatNode[]; edges: GraphEdge[]}, fold = false) {
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
  const actionById = new Map(w.actions.map(a => [a.uid, a] as const));
  const dispatchers = new Set(w.actions.filter(selectsOnly).map(a => a.uid));
  const blendTargets = new Set(graph.edges.filter(e => byId.get(e.source)?.kind === 'blend').map(e => e.target));
  for (const a of w.actions) {
    const own = byAction.get(a.uid) ?? [];
    const play = own.find(n => n.kind === 'hkxPlay');
    if (!play) continue;
    for (const n of own.filter(n => ['state', 'pairedPlay', 'findPartner'].includes(n.kind))) {
      aliases.set(n.id, play.id);
      hidden.add(n.id);
    }
    play.title = a.config.name || play.title;
    // Its conditions send every route elsewhere: no HKX of its own plays, so no card (its playback tails go
    // with it below). A route can still come back to it from a condition's list (graph/pinTargets.ts).
    if (dispatchers.has(a.uid)) hidden.add(play.id);
    if (a.pair) play.summary = tr('페어 · ') + play.summary;
    for (const n of own.filter(n => n.kind === 'outputPose')) if (!blendTargets.has(n.id)) hidden.add(n.id);
  }
  for (const group of w.sharedRules ?? []) {
    const ids = group.members.map(m => ruleNode(group.kind, m, w)).filter(id => byId.has(id));
    const first = byId.get(ids[0]);
    if (!first || ids.length < 2) continue;
    first.summary += tr(' · 공유 {length}개 동작', {length: ids.length});
    // Playback nodes are execution contexts: keep their separately selectable routes.
    if (first.kind === 'hkxPlay') {
      for (const id of ids.slice(1)) {
        const n = byId.get(id);
        if (n) n.summary += tr(' · 설정 공유 {length}개 동작', {length: ids.length});
      }
      continue;
    }
    ids.slice(1).forEach(id => {
      aliases.set(id, first.id);
      hidden.add(id);
    });
  }
  const operandSources = new Set(graph.edges.filter(e => e.id.startsWith('operand:')).map(e => e.source)),
    routeTargets = new Set(graph.edges.filter(e => !e.id.startsWith('operand:')).map(e => e.target));
  for (const n of nodes)
    if (parseNodeId(n.id).kind === 'branch' && operandSources.has(n.id) && !routeTargets.has(n.id)) hidden.add(n.id);
  const resolve = (id: string): string => (aliases.has(id) ? resolve(aliases.get(id)!) : id);
  const edges: GraphEdge[] = [],
    edgeById = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    const sourceAction = actionById.get(e.source),
      targetAction = actionById.get(e.target);
    if (sourceAction?.flow && e.target === `flow:${sourceAction.uid}:${sourceAction.flow.entry}`) continue;
    const source = resolve(e.source),
      target = targetAction?.flow?.tests.some(t => t.id === targetAction.flow!.entry)
        ? `flow:${targetAction.uid}:${targetAction.flow.entry}`
        : resolve(e.target);
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
  // Remove presentation-only tails of a dispatcher, retaining shared rules
  // whose incoming edges still originate from real playback nodes.
  const sourcesOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = sourcesOf.get(e.target);
    if (list) list.push(e.source);
    else sourcesOf.set(e.target, [e.source]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes)
      if (
        !hidden.has(n.id) &&
        n.action &&
        dispatchers.has(n.action) &&
        (['notify', 'cameraRestore', 'blend', 'outputPose'].includes(n.kind) ||
          (n.kind === 'markerReceive' && n.scope.kind === 'link')) &&
        !sourcesOf.get(n.id)?.some(source => !hidden.has(source))
      ) {
        hidden.add(n.id);
        changed = true;
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
  if (w.sharedOutputPose) {
    const outputs = visible.filter(n => n.kind === 'outputPose'),
      ids = new Set(outputs.map(n => n.id)),
      first = outputs[0];
    if (first) {
      const id = 'shared:outputPose';
      return {
        nodes: [
          ...visible.filter(n => !ids.has(n.id)),
          {
            ...first,
            id,
            action: undefined,
            title: tr('출력 포즈'),
            summary: tr('공통 출력 · ') + outputs.length + tr('개 종료'),
            position: graphPosition(w, {kind: 'root'}, id, first.position),
          },
        ],
        edges: visibleEdges.map(e => (ids.has(e.target) ? {...e, target: id} : e)),
      };
    }
  }
  return {nodes: visible, edges: visibleEdges};
}
