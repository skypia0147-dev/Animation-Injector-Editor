import {disconnectQte, qteMembers, removeQteRule} from './qteGroups.ts';
import {compactGraph} from './sharing.ts';
import {tableProjection} from './conditionTables.ts';
import type {Workspace} from '../workspace.ts';
import type {GraphEdge} from './projection.ts';
import {flatGraph} from './flat.ts';
import {blendNodes, blendBinding} from './blends.ts';
import {remove} from '../timeline/model.ts';
import {inScope, parseNodeId} from './nodeRef.ts';
import {setBranchTarget} from './conditionCommands.ts';
import {fanOf, removeFanBranch} from './conditionFans.ts';
import {tr} from '../i18n/korean.ts';
export type Connection = {source: string; target: string; pin: string; targetPin?: string};
export type Disconnection = {source: string; target: string; pin: string; bindings: Connection[]; setting?: boolean};
const key = (e: Connection) => [e.source, e.target, e.pin, e.targetPin ?? e.pin].join('→');
export function disconnectEdge(w: Workspace, e: GraphEdge): Workspace {
  const binding = e.origins ?? [{source: e.source, target: e.target, pin: e.pin, targetPin: e.targetPin}];
  // A condition's route is emptied in the document: kept as a hidden line it still counted as used (its
  // "→ … 추가" stayed hidden and a drag from it was refused).
  if (binding.every(b => parseNodeId(b.source).kind === 'branch' && (b.pin === 'pass' || b.pin === 'fail')))
    return binding.reduce((next, b) => {
      const ref = parseNodeId(b.source),
        to = parseNodeId(b.target);
      if (ref.kind !== 'branch') return next;
      // One fanned line: only that branch leaves the fan.
      if (
        b.pin === 'pass' &&
        to.kind === 'branch' &&
        fanOf(next.actions.find(a => a.uid === ref.owner)?.flow, ref.test)
      )
        return removeFanBranch(next, ref.owner, ref.test, to.test);
      return setBranchTarget(next, ref.owner, ref.test, b.pin as 'pass' | 'fail');
    }, w);
  // A QTE's line is edited in the document too: kept as a hidden line, a group's detail still listed every action
  // whose line was gone (10-15, Grapple Carry QTE: one line left, eleven actions listed).
  if (binding.every(isQteLine)) {
    const nodes = new Map(flatGraph(w).nodes.map(n => [n.id, n]));
    return binding.reduce((next, b) => cutQte(next, b, nodes.get(b.source)?.action), w);
  }
  // A start's line into a condition is cut in the document (docs/mockup-free-conditions ⑥): the start goes
  // nowhere and the conditions it reached are loose, not a hidden cut that kept them its own.
  const starts = binding.flatMap(b => {
    // The start card, or its enter blend card on the way (anim:<uid>:|blendIn).
    const m = /^start:([^|]+)\|(?:keyInput|markerReceive)$/.exec(b.source) ?? /^anim:([^:]+):\|blendIn$/.exec(b.source);
    // Into a condition card, or into its action (drawn at the action's first condition or the one it follows).
    const f = m && w.actions.find(a => a.uid === m[1])?.flow,
      judged = !!f && (!!f.follow || f.tests.some(t => t.id === f.entry));
    return m && (parseNodeId(b.target).kind === 'branch' || (b.target === m[1] && judged)) ? [m[1]] : [];
  });
  if (starts.length === binding.length) {
    const n = structuredClone(w);
    for (const uid of starts) {
      const f = n.actions.find(a => a.uid === uid)?.flow;
      if (!f) continue;
      delete f.follow;
      delete f.detached;
      f.entry = '';
      f.unlinked = true;
    }
    return n;
  }
  const n = structuredClone(w);
  n.disconnections ??= [];
  if (!n.disconnections.some(c => c.source === e.source && c.target === e.target && c.pin === e.pin))
    n.disconnections.push({
      source: e.source,
      target: e.target,
      pin: e.pin,
      bindings: binding.map(b => ({
        source: b.source,
        target: b.target,
        pin: b.pin,
        ...(b.targetPin ? {targetPin: b.targetPin} : {}),
      })),
    });
  return n;
}
// An event's start line stays a hidden cut: the event card is drawn from the QTE's start event, so emptying it in
// the document would take the card away with the line and leave nothing to reconnect.
const isQteLine = (b: Connection) =>
  !b.source.startsWith('qte-event:') && (parseNodeId(b.source).kind === 'qte' || parseNodeId(b.target).kind === 'qte');
// One QTE line cut in the document. An HKX's line into a group takes that action's rules out of the group while
// other actions keep it; the last action's rules stay, detached (owner ''), as a single QTE's do.
function cutQte(w: Workspace, b: Connection, action: string | undefined): Workspace {
  if (action && parseNodeId(b.target).kind === 'qte') {
    let n = w;
    for (;;) {
      const members = qteMembers(n, b.target),
        own = members.find(q => q.owner === action);
      if (!own || !members.some(q => q.owner && q.owner !== action)) break;
      const next = removeQteRule(n, b.target, own.id);
      if (next === n) break;
      n = next;
    }
    if (n !== w && !qteMembers(n, b.target).some(q => q.owner === action)) return n;
    w = n;
  }
  const n = structuredClone(w);
  disconnectQte(n, b.source, b.target, b.pin, action);
  return n;
}
/** Earlier editors kept a QTE's deleted line as a hidden cut: on opening, it becomes the same document edit. */
export function settleQteCuts(w: Workspace): Workspace {
  if (!w.disconnections?.some(c => c.bindings.some(isQteLine))) return w;
  const nodes = new Map(flatGraph({...w, disconnections: []}).nodes.map(n => [n.id, n]));
  let n: Workspace = {...w, disconnections: []};
  for (const c of w.disconnections)
    for (const b of c.bindings) if (isQteLine(b)) n = cutQte(n, b, nodes.get(b.source)?.action);
  const rest = w.disconnections.flatMap(c => {
    const bindings = c.bindings.filter(b => !isQteLine(b));
    return bindings.length ? [{...c, bindings}] : [];
  });
  n = structuredClone(n);
  if (rest.length) n.disconnections = rest;
  else delete n.disconnections;
  return n;
}
export function reconnectEdge(w: Workspace, source: string, target: string, pin?: string): Workspace | undefined {
  if (!w.disconnections?.length) return;
  const graph = tableProjection(w, compactGraph(w, flatGraph(w)));
  const edge = graph.edges.find(e => e.source === source && e.target === target && (!pin || e.pin === pin));
  const keys = new Set(edge?.origins?.map(key));
  let changed = false;
  const cuts = w.disconnections.flatMap(c => {
    const exact = c.source === source && c.target === target && (!pin || c.pin === pin);
    const bindings = c.bindings.filter(b => !exact && !keys.has(key(b)));
    if (bindings.length !== c.bindings.length) changed = true;
    return bindings.length ? [{...c, bindings}] : [];
  });
  return changed ? {...w, disconnections: cuts} : undefined;
}

export function visibleEdges(w: Workspace, edges: GraphEdge[]): GraphEdge[] {
  const removed = new Set(w.disconnections?.flatMap(c => c.bindings.map(key)));
  return edges.flatMap(e => {
    const origins = e.origins ?? [{source: e.source, target: e.target, pin: e.pin, targetPin: e.targetPin}];
    const kept = origins.filter(o => !removed.has(key(o)));
    return kept.length ? [{...e, origins: kept}] : [];
  });
}
// Keep disconnected node data in the authoring document. Only the compiler
// adapter removes the corresponding runtime binding.
/** The action an HKX card (or its state node) stands for. */
const actionOf = (id: string) => /^anim:([^:]+):\|clip_/.exec(id)?.[1] ?? id;
export function lowerDisconnected(w: Workspace): Workspace {
  if (!w.disconnections?.length) return w;
  let n = structuredClone(w);
  delete n.disconnections;
  const graph = flatGraph(n),
    nodes = new Map(graph.nodes.map(n => [n.id, n])),
    blends = blendNodes(n);
  const handled = new Set<string>();
  for (const cut of w.disconnections)
    for (const e of cut.bindings) {
      const k = key(e);
      if (handled.has(k)) continue;
      handled.add(k);
      const s = nodes.get(e.source),
        t = nodes.get(e.target);
      if (cut.setting && s?.kind === 'cameraRestore' && s.action) {
        const a = n.actions.find(a => a.uid === s.action);
        if (a) a.cameraEnabled = false;
        continue;
      }
      const from = parseNodeId(e.source),
        to = parseNodeId(e.target);
      if (from.kind === 'qte' || to.kind === 'qte') {
        disconnectQte(n, e.source, e.target, e.pin, s?.action);
        continue;
      }
      // A changed graph may no longer contain this saved connection.
      if (!graph.edges.some(x => key(x) === k)) continue;
      if (from.kind === 'branch') {
        const {owner, test: id} = from,
          a = n.actions.find(a => a.uid === owner)!;
        if (e.pin === 'condition') {
          const dest = to.kind === 'branch' ? a.flow?.tests.find(t => t.id === to.test) : undefined;
          if (dest) dest.operands = dest.operands?.filter(x => x !== id);
        } else {
          const test = a.flow?.tests.find(t => t.id === id);
          if (test && (e.pin === 'pass' || e.pin === 'fail')) delete test[e.pin];
        }
        continue;
      }
      const blend = blends.find(b => b.id === e.source || b.id === e.target);
      if (blend) {
        n.blends ??= structuredClone(blends);
        const b = n.blends.find(b => b.id === blend.id);
        if (!b) continue;
        if (cut.setting) {
          const binding = blendBinding(w, blend),
            a = n.actions.find(a => a.uid === binding.action);
          if (binding.kind === 'enter' && a) a.enterBlendEnabled = false;
          else if (binding.kind === 'exit' && a) a.exitBlendEnabled = false;
          else throw Error(tr('전환 블렌드는 실행 경로에서 편집하세요.'));
          n.blends = n.blends.filter(b => b.id !== blend.id);
          continue;
        }
        if (w.sharedRules?.some(g => g.kind === 'node' && g.members.includes(blend.id))) {
          n.blends = n.blends.filter(b => b.id !== blend.id);
          continue;
        }
        if (e.source === b.id) b.target = '';
        else b.source = '';
        continue;
      }
      if (t?.notify && t.action) {
        n = remove(n, t.action, t.notify);
        continue;
      }
      if (t?.kind === 'cameraRestore' && t.action) {
        const a = n.actions.find(a => a.uid === t.action);
        if (a) a.cameraEnabled = false;
        continue;
      }
      if ((t?.kind === 'suppress' || t?.kind === 'fireArrow' || t?.kind === 'carryRelease') && t.action) {
        delete n.actions.find(a => a.uid === t.action)!.config[t.kind];
        continue;
      }
      if (t?.kind === 'carry' && t.action) {
        const a = n.actions.find(a => a.uid === t.action);
        if (a?.pair) delete a.pair.carry;
        continue;
      }
      if (t?.kind === 'carryFix' && t.action) {
        const a = n.actions.find(a => a.uid === t.action);
        if (a?.pair?.carry) a.pair.carry.fix = null;
        continue;
      }
      if (s?.kind === 'carry' && s.action) {
        const a = n.actions.find(a => a.uid === s.action);
        if (a?.pair?.carry) a.pair.carry.putdownAction = '';
        continue;
      }
      if (s?.kind === 'stateCondition' && s.action) {
        Object.assign(n.actions.find(a => a.uid === s.action)!.config, {
          air: 'deny',
          cooldown: 0,
        });
        continue;
      }
      const input = s?.scope.kind === 'start' ? s : t?.scope.kind === 'start' ? t : undefined;
      if (input && ['keyInput', 'markerReceive'].includes(input.kind) && input.action) {
        n.actions.find(a => a.uid === input.action)!.config.start.mode = 'none';
        continue;
      }
      const linkNode = s?.scope.kind === 'link' ? s : t?.scope.kind === 'link' ? t : undefined;
      if (linkNode?.scope.kind === 'link') {
        const id = linkNode.scope.link,
          l = n.links.find(l => l.id === id);
        if (l) {
          if (e.pin === 'partner') l.partnerTo = '';
          else {
            n.links = n.links.filter(l => l.id !== id);
            // Its blend goes with it: behind its card, or drawn straight between its two HKX when no other
            // transition joins them (graph/reuseBlend.ts).
            const between = (b: {source: string; target: string}) =>
              actionOf(b.source) === l.from &&
              actionOf(b.target) === l.to &&
              !n.links.some(x => x.from === l.from && x.to === l.to);
            n.blends = blendNodes(n).filter(b => !inScope(b.source, {kind: 'link', link: id}) && !between(b));
          }
        }
        continue;
      }
      throw Error(
        tr('연결이 미완성입니다. 연결을 복구하거나 해당 기능 카드를 정리하세요: ') + e.source + ' → ' + e.target
      );
    }
  return n;
}
