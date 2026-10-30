import {defaultCarry, defaultCarryFix} from '../carry.ts';
import type {Workspace, Action} from '../workspace.ts';
import {addAction, removeAction, defaultCamera, duplicateAction} from '../workspace.ts';
import {cameraReset} from '../sharedSettings.ts';
import {clone, timingLabel, mark} from '../model.ts';
import type {NodeKind} from '../nodes/catalog.ts';
import {t} from '../i18n/index.ts';
import type {GraphRef} from './state.ts';
import {graphId} from './state.ts';
import {tr} from '../i18n/korean.ts';
export type Pin =
  | `choice:${string}`
  | `row:${string}`
  | 'true'
  | 'false'
  | 'perfect'
  | 'pass'
  | 'fail'
  | 'trigger'
  | 'released'
  | 'condition'
  | 'pose'
  | 'partner';
/** One end-to-end connection a drawn line stands for (a line through hidden items keeps the ones it joins). */
export type Connection = {source: string; target: string; pin: string; targetPin?: string};
export type GraphNode = {
  id: string;
  kind: NodeKind | 'comment';
  title: string;
  summary: string;
  position: {x: number; y: number};
  inputs: Pin[];
  outputs: Pin[];
  open?: GraphRef;
  step?: string;
  error?: boolean;
};
export type GraphEdge = {
  origins?: Connection[];
  id: string;
  source: string;
  target: string;
  pin: Pin;
  targetPin?: Pin;
  /** A QTE result that sends this event, drawn to the cards that receive it (view only, qteGraph.ts). */
  via?: string;
  /** The actions whose own QTE sends `via` to themselves on this line. */
  viaFrom?: string[];
  /** A fanned branch's place (0 = ①, graph/conditionFans.ts): the lines out of one pass in their order. */
  rank?: number;
};
// Drawing asks for each graph's action many times (hundreds of scans of every action per edit): an index per
// actions array, checked against the array on each lookup, since edit code may still change the array.
const actionIndexes = new WeakMap<Action[], Map<string, number>>();
function actionByUid(actions: Action[], uid: string | undefined): Action | undefined {
  if (uid === undefined) return undefined;
  const at = actionIndexes.get(actions)?.get(uid);
  if (at !== undefined && actions[at]?.uid === uid) return actions[at];
  // Not indexed yet, or the array changed: the first action of each uid, as find() gives.
  const index = new Map<string, number>();
  actions.forEach((a, i) => {
    if (!index.has(a.uid)) index.set(a.uid, i);
  });
  actionIndexes.set(actions, index);
  const i = index.get(uid);
  return i === undefined ? undefined : actions[i];
}
export function graphAction(w: Workspace, g: GraphRef): Action | undefined {
  return 'action' in g
    ? actionByUid(w.actions, g.action)
    : g.kind === 'link'
      ? actionByUid(w.actions, w.links.find(l => l.id === g.link)?.from)
      : undefined;
}
export function graphExists(w: Workspace, g: GraphRef) {
  const a = graphAction(w, g);
  return g.kind === 'root' || g.kind === 'link'
    ? g.kind === 'root' || w.links.some(l => l.id === g.link)
    : !!a && (g.kind !== 'anim' || !g.step || a.config.steps.some(s => s.id === g.step));
}
export function graphTitle(w: Workspace, g: GraphRef): string {
  const a = graphAction(w, g);
  if (g.kind === 'root') return t('myProject.rootGraph');
  if (g.kind === 'link') {
    const l = w.links.find(l => l.id === g.link);
    return `${a?.config.name ?? '?'} → ${w.actions.find(a => a.uid === l?.to)?.config.name ?? '?'}`;
  }
  return `${a?.config.name ?? '?'}${g.kind === 'start' ? ' · ' + t('graph.entryRule') : g.kind === 'anim' ? ' · ' + (g.step ?? t('graph.anim')) : ''}`;
}
// Two stable hashes keep layout identifiers inside schema 7's 64-character identifier limit.
// Every drawn node asks for its key on each edit: the keys are remembered (bounded, the ids are few).
const layoutKeys = new Map<string, string>();
export function layoutKey(s: string) {
  const known = layoutKeys.get(s);
  if (known !== undefined) return known;
  let a = 2166136261,
    b = 5381;
  for (const c of s) {
    a = Math.imul(a ^ c.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ c.charCodeAt(0);
  }
  const key = 'g' + (a >>> 0).toString(16) + '_' + (b >>> 0).toString(16);
  if (layoutKeys.size >= 50000) layoutKeys.clear();
  layoutKeys.set(s, key);
  return key;
}
const positionKey = (id: string) => (id.startsWith('@note_') ? id.slice(1) : layoutKey(id));
export function graphPosition(w: Workspace, g: GraphRef, n: string, fallback: {x: number; y: number}) {
  const p = w.layout[layoutKey(graphId(g))]?.[positionKey(n)];
  return p ? {x: p.x, y: p.y} : fallback;
}
export function moveNodes(w: Workspace, g: GraphRef, positions: Record<string, {x: number; y: number}>) {
  const next = clone(w),
    key = layoutKey(graphId(g));
  next.layout[key] ??= {};
  for (const [id, p] of Object.entries(positions)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    next.layout[key][positionKey(id)] = {...next.layout[key][positionKey(id)], ...p};
    if (g.kind === 'root') {
      const item = next.actions.find(a => a.uid === id) ?? next.links.find(l => l.id === id);
      if (item) item.position = p;
    }
  }
  return next;
}
export function projectGraph(w: Workspace, g: GraphRef): {nodes: GraphNode[]; edges: GraphEdge[]} {
  const nodes: GraphNode[] = [],
    edges: GraphEdge[] = [];
  const add = (id: string, kind: NodeKind, summary = '', x = 0, y = 0, extra: Partial<GraphNode> = {}) => {
    nodes.push({
      id,
      kind,
      title: t('node.' + kind),
      summary,
      inputs: [],
      outputs: [],
      ...extra,
      position: graphPosition(w, g, id, {x, y}),
    });
    return id;
  };
  const edge = (source: string, target: string, pin: Pin = 'trigger') =>
    edges.push({id: source + '_' + target + '_' + pin, source, target, pin});
  for (const [key, note] of Object.entries(w.layout[layoutKey(graphId(g))] ?? {}))
    if (note.text !== undefined)
      nodes.push({
        id: '@' + key,
        kind: 'comment',
        title: t('graph.comment'),
        summary: note.text,
        position: {x: note.x, y: note.y},
        inputs: [],
        outputs: [],
      });
  if (g.kind === 'root') return {nodes, edges};
  const a = graphAction(w, g);
  if (!a) return {nodes, edges};
  const p = a.config;
  if (g.kind === 'start' || g.kind === 'link') return {nodes, edges};
  const steps = g.step ? p.steps.filter(s => s.id === g.step) : p.steps;
  for (const [i, s] of steps.entries())
    add('clip_' + s.id, 'hkxPlay', s.clip.split(/[\\/]/).at(-1) || t('graph.missingClip'), 0, i * 180, {
      step: s.id,
      outputs: ['pose'],
      error: !s.clip,
    });
  let head = steps[0] ? 'clip_' + steps[0].id : '';
  let x = 270;
  const pass = (id: NodeKind, summary = '') => {
    add(id, id, summary, x, 0, {
      inputs: id === 'pairedPlay' ? ['pose', 'partner'] : ['pose'],
      outputs: id === 'outputPose' ? [] : ['pose'],
    });
    if (head) edge(head, id, 'pose');
    head = id;
    x += 260;
  };
  if (a.pair) {
    add('findPartner', 'findPartner', `${a.pair.range} · ${a.pair.angle}°`, x, 210, {outputs: ['partner']});
    pass('pairedPlay');
    edge('findPartner', 'pairedPlay', 'partner');
  }
  if (a.enterBlendEnabled) pass('blendIn', String(p.enterBlend) + tr('초'));
  if (a.exitBlendEnabled) pass('blendOut', String(p.exitBlend) + tr('초'));
  if (a.cameraEnabled && a.camera) pass('cameraRestore', cameraReset(w, a.camera));
  if (a.pair?.carry) {
    add('carry', 'carry', a.pair.carry.bone, x, 240, {inputs: ['trigger'], outputs: ['trigger']});
    const clipId = 'clip_' + p.entry;
    const clipNode = nodes.find(n => n.id === clipId);
    if (clipNode && !clipNode.outputs.includes('trigger')) clipNode.outputs.push('trigger');
    if (clipNode) edge(clipId, 'carry', 'trigger');
    // The fix moment is an event item of every lift pair's card: the lift's end unless a moment is given.
    const fix = a.pair.carry.fix;
    add('carryFix', 'carryFix', fix ? timingLabel(fix.at) : t('carryFix.liftEnd'), x, 1040, {
      inputs: ['trigger'],
      outputs: [],
    });
    if (clipNode) edge(clipId, 'carryFix', 'trigger');
  }
  if (p.carryRelease) {
    add('carryRelease', 'carryRelease', timingLabel(p.carryRelease.at), x, 880, {inputs: ['trigger'], outputs: []});
    const clip = nodes.find(n => n.id === 'clip_' + p.entry);
    if (clip) {
      if (!clip.outputs.includes('trigger')) clip.outputs.push('trigger');
      edge(clip.id, 'carryRelease', 'trigger');
    }
  }
  for (const kind of ['suppress'] as const)
    if (p[kind]) {
      const events = p.suppress!.events;
      add(kind, kind, events.join(', '), x, 560, {inputs: ['trigger'], outputs: []});
      const clip = nodes.find(n => n.id === 'clip_' + p.entry);
      if (clip) {
        if (!clip.outputs.includes('trigger')) clip.outputs.push('trigger');
        edge(clip.id, kind, 'trigger');
      }
    }
  pass('outputPose');
  return {nodes, edges};
}
export function mutateGraph(w: Workspace, g: GraphRef, kind: NodeKind, remove = false): Workspace {
  const n = clone(w),
    a = graphAction(n, g);
  if (!a) throw Error(t('graph.selectState'));
  const p = a.config;
  if (g.kind === 'anim') {
    if (kind === 'carryRelease') {
      if (remove) delete p.carryRelease;
      else {
        if (a.pair) throw Error(tr('대상 놓기는 운반의 내려놓기 동작(한 사람 일반 동작)에 연결하세요.'));
        p.carryRelease ??= {at: mark(1)};
      }
      return n;
    }
    if (kind === 'suppress') {
      if (remove) delete p.suppress;
      else p.suppress ??= {events: [''], when: 'active'};
      return n;
    }
    if (kind === 'carry' && a.pair) {
      if (remove) delete a.pair.carry;
      else if (!a.pair.carry) {
        a.pair.carry = defaultCarry(a);
        // The putdown key: the pair's start key to begin with (its start card's), changed in the carry's details.
        const start = n.starts.find(s => s.mode === 'input' && s.to && 'action' in s.to && s.to.action === a.uid);
        if (!a.pair.carry.input && start) {
          a.config.inputs.push({
            id: 'PutDown',
            label: tr('내려놓기'),
            key: start.key,
            gamepad: start.gamepad,
            ...(start.control ? {control: start.control} : {}),
          });
          a.pair.carry.input = 'PutDown';
        }
      }
      return n;
    }
    if (kind === 'carryFix') {
      if (remove) {
        if (a.pair?.carry) a.pair.carry.fix = null;
      } else {
        if (!a.pair) throw Error(tr('대상 고정은 운반이 있는 들기 페어에 연결하세요.'));
        // A draft pair carries the moment in its own carry until it is attached (attachDraft).
        a.pair.carry ??= defaultCarry(a);
        a.pair.carry.fix ??= defaultCarryFix();
      }
      return n;
    }
    if (kind === 'blendIn') a.enterBlendEnabled = !remove;
    else if (kind === 'blendOut') a.exitBlendEnabled = !remove;
    else if (kind === 'cameraRestore') {
      a.cameraEnabled = !remove;
      if (!remove) {
        a.camera ??= {...defaultCamera(), reset: w.globals.cameraReset ?? ''};
      }
    } else if (kind === 'hkxPlay') {
      for (const s of p.steps.filter(s => !g.step || s.id === g.step)) {
        s.clip = remove ? '' : 'Animations\\MyMod\\Action.hkx';
        s.localPath = '';
      }
    } else throw Error(t('graph.requiredNode'));
  } else if (g.kind === 'start') {
    if (kind === 'stateCondition') {
      // The air rule: removed, ground only (the default); added, the ground and the air.
      p.air = remove ? 'deny' : 'allow';
    } else throw Error(t('graph.unsupported'));
  } else throw Error(t('graph.requiredNode'));
  return n;
}
export function deleteGraphNode(w: Workspace, g: GraphRef, id: string): Workspace {
  if (id.startsWith('@note_')) {
    const n = clone(w);
    delete n.layout[layoutKey(graphId(g))]?.[id.slice(1)];
    return n;
  }
  if (g.kind === 'root') {
    if (w.actions.some(a => a.uid === id)) return removeAction(w, id);
    if (w.links.some(l => l.id === id)) return {...w, links: w.links.filter(l => l.id !== id)};
    throw Error(t('graph.requiredNode'));
  }
  const a = graphAction(w, g);
  if (!a) throw Error(t('graph.selectState'));
  const node = projectGraph(w, g).nodes.find(n => n.id === id);
  if (!node) throw Error(t('graph.requiredNode'));
  if (node.kind === 'comment') throw Error(t('graph.requiredNode'));
  return mutateGraph(w, g.kind === 'anim' && node.step ? {...g, step: node.step} : g, node.kind, true);
}
export function addGraphItem(w: Workspace, g: GraphRef, kind: NodeKind, position?: {x: number; y: number}) {
  let n = clone(w);
  let id: string;
  if (g.kind === 'root') {
    const a = addAction(n);
    a.config.steps[0].clip = '';
    a.config.actionId = '';
    if (position) a.position = position;
    n.actions.push(a);
    id = a.uid;
  } else {
    n = mutateGraph(n, g, kind);
    id = kind;
  }
  if (position) n = moveNodes(n, g, {[id]: position});
  return {workspace: n, id};
}
export function duplicateGraphNode(w: Workspace, g: GraphRef, id: string): Workspace {
  const n = clone(w);
  if (g.kind === 'root') {
    const source = w.actions.find(a => a.uid === id);
    if (!source) throw Error(t('graph.requiredNode'));
    // The same copy as the project tree's Duplicate (workspace duplicateAction).
    n.actions.push(duplicateAction(n, source, source.config.name + ' ' + t('graph.copy')));
    return n;
  }
  throw Error(t('graph.singleton'));
}
export function addComment(w: Workspace, g: GraphRef, position: {x: number; y: number} = {x: 0, y: 0}) {
  const n = clone(w),
    key = layoutKey(graphId(g));
  n.layout[key] ??= {};
  let i = 1;
  while (n.layout[key]['note_' + i]) i++;
  n.layout[key]['note_' + i] = {...position, text: t('graph.comment')};
  return {workspace: n, id: '@note_' + i};
}
export function editComment(w: Workspace, g: GraphRef, id: string, text: string) {
  const n = clone(w),
    entry = n.layout[layoutKey(graphId(g))]?.[id.slice(1)];
  if (!entry || entry.text === undefined) throw Error(t('graph.requiredNode'));
  entry.text = text;
  return n;
}
