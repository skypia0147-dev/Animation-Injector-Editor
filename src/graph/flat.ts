import {putdownCandidate, setPutdown} from '../carry.ts';
import {recoveryStep} from '../clipRecovery.ts';
import {qteMembers} from './qteGroups.ts';
import {projectQtes, addQte, connectQte, qteCardOf} from './qteGraph.ts';
import {expressionSummary} from './conditionExpression.ts';
import {retirePlayback} from './deletePlayback.ts';
import {reuseConnection} from './reuseConnection.ts';
import {ruleNode} from './sharing.ts';
import {setBranchTarget, deleteCondition, setConditionOperands} from './conditionCommands.ts';
import {reconnectEdge} from './disconnect.ts';
import {playbackLink} from './playback.ts';
import {branchId} from './conditions.ts';
import {fanOf, fanOfBranch, fanState} from './conditionFans.ts';
import {branchTest, parseNodeId} from './nodeRef.ts';
import type {NodeRef} from './nodeRef.ts';
import type {Workspace} from '../workspace.ts';
import type {GraphRef} from './state.ts';
import {graphId} from './state.ts';
import {
  projectGraph,
  graphPosition,
  graphAction,
  deleteGraphNode,
  connectGraph,
  addGraphItem,
  moveNodes,
} from './projection.ts';
import type {GraphNode, GraphEdge} from './projection.ts';
import {rows, remove, add, title} from '../timeline/model.ts';
import {timingLabel} from '../model.ts';
import type {NodeKind} from '../nodes/catalog.ts';
import {blendNodes, blendBinding, editBlend, animId, lowerBlends} from './blends.ts';
import {t} from '../i18n/index.ts';
import {makeDraft, draftScope, draftWorkspace, attachDraft} from './drafts.ts';
import {addAction} from '../workspace.ts';
import {tr} from '../i18n/korean.ts';
import {functionParts} from '../eventRegistry.ts';
export type FlatNode = Omit<GraphNode, 'kind'> & {
  kind: string;
  scope: GraphRef;
  original: string;
  action?: string;
  notify?: string;
  /** In a single-flow view: another action's card the flow hands over to (graph/navigation.ts actionFlow). */
  neighbor?: boolean;
  /** An event's QTE (runtime 0.12.264): its partner pins are the pair partner's ("상대"), not the victim's. */
  eventQte?: boolean;
  /** A fanned branch (graph/conditionFans.ts): its number, whether the order reaches it, whether its own fail
   *  points back to an earlier branch, and whether its fail is connected or tries the next branch. */
  fan?: {
    index: number;
    count: number;
    parent: string;
    reached: boolean;
    back: boolean;
    ownFail: boolean;
    /** The place of the branch its own fail goes to, when that is a branch of the same fan. */
    failTo?: number;
    next?: string;
  };
  /** A condition whose pass fans out: how many branches. */
  fanCount?: number;
};
export const flatId = (g: GraphRef, id: string) => (g.kind === 'root' ? id : `${graphId(g)}|${id}`);
/** The project's event registry node (eventRegistry.ts): always present, never deleted or copied. */
export const REGISTRY_NODE = 'eventRegistry';
const root: GraphRef = {kind: 'root'};
export function flatGraph(w: Workspace) {
  const nodes: FlatNode[] = [],
    edges: GraphEdge[] = [],
    // Wiring looks nodes up by id hundreds of times: an index instead of scanning every node each time.
    byId = new Map<string, FlatNode>();
  const add = (n: FlatNode) => {
    nodes.push(n);
    if (!byId.has(n.id)) byId.set(n.id, n);
  };
  const put = (n: GraphNode, scope: GraphRef, x: number, y: number, action?: string) => {
    const id = flatId(scope, n.id);
    add({
      ...n,
      id,
      scope,
      original: n.id,
      action,
      open: undefined,
      position: graphPosition(w, root, id, {x, y}),
    });
    return id;
  };
  const wire = (source: string, target: string, pin: GraphEdge['pin'] = 'trigger') => {
    const s = byId.get(source),
      d = byId.get(target);
    if (!s || !d) return;
    if (!s.outputs.includes(pin)) s.outputs = [...s.outputs, pin];
    if (!d.inputs.includes(pin)) d.inputs = [...d.inputs, pin];
    edges.push({id: `flat:${source}>${target}:${pin}`, source, target, pin});
  };
  const section = (g: GraphRef, x: number, y: number, action?: string) => {
    const p = projectGraph(w, g);
    const settings = graphAction(w, g);
    if (settings?.nodeAuthored) {
      const hidden: string[] = [];
      if (!blendNodes(w).some(b => b.target === animId(settings.uid, 'outputPose'))) hidden.push('outputPose');
      if (!settings.config.cooldown && settings.config.air === 'deny') hidden.push('stateCondition');
      p.nodes = p.nodes.filter(n => !hidden.includes(n.kind));
      const kept = new Set(p.nodes.map(n => n.id));
      p.edges = p.edges.filter(e => kept.has(e.source) && kept.has(e.target));
    }
    // Blend nodes are projected separately from their actual endpoints.
    for (const id of ['blendIn', 'blendOut', 'detectionWindow']) {
      const incoming = p.edges.filter(e => e.target === id),
        outgoing = p.edges.filter(e => e.source === id);
      p.edges = p.edges.filter(e => e.source !== id && e.target !== id);
      for (const a of incoming) for (const b of outgoing) p.edges.push({...b, id: a.id + b.id, source: a.source});
      p.nodes = p.nodes.filter(n => n.id !== id);
    }
    for (const n of p.nodes) {
      if (n.kind === 'outputPose' && settings?.nodeAuthored) {
        n.title = tr('재생 종료');
        n.summary = tr('생략 시 기본 종료');
      }
      if (n.kind === 'hkxPlay' && settings?.nodeAuthored) {
        n.inputs = ['trigger'];
        n.outputs = ['trigger'];
      }
      if (n.kind === 'keyInput' || n.kind === 'markerReceive') {
        const rule = g.kind === 'link' ? w.links.find(l => l.id === g.link && l.window) : undefined;
        if (rule) n.summary += ' · ' + timingLabel(rule.open) + ' → ' + timingLabel(rule.close);
      }
    }
    if (g.kind === 'start') {
      p.nodes = p.nodes.filter(n => n.id !== 'result');
      for (const n of p.nodes) put(n, g, x + n.position.x, y + n.position.y, action);
      for (const e of p.edges)
        if (e.target === 'result')
          wire(
            flatId(g, e.source),
            settings?.nodeAuthored ? animId(g.action, 'clip_' + settings.config.entry) : g.action,
            e.pin
          );
      return;
    }
    for (const n of p.nodes) put(n, g, x + n.position.x, y + n.position.y, action);
    for (const e of p.edges)
      edges.push({...e, id: flatId(g, e.id), source: flatId(g, e.source), target: flatId(g, e.target)});
  };
  const base = projectGraph(w, root);
  for (const n of base.nodes.filter(n => n.kind === 'entry' || n.kind === 'comment'))
    if (n.kind !== 'entry' || !w.actions.every(a => a.nodeAuthored)) put(n, root, n.position.x, n.position.y);
  for (const [i, a] of w.actions.entries()) {
    const y = i * 1100;
    const state = base.nodes.find(n => n.id === a.uid)!;
    if (!a.nodeAuthored) put({...state, inputs: ['trigger'], outputs: ['trigger']}, root, 1000, y, a.uid);
    const start: GraphRef = {kind: 'start', action: a.uid};
    section(start, 0, y, a.uid);
    wire('entry', flatId(start, 'keyInput'));
    wire('entry', flatId(start, 'markerReceive'));
    if (!a.config.steps.length) continue;
    const anim: GraphRef = {kind: 'anim', action: a.uid};
    section(anim, 1300, y, a.uid);
    for (const s of a.config.steps) wire(a.uid, flatId(anim, 'clip_' + s.id));
    if (a.nodeAuthored) {
      if (a.config.start.mode !== 'none')
        wire(
          flatId(start, a.config.start.mode === 'event' ? 'markerReceive' : 'keyInput'),
          animId(a.uid, 'clip_' + a.config.entry)
        );
      wire(flatId(start, 'stateCondition'), animId(a.uid, 'clip_' + a.config.entry), 'condition');
    }
    for (const [j, r] of rows(w, a)
      .filter(r => !r.transition)
      .entries()) {
      const id = `notify:${a.uid}|${r.id}`;
      add({
        id,
        scope: root,
        original: id,
        action: a.uid,
        notify: r.id,
        kind: 'notify',
        title: r.label,
        // A clip-time function says its settings too (a shake's strength and duration).
        summary: [
          timingLabel(r.from) + (r.until ? ' → ' + timingLabel(r.until) : ''),
          ...(r.effect ? functionParts(r.effect.values) : []),
        ].join(' · '),
        position: graphPosition(w, root, id, {x: 1300 + j * 260, y: y + 650}),
        inputs: ['trigger'],
        outputs: [],
      });
      if (recoveryStep(r.id)) wire(animId(a.uid, 'clip_' + recoveryStep(r.id)), id);
      else wire(a.nodeAuthored ? animId(a.uid, 'clip_' + a.config.entry) : a.uid, id);
    }
  }
  for (const a of w.actions)
    if (a.pair?.carry?.putdownAction) {
      const lower = w.actions.find(x => x.uid === a.pair!.carry!.putdownAction);
      if (lower) wire(animId(a.uid, 'carry'), animId(lower.uid, 'clip_' + lower.config.entry));
    }
  for (const [i, l] of w.links.entries()) {
    const g: GraphRef = {kind: 'link', link: l.id};
    section(g, 4000, i * 450, l.from);
    const input = flatId(g, l.mode === 'event' ? 'markerReceive' : 'keyInput');
    const from = w.actions.find(a => a.uid === l.from)!,
      to = w.actions.find(a => a.uid === l.to)!;
    const inputNode = byId.get(input);
    if (inputNode) inputNode.title = l.mode === 'event' ? tr('전환 이벤트') : tr('전환 키 입력');
    wire(from.nodeAuthored ? animId(from.uid, 'clip_' + from.config.entry) : l.from, input);
    wire(flatId(g, 'result'), to.nodeAuthored ? animId(to.uid, 'clip_' + to.config.entry) : l.to);
    const partner = l.partnerTo ? w.actions.find(a => a.uid === l.partnerTo) : undefined;
    // A node-authored action shows its HKX, not a state node: the partner's line ends there, like the starter's.
    if (partner)
      wire(
        flatId(g, 'result'),
        partner.nodeAuthored ? animId(partner.uid, 'clip_' + partner.config.entry) : partner.uid,
        'partner'
      );
    else if (from.pair && !to.pair) {
      // From a pair to an ordinary action the partner starts its own action: the pin is there to connect it.
      if (inputNode && !inputNode.outputs.includes('partner')) inputNode.outputs = [...inputNode.outputs, 'partner'];
    }
  }
  // The first node-authored action per uid (visibleEndpoint ran a scan of every action per link per blend).
  const authored = new Map<string, (typeof w.actions)[number]>();
  for (const a of w.actions) if (a.nodeAuthored && !authored.has(a.uid)) authored.set(a.uid, a);
  for (const b of blendNodes(w)) {
    let label = tr('연결 필요'),
      title = t('row.blend'),
      action = byId.get(b.target)?.action || byId.get(b.source)?.action;
    try {
      const role = blendBinding(w, b);
      label = role.label;
      action = role.action;
      // A card's start or end blend is named by where it plays, its time the summary (docs/mockup-card-cleanup ②).
      if (role.kind === 'enter' && role.label === tr('시작')) title = tr('블렌드(시작)');
      if (role.kind === 'exit') title = tr('블렌드(종료)');
    } catch {
      /* Incomplete drafts remain editable. */
    }
    const visibleEndpoint = (id: string) => {
      const a = authored.get(id);
      return a ? animId(a.uid, 'clip_' + a.config.entry) : id;
    };
    const routeTarget = visibleEndpoint(b.target);
    const source = byId.get(visibleEndpoint(b.source)),
      target = byId.get(routeTarget);
    const position = {
      x: ((source?.position.x ?? 500) + (target?.position.x ?? 1000)) / 2,
      y: (target?.position.y ?? source?.position.y ?? 0) + 150,
    };
    add({
      id: b.id,
      kind: 'blend',
      title,
      summary: title === t('row.blend') ? `${b.seconds} s · ${label}` : b.seconds + tr('초'),
      scope: root,
      original: b.id,
      action,
      inputs: ['trigger'],
      outputs: ['trigger'],
      position: graphPosition(w, root, b.id, position),
    });
    // Replace the corresponding route, keeping transition input/window evaluation intact.
    let routeSource = visibleEndpoint(b.source);
    const link = w.links.find(
      l =>
        (visibleEndpoint(l.from) === visibleEndpoint(b.source) && visibleEndpoint(l.to) === routeTarget) ||
        b.source === `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`
    );
    if (link) routeSource = flatId({kind: 'link', link: link.id}, 'result');
    if (target?.kind === 'outputPose') {
      const e = edges.find(e => e.target === target.id && e.pin === 'pose');
      if (e) routeSource = e.source;
    }
    for (let i = edges.length - 1; i >= 0; i--)
      if (edges[i].source === routeSource && edges[i].target === routeTarget) edges.splice(i, 1);
    wire(routeSource, b.id);
    wire(b.id, routeTarget);
  }
  for (const d of w.drafts ?? []) {
    const temp = draftWorkspace(w, d),
      scope = draftScope(d);
    const r = d.notify ? rows(temp, d.value).find(r => r.id === d.notify) : undefined;
    const visual = d.notify ? undefined : projectGraph(temp, scope).nodes.find(n => n.id === d.local);
    add({
      id: d.id,
      kind: d.notify ? 'notify' : d.kind,
      title: r?.label ?? visual?.title ?? t('node.' + d.kind),
      summary: (r ? timingLabel(r.from) : (visual?.summary ?? '')) + tr(' · 연결 전'),
      scope,
      original: d.local,
      action: d.owner,
      inputs: ['trigger'],
      outputs:
        d.kind === 'conditionTable'
          ? (d.value.flow?.tests.flatMap(t => ['pass', 'fail'].map(p => `choice:${t.id}:${p}` as const)) ?? [])
          : ['trigger'],
      position: graphPosition(w, root, d.id, {x: 500, y: 500}),
    });
    if (d.from) wire(animId(d.owner, 'clip_' + d.from), d.id);
    if (d.to) wire(d.id, animId(d.owner, 'clip_' + d.to));
  }
  // Results are compiler routing points, not editable runtime operations.
  // Each result's edges are replaced by edges from its sources to its targets, one result after another (a
  // result's new edges may end at the next result). Indexed by endpoint; removed edges drop out at the end
  // in one pass, so the remaining edges keep their order.
  const results = nodes.filter(n => n.kind === 'result');
  if (results.length) {
    const bySource = new Map<string, GraphEdge[]>(),
      byTarget = new Map<string, GraphEdge[]>(),
      removed = new Set<GraphEdge>();
    const index = (e: GraphEdge) => {
      for (const [map, key] of [
        [bySource, e.source],
        [byTarget, e.target],
      ] as const) {
        const list = map.get(key);
        if (list) list.push(e);
        else map.set(key, [e]);
      }
    };
    for (const e of edges) index(e);
    for (const n of results) {
      const live = (list: GraphEdge[] | undefined) => (list ?? []).filter(e => !removed.has(e));
      const incoming = live(byTarget.get(n.id)),
        outgoing = live(bySource.get(n.id));
      for (const e of incoming) removed.add(e);
      for (const e of outgoing) removed.add(e);
      for (const a of incoming)
        for (const b of outgoing) {
          const count = edges.length;
          wire(a.source, b.target, b.pin);
          for (let i = count; i < edges.length; i++) index(edges[i]);
        }
    }
    if (removed.size) {
      let kept = 0;
      for (const e of edges) if (!removed.has(e)) edges[kept++] = e;
      edges.length = kept;
    }
  }
  for (const a of w.actions)
    if (a.flow) {
      const host = animId(a.uid, 'clip_' + a.config.entry);
      if (a.flow.tests.some(t => t.id === a.flow!.entry))
        for (const e of edges) if (e.target === host && e.pin === 'trigger') e.target = branchId(a.uid, a.flow.entry);
      const fanned = new Map<string, NonNullable<FlatNode['fan']>>();
      for (const fan of a.flow.fans ?? [])
        for (const s of fanState(a.flow, fan))
          fanned.set(s.id, {
            index: s.index,
            count: fan.branches.length,
            parent: branchId(a.uid, fan.parent),
            reached: s.reached,
            back: s.back,
            ownFail: s.ownFail,
            failTo: s.failTo,
            next: s.next && branchId(a.uid, s.next),
          });
      for (const [i, test] of a.flow.tests.entries()) {
        const id = branchId(a.uid, test.id);
        const fan = fanOf(a.flow, test.id),
          member = fanOfBranch(a.flow, test.id);
        add({
          ...(fanned.has(test.id) ? {fan: fanned.get(test.id)} : {}),
          ...(fan ? {fanCount: fan.branches.length} : {}),
          id,
          kind: 'conditionBranch',
          scope: root,
          original: test.id,
          action: a.uid,
          title: test.label || (test.negate ? tr('조건 분기 · NOT') : tr('조건 분기')),
          summary: expressionSummary(a.flow, test.id),
          inputs: ['trigger'],
          outputs: ['pass', 'fail'],
          position: graphPosition(w, root, id, {
            x: 300 + w.actions.filter(a => a.flow).findIndex(owner => owner.uid === a.uid) * 650,
            y: 180 + i * 150,
          }),
        });
        for (const port of ['pass', 'fail'] as const) {
          // A fan's pass: a line to each branch in its order. A branch's empty fail tries the next branch: no line.
          if (port === 'pass' && fan) {
            fan.branches.forEach((b, rank) => {
              const target = branchId(a.uid, b),
                n = byId.get(target);
              if (n && !n.inputs.includes('trigger')) n.inputs.push('trigger');
              edges.push({id: `${id}:pass:${b}`, source: id, target, pin: 'pass', targetPin: 'trigger', rank});
            });
            continue;
          }
          if (port === 'fail' && member && !member.fan.fails[test.id]) continue;
          const end = test[port];
          if (!end) continue;
          const dest = 'action' in end ? w.actions.find(x => x.uid === end.action) : undefined;
          const target =
            'node' in end ? branchId(a.uid, end.node) : dest ? animId(dest.uid, 'clip_' + dest.config.entry) : '';
          if (target) {
            const n = byId.get(target);
            if (n && !n.inputs.includes('trigger')) n.inputs.push('trigger');
            edges.push({id: `${id}:${port}`, source: id, target, pin: port, targetPin: 'trigger'});
          }
        }
      }
    }
  // Group operands are predicate dependencies, separate from pass/fail execution routes.
  for (const a of w.actions)
    if (a.flow)
      for (const group of a.flow.tests) {
        for (const operand of group.operands ?? []) {
          const source = byId.get(branchId(a.uid, operand));
          const target = byId.get(branchId(a.uid, group.id));
          if (!source || !target) continue;
          if (!source.outputs.includes('condition')) source.outputs.push('condition');
          if (!target.inputs.includes('condition')) target.inputs.push('condition');
          edges.push({
            id: `operand:${source.id}>${target.id}`,
            source: source.id,
            target: target.id,
            pin: 'condition',
            targetPin: 'condition',
          });
        }
      }
  projectQtes(w, nodes, edges);
  // The global event registry: one node per project, without ports (it runs on names, not routes).
  add({
    id: REGISTRY_NODE,
    kind: 'eventRegistry',
    title: tr('이벤트 등록'),
    summary: '',
    scope: root,
    original: REGISTRY_NODE,
    inputs: [],
    outputs: [],
    position: graphPosition(w, root, REGISTRY_NODE, {x: -700, y: 0}),
  });
  // One edge per id: the first one's place, the last one's value.
  const unique = new Map<string, GraphEdge>();
  for (const e of edges) unique.set(e.id, e);
  return {
    nodes: nodes.filter(n => n.kind !== 'result'),
    edges: [...unique.values()],
  };
}
export function flatNode(w: Workspace, id: string) {
  return flatGraph(w).nodes.find(n => n.id === id);
}
export function deleteFlat(w: Workspace, id: string) {
  if (id === REGISTRY_NODE) return w;
  // An event QTE's own cards: the start event (the QTE stays, detached) or a result's event (the result sends none).
  const card = qteCardOf(id);
  if (card) {
    const n = structuredClone(w),
      q = qteMembers(n, card)[0];
    if (!q) return w;
    if (id.startsWith('qte-event:')) delete q.eventStart;
    else {
      const k = id.split(':')[2] as keyof typeof q.results;
      if (q.results[k]) q.results[k].mode = 'continue';
    }
    return n;
  }
  const idRef = parseNodeId(id);
  if (idRef.kind === 'qte') {
    const removed = new Set(qteMembers(w, id).map(q => q.id));
    return {...w, qtes: w.qtes?.filter(q => !removed.has(q.id))};
  }
  if (w.sharedRules)
    w = {
      ...w,
      sharedRules: w.sharedRules
        .map(g => ({...g, members: g.members.filter(m => ruleNode(g.kind, m, w) !== id)}))
        .filter(g => g.members.length > 1),
    };
  if (id === 'shared:outputPose') return {...w, sharedOutputPose: false};
  if (idRef.kind === 'table') {
    const owner = idRef.owner;
    return {...w, conditionTables: w.conditionTables?.filter(a => a !== owner)};
  }
  if (idRef.kind === 'branch') return deleteCondition(w, idRef.owner, idRef.test);
  if (w.drafts?.some(d => d.id === id)) return {...w, drafts: w.drafts.filter(d => d.id !== id)};
  const n = flatNode(w, id);
  if (!n) return w;
  if (n.kind === 'stateCondition' && n.action)
    w = {
      ...w,
      sharedRules: w.sharedRules
        ?.map(g => (g.kind === 'state' ? {...g, members: g.members.filter(m => m !== n.action)} : g))
        .filter(g => g.members.length > 1),
    };
  if (n.kind === 'state' && n.action) {
    const next = structuredClone(w),
      a = next.actions.find(a => a.uid === n.action)!;
    // Remove the obsolete container, retaining its independently editable nodes.
    next.blends = blendNodes(w).map(b => ({
      ...b,
      source: b.source === a.uid ? (a.config.steps.length ? animId(a.uid, 'clip_' + a.config.entry) : '') : b.source,
      target: b.target === a.uid ? (a.config.steps.length ? animId(a.uid, 'clip_' + a.config.entry) : '') : b.target,
    }));
    a.nodeAuthored = true;
    return next;
  }
  if (n.kind === 'hkxPlay' && n.action && n.step) return retirePlayback(w, n.action);
  if (n.kind === 'blend') {
    const next = {...w, blends: blendNodes(w).filter(b => b.id !== id)};
    try {
      return lowerBlends(next);
    } catch {
      return next;
    }
  }
  if (n.scope.kind === 'link' && ['keyInput', 'markerReceive', 'result'].includes(n.kind)) {
    const scope = n.scope;
    return {
      ...w,
      links: w.links.filter(l => l.id !== scope.link),
      blends: blendNodes(w).filter(b => !b.source.startsWith(`link:${scope.link}|`)),
    };
  }
  return n.notify && n.action ? remove(w, n.action, n.notify) : deleteGraphNode(w, n.scope, n.original);
}
/** One connection request after shared pins are resolved. Nodes are looked up once. */
type ConnectCase = {
  w: Workspace;
  source: string;
  target: string;
  port?: string;
  from: NodeRef;
  to: NodeRef;
  sourceNode?: FlatNode;
  targetNode?: FlatNode;
};
const NEXT = Symbol('next connection rule');
/** connectFlat rules in precedence order: the first rule that returns a workspace or throws
 *  decides; NEXT passes to the next rule. Rules after requireNodes may assume both nodes. */
const CONNECT_RULES: {name: string; run: (c: ConnectCase) => Workspace | typeof NEXT}[] = [
  {
    name: 'carryRelease',
    run: c => {
      const {w, from} = c;
      const carryNode = c.sourceNode;
      const lowerNode = c.targetNode;
      if (carryNode?.kind === 'carry' && carryNode.action && from.kind !== 'draft') {
        const a = w.actions.find(x => x.uid === carryNode.action),
          putdown = w.actions.find(x => x.uid === lowerNode?.action);
        if (!a?.pair?.carry || lowerNode?.kind !== 'hkxPlay' || !putdown || !putdownCandidate(putdown, a))
          throw Error(tr('시작 입력·조건 분기가 없는 한 사람 일반 동작(내려놓기 동작) HKX에 연결하세요.'));
        return setPutdown(w, a.uid, putdown.uid);
      }
      return NEXT;
    },
  },
  {
    name: 'restoreDisconnected',
    run: c => {
      const {w, source, target, port} = c;
      const restored = reconnectEdge(w, source, target, port);
      if (restored) return restored;
      return NEXT;
    },
  },
  {
    name: 'qte',
    run: c => {
      const {w, source, target, port, from, to} = c;
      if (from.kind === 'qte' || to.kind === 'qte') return connectQte(w, source, target, port, flatGraph(w).nodes)!;
      return NEXT;
    },
  },
  {
    name: 'outputPoseDraft',
    run: c => {
      const {w, source, target, port} = c;
      const outputDraft = w.drafts?.find(d => d.id === target && d.kind === 'outputPose');
      if (outputDraft) {
        const b = blendNodes(w).find(b => b.id === source),
          owner = b && flatNode(w, b.source)?.action;
        if (!b || !owner) throw Error(tr('출력 포즈는 HKX에 연결된 종료 블렌드 뒤에 연결하세요.'));
        const next = structuredClone(w),
          a = next.actions.find(a => a.uid === owner)!;
        a.config.graph = outputDraft.value.config.graph;
        next.drafts = next.drafts!.filter(d => d.id !== target);
        next.blends = blendNodes(next).map(b => ({
          ...b,
          target: b.target === target ? animId(owner, 'outputPose') : b.target,
        }));
        return connectFlat(next, source, animId(owner, 'outputPose'), port);
      }
      return NEXT;
    },
  },
  {
    name: 'collectionDraft',
    run: c => {
      const {w, source, target, port} = c;
      const carryNode = c.sourceNode;
      const lowerNode = c.targetNode;
      const collection = w.drafts?.find(d => (d.id === source || d.id === target) && d.kind === 'conditionTable');
      if (collection) {
        const other = collection.id === source ? lowerNode : carryNode,
          a = w.actions.find(a => a.uid === other?.action);
        if (!a || other?.kind !== 'hkxPlay') throw Error(tr('먼저 HKX에 연결하세요.'));
        const n = structuredClone(w),
          dest = n.actions.find(x => x.uid === a.uid)!;
        {
          if (dest.flow) throw Error(tr('이미 조건이 있는 동작입니다. 별도 HKX에 연결하세요.'));
          if (collection.id !== source) throw Error(tr('규칙의 통과/실패 출력에서 HKX에 연결하세요.'));
          const parts = port?.split(':');
          if (parts?.length !== 3) throw Error(tr('규칙 출력 핀을 선택하세요.'));
          dest.flow = structuredClone(collection.value.flow);
          const t = dest.flow?.tests.find(t => t.id === parts[1]);
          if (!t) throw Error(tr('규칙이 없습니다.'));
          t[parts[2] as 'pass' | 'fail'] = {action: dest.uid};
          delete dest.flow!.detached;
          n.conditionTables = [...new Set([...(n.conditionTables ?? []), dest.uid])];
        }
        n.drafts = n.drafts!.filter(d => d.id !== collection.id);
        return n;
      }
      return NEXT;
    },
  },
  {
    name: 'reuseConnection',
    run: c => {
      const reused = reuseConnection(c.w, c.sourceNode, c.targetNode);
      if (reused) return reused;
      return NEXT;
    },
  },
  {
    name: 'sharedOutputPose',
    run: c => {
      const {w, source, target, port} = c;
      if (target === 'shared:outputPose') {
        const b = blendNodes(w).find(b => b.id === source),
          owner = b && flatNode(w, b.source)?.action;
        if (!b || !owner) throw Error(tr('동작에 연결된 종료 블렌드를 공통 출력 포즈에 연결하세요.'));
        return connectFlat(w, source, animId(owner, 'outputPose'), port);
      }
      return NEXT;
    },
  },
  {
    name: 'intoConditionTable',
    run: c => {
      const {w, source, port, to} = c;
      if (to.kind === 'table') {
        const owner = to.owner,
          entry = w.actions.find(a => a.uid === owner)?.flow?.entry;
        if (!entry) throw Error(tr('묶음의 진입 조건이 없습니다.'));
        return connectFlat(w, source, branchId(owner, entry), port);
      }
      return NEXT;
    },
  },
  {
    name: 'fromConditionTable',
    run: c => {
      const {w, target, port, from} = c;
      if (from.kind === 'table') {
        const owner = from.owner,
          parts = port?.split(':');
        if (parts?.length !== 3 || parts[0] !== 'choice') throw Error(tr('규칙 출력 핀에서 연결하세요.'));
        return connectFlat(w, branchId(owner, parts[1]), target, parts[2]);
      }
      return NEXT;
    },
  },
  {
    name: 'fromBranch',
    run: c => {
      const {w, target, port, from, to} = c;
      if (from.kind === 'branch') {
        const owner = from.owner,
          key = from.test;
        if (port === 'condition') {
          const group =
            to.kind === 'branch'
              ? w.actions.find(a => a.uid === owner)?.flow?.tests.find(t => t.id === to.test)
              : undefined;
          if (to.kind !== 'branch' || owner !== to.owner || !group)
            throw Error(tr('같은 진입 경로의 조건 그룹에 연결하세요.'));
          return setConditionOperands(
            w,
            owner,
            to.test,
            group.kind === 'not' ? [key] : [...(group.operands ?? []), key]
          );
        }
        if (port !== 'pass' && port !== 'fail') throw Error(tr('통과 또는 실패 핀에서 연결하세요.'));
        if (to.kind === 'branch') {
          if (to.owner !== owner) throw Error(tr('같은 진입 경로의 조건끼리 연결하세요.'));
          // A pass already leading to a condition fans out onto the next one (graph/conditionFans.ts).
          return setBranchTarget(w, owner, key, port, {node: to.test}, 'add');
        }
        const n = flatNode(w, target);
        if (n?.kind !== 'hkxPlay' || !n.action) throw Error(tr('조건 또는 HKX 재생에 연결하세요.'));
        if (port === 'pass' && fanOf(w.actions.find(a => a.uid === owner)?.flow, key))
          throw Error(tr('갈래가 여럿인 통과에는 조건만 더할 수 있습니다. 갈래 선을 끊거나 ▾ 목록에서 바꾸세요.'));
        return setBranchTarget(w, owner, key, port, {action: n.action});
      }
      return NEXT;
    },
  },
  {
    name: 'intoBranch',
    run: c => {
      const {w, source, target, port, to} = c;
      if (to.kind === 'branch') {
        const draft = w.drafts?.find(d => d.id === source && ['keyInput', 'markerReceive'].includes(d.kind));
        if (draft) {
          // A start onto a loose condition of an action that already starts some other way: that condition
          // becomes its own action (one start per action), e.g. a second hotkey's flow.
          const split = splitCondition(w, to.owner, to.test),
            owner = split?.action ?? to.owner,
            r = attachDraft(split?.workspace ?? w, draft, owner);
          // Named after its start ("Num0 시작"), not "새 일반 동작" like the HKX cards made beside it.
          if (split) {
            const q = draft.value.config,
              made = r.workspace.actions.find(a => a.uid === owner)!;
            const name =
              q.start.mode === 'event'
                ? q.start.event
                : q.inputs.find(i => i.id === q.start.input)?.key || q.inputs[0]?.key;
            if (name) made.config.name = tr('{name} 시작', {name});
          }
          // The start card stays where the key was drawn (as onto an HKX, draftNode).
          return moveNodes(
            connectFlat(
              r.workspace,
              flatId({kind: 'start', action: owner}, draft.kind),
              split ? branchId(owner, to.test) : target,
              port
            ),
            root,
            {[flatId({kind: 'start', action: owner}, draft.kind)]: graphPosition(w, root, draft.id, {x: 500, y: 500})}
          );
        }
        const owner = to.owner,
          key = to.test,
          a = w.actions.find(a => a.uid === owner);
        if (!a?.flow?.tests.some(t => t.id === key)) throw Error(tr('연결할 조건이 없습니다.'));
        const blend = blendNodes(w).find(b => b.id === source);
        if (blend) {
          const next = structuredClone(w),
            f = next.actions.find(a => a.uid === owner)!.flow!;
          f.entry = key;
          delete f.detached;
          // The graph projects entry playback through its condition flow. Store the
          // same canonical endpoint as an input connected before that flow.
          const edited = editBlend(next, blend.id, {target: animId(owner, 'clip_' + a.config.entry)});
          if (blend.source)
            blendBinding(
              edited,
              blendNodes(edited).find(b => b.id === blend.id)!
            );
          return edited;
        }
        const n = flatNode(w, source);
        if (
          (source === 'entry' && a.config.start.mode !== 'none') ||
          (source !== 'entry' &&
            !(n?.action === owner && n.scope.kind === 'start' && ['keyInput', 'markerReceive'].includes(n.kind)))
        )
          throw Error(tr('해당 동작의 시작 입력 또는 진입 카드에서 연결하세요.'));
        const next = structuredClone(w),
          f = next.actions.find(a => a.uid === owner)!.flow!;
        f.entry = key;
        delete f.detached;
        return next;
      }
      return NEXT;
    },
  },
  {
    name: 'draftNode',
    run: c => {
      const {w, source, target, from, to} = c;
      const draft = w.drafts?.find(d => d.id === source || d.id === target);
      if (draft) {
        const other = flatNode(w, draft.id === source ? target : source);
        // A transition event: first attached after its source HKX (draft.from), then dragged to the destination.
        if (draft.kind === 'markerReceive' && other?.kind === 'hkxPlay' && other.action && other.step) {
          if (draft.from && draft.id === source) {
            const r = playbackLink(w, draft.owner, other.action, {event: draft.value.config.start.event});
            r.workspace.drafts = r.workspace.drafts?.filter(d => d.id !== draft.id);
            return moveNodes(r.workspace, root, {[r.id]: graphPosition(w, root, draft.id, {x: 500, y: 500})});
          }
          if (draft.id === target && !draft.from && !draft.to) {
            if (w.actions.find(a => a.uid === other.action)!.config.kind !== 'single')
              throw Error(tr('전환 이벤트는 일반·페어 HKX에서 시작합니다.'));
            const n = structuredClone(w),
              d = n.drafts!.find(d => d.id === draft.id)!;
            d.owner = other.action;
            d.from = other.step;
            return n;
          }
        }
        if (
          draft.kind === 'markerReceive' &&
          !draft.from &&
          draft.id === source &&
          other?.kind === 'hkxPlay' &&
          other.action &&
          other.step
        ) {
          const r = attachDraft(w, draft, other.action);
          r.workspace.actions.find(a => a.uid === other.action)!.config.entry = other.step;
          return moveNodes(r.workspace, root, {
            [`start:${other.action}|markerReceive`]: graphPosition(w, root, draft.id, {x: 500, y: 500}),
          });
        }
        if (draft.kind === 'keyInput' && other?.kind === 'hkxPlay' && other.action && other.step) {
          // A key drawn out of an HKX is a pending transition: its output on another HKX makes the Connect.
          if (draft.from && draft.id === source) {
            const input = draft.value.config.inputs.find(i => i.id === draft.value.config.start.input);
            if (!input) throw Error(tr('키를 지정하세요.'));
            const r = playbackLink(w, draft.owner, other.action, input);
            r.workspace.drafts = r.workspace.drafts?.filter(d => d.id !== draft.id);
            return moveNodes(r.workspace, root, {[r.id]: graphPosition(w, root, draft.id, {x: 500, y: 500})});
          }
          const owner = w.actions.find(a => a.uid === other.action)!;
          if (draft.id === source && !draft.from && !draft.to) {
            if (owner.config.start.mode !== 'none')
              throw Error(tr('이미 시작 입력이 있습니다. 기존 입력을 삭제한 뒤 연결하세요.'));
            const r = attachDraft(w, draft, other.action);
            r.workspace.actions.find(a => a.uid === other.action)!.config.entry = other.step;
            return moveNodes(r.workspace, root, {
              [`start:${other.action}|keyInput`]: graphPosition(w, root, draft.id, {x: 500, y: 500}),
            });
          }
          // An HKX's output into the key keeps the key as a pending transition from that HKX.
          if (draft.id === target && !draft.from && !draft.to) {
            const n = structuredClone(w),
              d = n.drafts!.find(d => d.id === draft.id)!;
            d.owner = other.action;
            d.from = other.step;
            return n;
          }
          throw Error(tr('전환 키의 출력을 도착할 다른 HKX에 연결하세요.'));
        }
        if (draft.kind === 'stateCondition' && other?.kind === 'hkxPlay' && other.action) {
          if (draft.id !== source) throw Error(tr('상태 조건의 출력에서 HKX 입력으로 연결하세요.'));
          const r = attachDraft(w, draft, other.action);
          return moveNodes(r.workspace, root, {
            [`start:${other.action}|stateCondition`]: graphPosition(w, root, draft.id, {x: 500, y: 500}),
          });
        }
        if (other?.kind === 'hkxPlay' && other.action && draft.notify) {
          const r = attachDraft(w, draft, other.action);
          return moveNodes(r.workspace, root, {
            [`notify:${other.action}|${r.local}`]: graphPosition(w, root, draft.id, {x: 500, y: 500}),
          });
        }
        if (
          !other ||
          (other.kind !== 'state' &&
            !(
              other.kind === 'hkxPlay' &&
              ['cameraRestore', 'carry', 'moveDirection', 'suppress', 'fireArrow', 'carryRelease', 'carryFix'].includes(
                draft.kind
              )
            )) ||
          !other.action
        )
          throw Error(tr('기능 카드를 적용할 HKX 또는 동작에 연결하세요.'));
        const r = attachDraft(w, draft, other.action);
        const scope = draftScope({...draft, value: {...draft.value, uid: other.action}});
        const id = draft.notify ? `notify:${other.action}|${r.local}` : flatId(scope, r.local);
        return moveNodes(r.workspace, root, {[id]: graphPosition(w, root, draft.id, {x: 500, y: 500})});
      }
      return NEXT;
    },
  },
  {
    name: 'blendIntoOutputPose',
    run: c => {
      const {w, source, target} = c;
      // A terminal is materialized only when a blend explicitly targets it.
      if (blendNodes(w).some(b => b.id === source) && w.actions.some(a => target === animId(a.uid, 'outputPose'))) {
        const shared = w.sharedRules?.find(g => g.kind === 'node' && g.members.includes(source));
        if (shared) {
          const next = structuredClone(w);
          next.blends = structuredClone(blendNodes(w));
          next.sharedOutputPose = true;
          for (const id of shared.members) {
            const b = next.blends.find(b => b.id === id);
            if (!b) continue;
            // Completing an exit must not rewrite other shared entry/transition paths.
            if (b.source && b.target && blendBinding(next, b).kind !== 'exit') continue;
            const owner = flatNode(w, b.source)?.action;
            if (!owner) continue;
            b.target = animId(owner, 'outputPose');
            blendBinding(next, b);
          }
          return next;
        }
        const next = editBlend(w, source, {target});
        const b = blendNodes(next).find(b => b.id === source)!;
        if (b.source) blendBinding(next, b);
        return next;
      }
      return NEXT;
    },
  },
  {
    name: 'requireNodes',
    run: c => {
      if (!c.sourceNode || !c.targetNode) throw Error(tr('연결할 카드를 찾지 못했습니다.'));
      return NEXT;
    },
  },
  {
    name: 'linkInputToAction',
    run: c => {
      const {w, target} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (
        s.scope.kind === 'link' &&
        ['keyInput', 'markerReceive'].includes(s.kind) &&
        d.action &&
        ['state', 'hkxPlay'].includes(d.kind)
      ) {
        const scope = s.scope,
          next = structuredClone(w),
          link = next.links.find(l => l.id === scope.link)!;
        if (link.from === d.action) throw Error(tr('같은 동작으로의 연결은 아직 지원하지 않습니다.'));
        const dest = next.actions.find(a => a.uid === d.action)!;
        if (d.step && d.step !== dest.config.entry) throw Error(tr('대상 동작의 진입 HKX에 연결하세요.'));
        if (c.port === 'partner') {
          // The partner's action of a pair's transition (runtime Connect partnerTo).
          if (!next.actions.find(a => a.uid === link.from)?.pair)
            throw Error(tr('상대(피해자) 동작은 페어에서 나가는 전환에만 지정합니다.'));
          if (dest.pair || next.actions.find(a => a.uid === link.to)?.pair)
            throw Error(tr('페어에서 양쪽 일반 동작으로 가는 전환만 상대(피해자) 동작을 가질 수 있습니다.'));
          if (dest.uid === link.to) throw Error(tr('시작자(가해자)와 상대(피해자)는 다른 동작으로 연결하세요.'));
          link.partnerTo = dest.uid;
          return next;
        }
        link.to = dest.uid;
        if (dest.pair) link.partnerTo = '';
        if (next.blends) for (const b of next.blends) if (b.source.startsWith(`link:${link.id}|`)) b.target = target;
        return next;
      }
      return NEXT;
    },
  },
  {
    name: 'playToStartKey',
    run: c => {
      const {w} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (s.kind === 'hkxPlay' && s.action && s.step && d.kind === 'keyInput' && d.scope.kind === 'start') {
        const old = w.actions.find(a => a.uid === d.action)!,
          input = old.config.inputs.find(i => i.id === old.config.start.input);
        if (!input) throw Error(tr('연결할 키를 설정하세요.'));
        // The destination's start key becomes the transition's key.
        const ready = structuredClone(w);
        ready.actions.find(a => a.uid === old.uid)!.config.start.mode = 'none';
        const r = playbackLink(ready, s.action, old.uid, input);
        return moveNodes(r.workspace, root, {[r.id]: graphPosition(w, root, d.id, {x: 500, y: 500})});
      }
      return NEXT;
    },
  },
  {
    name: 'blendEndpoint',
    run: c => {
      const {w, source, target} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (s.kind === 'blend' || d.kind === 'blend') {
        if (s.kind === 'blend' && d.kind === 'blend') throw Error(tr('블렌드끼리는 연결할 수 없습니다.'));
        const id = s.kind === 'blend' ? s.id : d.id;
        let next = editBlend(w, id, s.kind === 'blend' ? {target} : {source});
        const b = blendNodes(next).find(b => b.id === id)!;
        if (b.source && b.target) {
          const inputDraft = next.drafts?.find(
            d => d.id === b.source && ['keyInput', 'markerReceive'].includes(d.kind)
          );
          if (inputDraft && flatNode(next, b.target)?.kind === 'hkxPlay') {
            next = connectFlat(next, inputDraft.id, b.target);
            blendBinding(
              next,
              blendNodes(next).find(b => b.id === id)!
            );
            return next;
          }
          const left = flatNode(next, b.source),
            right = flatNode(next, b.target);
          if (
            left?.kind === 'state' &&
            right?.kind === 'state' &&
            !next.links.some(l => l.from === b.source && l.to === b.target)
          )
            next = connectGraph(next, root, b.source, b.target);
          blendBinding(next, b);
        }
        const shared = next.sharedRules?.find(g => g.kind === 'node' && g.members.includes(id));
        if (shared && b.source === 'entry' && b.target)
          for (const member of shared.members) {
            const other = next.blends?.find(b => b.id === member);
            if (other && !other.source && other.target) {
              other.source = 'entry';
              blendBinding(next, other);
            }
          }
        return next;
      }
      return NEXT;
    },
  },
  {
    name: 'entryToState',
    run: c => {
      const {w, source, target} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (s.kind === 'entry' && d.kind === 'state') return connectGraph(w, root, source, target);
      return NEXT;
    },
  },
  {
    name: 'startNodeToAction',
    run: c => {
      const {w} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (
        ['keyInput', 'markerReceive', 'stateCondition'].includes(s.kind) &&
        (d.kind === 'state' || (d.kind === 'hkxPlay' && s.kind === 'stateCondition')) &&
        s.action
      ) {
        const next = structuredClone(w),
          from = next.actions.find(a => a.uid === s.action)!,
          to = next.actions.find(a => a.uid === d.action)!;
        if (s.kind === 'keyInput' || s.kind === 'markerReceive') {
          const input = from.config.inputs.find(i => i.id === from.config.start.input);
          const existing = input && to.config.inputs.find(i => i.id === input.id);
          if (existing && JSON.stringify(existing) !== JSON.stringify(input))
            throw Error(tr('대상 동작에 같은 이름의 다른 입력이 있습니다.'));
          if (input && !existing) to.config.inputs.push(structuredClone(input));
          to.config.start = structuredClone(from.config.start);
        } else {
          const {air, cooldown} = from.config;
          Object.assign(to.config, {air, cooldown});
          const shared = next.sharedRules?.find(g => g.kind === 'state' && g.members.includes(from.uid));
          if (shared && !shared.members.includes(to.uid)) shared.members.push(to.uid);
        }
        return next;
      }
      return NEXT;
    },
  },
  {
    name: 'stateToState',
    run: c => {
      const {w, source, target} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (s.kind === 'state' && d.kind === 'state') return connectGraph(w, root, source, target);
      return NEXT;
    },
  },
  {
    name: 'playToPlay',
    run: c => {
      const {w} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      // HKX to HKX is a transition (a Connect; combos went with XML format 4): a key transition whose key the
      // details set.
      if (s.kind === 'hkxPlay' && d.kind === 'hkxPlay' && s.action && d.action)
        return playbackLink(w, s.action, d.action, {id: 'input', label: t('row.transitionKey'), key: '', gamepad: 0})
          .workspace;
      return NEXT;
    },
  },
  {
    name: 'sameScope',
    run: c => {
      const {w} = c;
      const s = c.sourceNode!;
      const d = c.targetNode!;
      if (graphId(s.scope) === graphId(d.scope)) return connectGraph(w, s.scope, s.original, d.original);
      return NEXT;
    },
  },
];
export function connectFlat(w: Workspace, source: string, target: string, port?: string): Workspace {
  // A visible shared pin resolves to the binding belonging to this playback path.
  const sourceOwner = flatNode(w, source)?.action,
    targetOwner = flatNode(w, target)?.action;
  for (const group of w.sharedRules ?? [])
    if (group.kind === 'node') {
      if (group.members.includes(target) && sourceOwner) {
        const local = group.members.find(
          id => parseNodeId(id).kind === 'branch' && flatNode(w, id)?.action === sourceOwner
        );
        if (local) target = local;
      }
      if (group.members.includes(source) && targetOwner) {
        const local = group.members.find(
          id => parseNodeId(id).kind === 'branch' && flatNode(w, id)?.action === targetOwner
        );
        if (local) source = local;
      }
    }
  const c: ConnectCase = {
    w,
    source,
    target,
    port,
    from: parseNodeId(source),
    to: parseNodeId(target),
    sourceNode: flatNode(w, source),
    targetNode: flatNode(w, target),
  };
  for (const rule of CONNECT_RULES) {
    const connected = rule.run(c);
    if (connected !== NEXT) return connected;
  }
  throw Error(tr('이 핀 조합은 연결할 수 없습니다. 전환은 HKX 출력에서 다른 HKX 입력으로 연결하세요.'));
}
export function addDetachedCondition(w: Workspace, action: string, position: {x: number; y: number}) {
  const r = addFlat(w, action, 'conditionBranch', position);
  const flow = r.workspace.actions.find(a => a.uid === action)!.flow!;
  delete flow.tests.find(t => t.id === branchTest(r.id))!.pass;
  if (!w.actions.find(a => a.uid === action)?.flow) {
    flow.entry = '';
    flow.detached = true;
  }
  return r;
}
export function makePlaybackAction(w: Workspace, kind: 'single' | 'pair' = 'single') {
  const a = addAction(w, kind);
  a.nodeAuthored = true;
  a.enterBlendEnabled = false;
  a.exitBlendEnabled = false;
  a.config.steps[0].clip = '';
  a.config.steps[0].label = tr('새 HKX');
  // No start yet, so no start key: a start key added later brings its own input (no unused Num0 left behind).
  a.config.start = {...a.config.start, mode: 'none', input: ''};
  a.config.inputs = [];
  return a;
}
/** A condition not reached from its action's entry, of an action that already has a start, moved with the
 *  conditions after it into a new action of its own (no HKX of its own: it only selects). Undefined when the
 *  action has no start yet or the condition is on its entry's flow (a second start there stays refused). */
export function splitCondition(w: Workspace, owner: string, test: string) {
  const a = w.actions.find(a => a.uid === owner),
    f = a?.flow;
  if (!a || !f || a.config.start.mode === 'none') return;
  const reach = (from: string[]) => {
    const seen = new Set<string>(),
      pending = [...from];
    while (pending.length) {
      const id = pending.pop()!,
        t = f.tests.find(t => t.id === id);
      if (!t || seen.has(id)) continue;
      seen.add(id);
      for (const e of [t.pass, t.fail]) if (e && 'node' in e) pending.push(e.node);
      pending.push(...(t.operands ?? []));
    }
    return seen;
  };
  const kept = reach(f.entry ? [f.entry] : []);
  if (kept.has(test)) return;
  const moved = reach([test]);
  if ([...moved].some(id => kept.has(id)))
    throw Error(tr('이 조건은 시작 흐름의 조건으로 이어져 있어 새 동작으로 나눌 수 없습니다.'));
  const rest = f.tests.filter(t => !moved.has(t.id));
  if (
    rest.some(
      t => [t.pass, t.fail].some(e => e && 'node' in e && moved.has(e.node)) || t.operands?.some(o => moved.has(o))
    )
  )
    throw Error(tr('다른 조건이 이 조건으로 이어져 있습니다. 그 연결을 먼저 끊으세요.'));
  const places = new Map(flatGraph(w).nodes.map(n => [n.id, n.position]));
  const next = structuredClone(w),
    from = next.actions.find(x => x.uid === owner)!,
    made = makePlaybackAction(next, a.pair ? 'pair' : 'single');
  const fans = f.fans?.filter(x => moved.has(x.parent));
  made.flow = {
    entry: test,
    selects: true,
    tests: structuredClone(f.tests.filter(t => moved.has(t.id))),
    ...(fans?.length ? {fans: structuredClone(fans)} : {}),
  };
  from.flow!.tests = from.flow!.tests.filter(t => !moved.has(t.id));
  if (from.flow!.fans) {
    from.flow!.fans = from.flow!.fans.filter(x => !moved.has(x.parent));
    if (!from.flow!.fans.length) delete from.flow!.fans;
  }
  next.actions.push(made);
  const positions = Object.fromEntries(
    [...moved].flatMap(id => {
      const p = places.get(branchId(owner, id));
      return p ? [[branchId(made.uid, id), p]] : [];
    })
  );
  return {workspace: moveNodes(next, root, positions), action: made.uid};
}
export function addFlat(w: Workspace, action: string, kind: string, position: {x: number; y: number}) {
  if (kind === 'qte') return addQte(w, position);
  if (kind === 'conditionBranch') {
    const next = structuredClone(w),
      a = next.actions.find(a => a.uid === action);
    if (!a) throw Error(tr('일반·페어 HKX를 선택한 뒤 조건 분기를 추가하세요.'));
    const first = !a.flow;
    a.flow ??= {entry: 'Condition1', tests: []};
    let num = 1;
    while (a.flow.tests.some(t => t.id === 'Condition' + num)) num++;
    const key = 'Condition' + num;
    a.flow.tests.push({id: key, kind: 'air', subject: 'self', minimum: 0, ...(first ? {pass: {action: a.uid}} : {})});
    const id = branchId(a.uid, key);
    return {workspace: moveNodes(next, root, {[id]: position}), id};
  }
  if (kind === 'playNode' || kind === 'state') {
    const a = makePlaybackAction(w);
    const id = animId(a.uid, 'clip_' + a.config.steps[0].id);
    return {workspace: moveNodes({...w, actions: [...w.actions, a]}, root, {[id]: position}), id};
  }
  if (kind === 'blend') {
    const blends = blendNodes(w);
    let i = 1;
    while (blends.some(b => b.id === `blend:new${i}`)) i++;
    const id = `blend:new${i}`;
    return {
      workspace: moveNodes({...w, blends: [...blends, {id, source: '', target: '', seconds: 0.2}]}, root, {
        [id]: position,
      }),
      id,
    };
  }
  const draft = makeDraft(w, action, kind, position);
  return {workspace: moveNodes(draft.workspace, root, {[draft.id]: position}), id: draft.id};
}
export const notifyKinds = [
  'vanillaCancel',
  'rotate',
  'iframe',
  'armor',
  'cost',
  'recovery',
  'hide',
  'show',
  'spell',
  'shake',
  'cancel',
  'timeOn',
  'timeOff',
  'stopVelocity',
  'stateOn',
  'stateOff',
  'ragdoll',
];
