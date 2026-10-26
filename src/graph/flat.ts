import {gameControlLabel} from '../keys.ts';
import {putdownCandidate, setPutdown} from '../carry.ts';
import {recoveryStep} from '../clipRecovery.ts';
import {qteMembers, qtePinRule} from './qteGroups.ts';
import {projectQtes, addQte, connectQte, qteCardOf} from './qteGraph.ts';
import {retirePlayback} from './deletePlayback.ts';
import {ruleNode} from './sharing.ts';
import {parseNodeId} from './nodeRef.ts';
import type {Workspace} from '../workspace.ts';
import type {GraphRef} from './state.ts';
import {graphId} from './state.ts';
import {projectGraph, graphPosition, deleteGraphNode, mutateGraph, moveNodes} from './projection.ts';
import type {GraphNode, GraphEdge} from './projection.ts';
import {rows, remove, add} from '../timeline/model.ts';
import {timingLabel, mark} from '../model.ts';
import {animId} from './blends.ts';
import {addAction, uid, type Link} from '../workspace.ts';
import {tr} from '../i18n/korean.ts';
import {functionParts} from '../eventRegistry.ts';
import {
  cardTitle,
  makesLoop,
  newCard,
  newStart,
  refAction,
  refCard,
  startText,
  type ConditionCard,
  type Ref,
} from '../cards.ts';
import {conditionNames} from './conditionExpression.ts';
import {cardSummary} from './cardCommands.ts';

// The canvas of an XML format 6 document (docs/설계-형식6-에디터.md 3): start cards, condition cards, HKX cards (each
// with its items: features and moments), transition cards and QTE cards, joined by the destinations the document
// holds. A command (graph/commands.ts) is one document edit.

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
};
export const flatId = (g: GraphRef, id: string) => (g.kind === 'root' ? id : `${graphId(g)}|${id}`);
/** The project's event registry node (eventRegistry.ts): always present, never deleted or copied. */
export const REGISTRY_NODE = 'eventRegistry';
export const startCardId = (uid: string) => 'startCard:' + uid;
export const conditionCardId = (uid: string) => 'conditionCard:' + uid;
export const transitionId = (link: string) => 'transition:' + link;
/** A card's route pins: its rows, True and False. */
export const rowPin = (row: string) => 'row:' + row;
const root: GraphRef = {kind: 'root'};
/** The HKX card of an action (its entry clip). */
export const hkxId = (w: Workspace, action: string) => {
  const a = w.actions.find(a => a.uid === action);
  return a ? animId(a.uid, 'clip_' + a.config.entry) : '';
};
/** The node a destination is drawn to. */
export const refNode = (w: Workspace, r: Ref) =>
  refAction(r) ? hkxId(w, refAction(r)) : refCard(r) ? conditionCardId(refCard(r)) : '';

export function flatGraph(w: Workspace) {
  const nodes: FlatNode[] = [],
    edges: GraphEdge[] = [],
    byId = new Map<string, FlatNode>();
  const add = (n: FlatNode) => {
    nodes.push(n);
    if (!byId.has(n.id)) byId.set(n.id, n);
  };
  const wire = (source: string, target: string, pin: GraphEdge['pin'] = 'trigger') => {
    const s = byId.get(source),
      d = byId.get(target);
    if (!s || !d) return;
    if (!s.outputs.includes(pin)) s.outputs = [...s.outputs, pin];
    if (!d.inputs.includes('trigger')) d.inputs = [...d.inputs, 'trigger'];
    edges.push({id: `flat:${source}>${target}:${pin}`, source, target, pin, targetPin: 'trigger'});
  };
  // The canvas's notes.
  for (const n of projectGraph(w, root).nodes)
    if (n.kind === 'comment') add({...n, kind: 'comment', scope: root, original: n.id, position: n.position});
  // HKX cards and their items (features, moments), as the card shows them (graph/checklist.ts).
  for (const [i, a] of w.actions.entries()) {
    const y = i * 1100,
      scope: GraphRef = {kind: 'anim', action: a.uid};
    if (!a.config.steps.length) continue;
    const p = projectGraph(w, scope);
    for (const n of p.nodes) {
      if (n.kind === 'outputPose' || n.kind === 'comment') continue;
      // The start and end blends are items of the HKX card (<Action enter>, <Exit blend>).
      const blend = n.kind === 'blendIn' || n.kind === 'blendOut';
      const node: FlatNode = {
        ...n,
        id: flatId(scope, n.id),
        kind: blend ? 'blend' : n.kind,
        ...(blend ? {title: n.kind === 'blendIn' ? tr('블렌드(시작)') : tr('블렌드(종료)')} : {}),
        scope,
        original: n.id,
        action: a.uid,
        open: undefined,
        position: graphPosition(w, root, flatId(scope, n.id), {x: 1300 + n.position.x, y: y + n.position.y}),
      };
      if (n.kind === 'hkxPlay') {
        node.inputs = ['trigger'];
        node.outputs = ['trigger'];
      }
      add(node);
    }
    // The card's own lines to its items keep their pins on both ends.
    for (const e of p.edges) {
      const s = byId.get(flatId(scope, e.source)),
        d = byId.get(flatId(scope, e.target));
      if (!s || !d) continue;
      if (!s.outputs.includes(e.pin)) s.outputs = [...s.outputs, e.pin];
      const pin = e.targetPin ?? e.pin;
      if (!d.inputs.includes(pin)) d.inputs = [...d.inputs, pin];
      edges.push({...e, id: flatId(scope, e.id), source: s.id, target: d.id});
    }
    // The HKX's air rule (both or only): an item of its card.
    if (a.config.air !== 'deny') {
      const start: GraphRef = {kind: 'start', action: a.uid},
        id = flatId(start, 'stateCondition');
      add({
        id,
        kind: 'stateCondition',
        title: tr('공중'),
        summary: a.config.air === 'only' ? tr('공중에서만') : tr('땅·공중'),
        scope: start,
        original: 'stateCondition',
        action: a.uid,
        inputs: ['trigger'],
        outputs: [],
        position: {x: 0, y: 0},
      });
      wire(animId(a.uid, 'clip_' + a.config.entry), id);
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
      const step = recoveryStep(r.id);
      wire(animId(a.uid, 'clip_' + (step || a.config.entry)), id);
    }
  }
  for (const a of w.actions)
    if (a.pair?.carry?.putdownAction) {
      const lower = w.actions.find(x => x.uid === a.pair!.carry!.putdownAction);
      if (lower) wire(animId(a.uid, 'carry'), animId(lower.uid, 'clip_' + lower.config.entry));
    }
  // Start cards.
  for (const [i, s] of w.starts.entries()) {
    const id = startCardId(s.uid);
    add({
      id,
      kind: 'startCard',
      title: s.mode === 'event' ? tr('시작 · 이벤트') : tr('시작 · 키'),
      summary: startText(s),
      scope: root,
      original: id,
      inputs: [],
      outputs: ['trigger'],
      position: graphPosition(w, root, id, s.position ?? {x: -400, y: i * 200}),
    });
  }
  // Condition cards: a route pin per row, True and False.
  const name = (t: Parameters<typeof cardTitle>[0]['tests'][number]) => conditionNames[t.kind] ?? t.kind;
  for (const c of w.cards) {
    const id = conditionCardId(c.uid);
    add({
      id,
      kind: 'conditionCard',
      title: cardTitle(c, name),
      summary: cardSummary(c),
      scope: root,
      original: id,
      inputs: ['trigger'],
      outputs: [
        ...(c.true !== undefined ? ['true' as const] : []),
        ...c.rows.map(r => rowPin(r.id) as 'trigger'),
        'false',
      ],
      position: graphPosition(w, root, id, c.position),
    });
  }
  // Transition cards: from their HKX, on to their destination (and a pair's partner's action).
  for (const [i, l] of w.links.entries()) {
    const id = transitionId(l.id),
      from = w.actions.find(a => a.uid === l.from);
    const key = from?.config.inputs.find(x => x.id === l.input);
    add({
      id,
      kind: 'transition',
      title: l.mode === 'event' ? tr('전환 이벤트') : tr('전환 키 입력'),
      summary:
        (l.mode === 'event'
          ? l.event || tr('이벤트 미지정')
          : key?.control
            ? gameControlLabel(key.control)
            : key?.key || (key?.gamepad ? tr('패드') : tr('키 미지정'))) +
        (l.window ? ' · ' + timingLabel(l.open) + ' → ' + timingLabel(l.close) : ''),
      scope: root,
      original: id,
      action: l.from,
      inputs: ['trigger'],
      // A pair's transition to an ordinary action (or none yet) also names the partner's (victim's) action.
      outputs: [
        'trigger',
        ...(from?.pair && !l.card && !w.actions.find(x => x.uid === l.to)?.pair ? ['partner' as const] : []),
      ],
      position: graphPosition(w, root, id, l.position ?? {x: 4000, y: i * 450}),
    });
  }
  // Lines: every destination the document holds.
  for (const s of w.starts) if (s.to) wire(startCardId(s.uid), refNode(w, s.to));
  for (const c of w.cards) {
    const id = conditionCardId(c.uid);
    if (c.true) wire(id, refNode(w, c.true), 'true' as GraphEdge['pin']);
    for (const r of c.rows) if (r.to) wire(id, refNode(w, r.to), rowPin(r.id) as GraphEdge['pin']);
    if (c.false) wire(id, refNode(w, c.false), 'false' as GraphEdge['pin']);
  }
  for (const l of w.links) {
    const id = transitionId(l.id);
    wire(hkxId(w, l.from), id);
    if (l.card || l.to) wire(id, l.card ? conditionCardId(l.card) : hkxId(w, l.to));
    if (l.partnerTo) wire(id, hkxId(w, l.partnerTo), 'partner');
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
  return {nodes, edges: [...unique.values()]};
}
export function flatNode(w: Workspace, id: string) {
  return flatGraph(w).nodes.find(n => n.id === id);
}

const cardOf = (w: Workspace, uid: string) => {
  const c = w.cards.find(c => c.uid === uid);
  if (!c) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  return c;
};
/** Every destination that names `gone` (a card or an action) leads nowhere now. */
function forget(w: Workspace, gone: {card?: string; action?: string}): Workspace {
  const clear = (r: Ref): Ref =>
    (gone.card && refCard(r) === gone.card) || (gone.action && refAction(r) === gone.action) ? null : r;
  return {
    ...w,
    starts: w.starts.map(s => ({...s, to: clear(s.to)})),
    cards: w.cards.map(c => ({
      ...c,
      rows: c.rows.map(r => ({...r, to: clear(r.to)})),
      ...(c.true !== undefined ? {true: clear(c.true)} : {}),
      false: clear(c.false),
    })),
    links: w.links.map(l => (gone.card && l.card === gone.card ? {...l, card: undefined, to: ''} : l)),
    ...(w.qtes
      ? {
          qtes: w.qtes.map(q => ({
            ...q,
            results: Object.fromEntries(
              Object.entries(q.results).map(([k, r]) => [
                k,
                gone.card && r.card === gone.card ? {...r, card: undefined, to: ''} : r,
              ])
            ) as typeof q.results,
          })),
        }
      : {}),
  };
}
export function deleteFlat(w: Workspace, id: string): Workspace {
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
  if (idRef.kind === 'startCard')
    return {...w, starts: w.starts.filter(s => s.uid !== idRef.uid), order: w.order.filter(u => u !== idRef.uid)};
  if (idRef.kind === 'conditionCard') {
    const next = forget(w, {card: idRef.uid});
    return {
      ...next,
      cards: next.cards.filter(c => c.uid !== idRef.uid),
      order: next.order.filter(u => u !== idRef.uid),
    };
  }
  if (idRef.kind === 'transition') {
    const l = w.links.find(l => l.id === idRef.link);
    const next = {...w, links: w.links.filter(l => l.id !== idRef.link)};
    return l ? dropBinding(next, l.from, l.input) : next;
  }
  if (w.sharedRules)
    w = {
      ...w,
      sharedRules: w.sharedRules
        .map(g => ({...g, members: g.members.filter(m => ruleNode(g.kind, m, w) !== id)}))
        .filter(g => g.members.length > 1),
    };
  const n = flatNode(w, id);
  if (!n) return w;
  if (n.kind === 'hkxPlay' && n.action && n.step) return retirePlayback(w, n.action);
  if (n.kind === 'blend' && n.action) {
    const next = structuredClone(w),
      a = next.actions.find(a => a.uid === n.action)!;
    if (n.original === 'blendIn') a.enterBlendEnabled = false;
    else a.exitBlendEnabled = false;
    return next;
  }
  // The air rule is the action's own setting since format 6 (the start graph holds no node for it): deleting it
  // means ground only, the default (user report 10-26: 「공중」 could not be deleted).
  if (n.kind === 'stateCondition' && n.action) {
    const next = structuredClone(w);
    next.actions.find(a => a.uid === n.action)!.config.air = 'deny';
    return next;
  }
  return n.notify && n.action ? remove(w, n.action, n.notify) : deleteGraphNode(w, n.scope, n.original);
}

/** Set one destination (a start's, a card's row, True or False, a transition's); `to` null clears it. */
export function setDestination(w: Workspace, source: string, pin: string | undefined, to: Ref): Workspace {
  const ref = parseNodeId(source),
    next = structuredClone(w);
  if (ref.kind === 'startCard') {
    const s = next.starts.find(s => s.uid === ref.uid);
    if (!s) throw Error(tr('시작 카드를 찾지 못했습니다.'));
    s.to = to;
    return next;
  }
  if (ref.kind === 'conditionCard') {
    const c = cardOf(next, ref.uid);
    if (refCard(to) && makesLoop(next, c.uid, refCard(to)))
      throw Error(tr('이 카드로 이으면 조건 카드가 서로를 가리켜 순환합니다.'));
    if (pin === 'true') {
      if (c.true === undefined) throw Error(tr('True가 없는 카드입니다.'));
      c.true = to;
    } else if (pin === 'false') c.false = to;
    else if (pin?.startsWith('row:')) {
      const row = c.rows.find(r => r.id === pin.slice(4));
      if (!row) throw Error(tr('행을 찾지 못했습니다.'));
      row.to = to;
    } else throw Error(tr('행, True 또는 False 핀에서 연결하세요.'));
    return next;
  }
  if (ref.kind === 'transition') {
    const l = next.links.find(l => l.id === ref.link);
    if (!l) throw Error(tr('전환을 찾지 못했습니다.'));
    // The partner's action of a pair's transition (runtime Transition partnerTo).
    if (pin === 'partner') {
      const a = refAction(to);
      if (to) {
        const partner = next.actions.find(x => x.uid === a);
        if (!next.actions.find(x => x.uid === l.from)?.pair)
          throw Error(tr('상대(피해자) 동작은 페어에서 나가는 전환에만 지정합니다.'));
        if (!partner || partner.pair || l.card || next.actions.find(x => x.uid === l.to)?.pair)
          throw Error(tr('페어에서 양쪽 일반 동작으로 가는 전환만 상대(피해자) 동작을 가질 수 있습니다.'));
        if (a === l.to) throw Error(tr('시작자(가해자)와 상대(피해자)는 다른 동작으로 연결하세요.'));
      }
      l.partnerTo = a;
      return next;
    }
    const a = refAction(to),
      c = refCard(to);
    if (a === l.from) throw Error(tr('출발 동작 자신으로는 전환할 수 없습니다.'));
    // One HKX waits for an event once (the runtime would take the first).
    if (
      l.mode === 'event' &&
      l.event &&
      next.links.some(
        x => x !== l && x.from === l.from && x.mode === 'event' && x.event.toLowerCase() === l.event.toLowerCase()
      )
    )
      throw Error(tr('같은 출발 HKX에 이미 연결된 이벤트입니다.'));
    l.to = a;
    l.card = c || undefined;
    if (c || next.actions.find(x => x.uid === a)?.pair) l.partnerTo = '';
    if (c) delete l.blend;
    return next;
  }
  throw Error(tr('갈 곳을 고를 수 있는 카드가 아닙니다.'));
}
/** A key binding of an action's inputs nothing uses any more (a transition's, after it was deleted or switched to
 *  an event), dropped. A project input (입력 관리) stays. */
export function dropBinding(w: Workspace, action: string, input: string): Workspace {
  const a = w.actions.find(a => a.uid === action);
  if (!input || !a?.config.inputs.some(i => i.id === input)) return w;
  const used =
    w.links.some(l => l.from === action && l.mode === 'input' && l.input === input) ||
    a.pair?.carry?.input === input ||
    w.parameters.some(p => p.action === action && p.field === 'inputKey' && p.input === input) ||
    w.sharedInputs.some(i => i.id === input);
  if (used) return w;
  return {
    ...w,
    actions: w.actions.map(x =>
      x.uid === action ? {...x, config: {...x.config, inputs: x.config.inputs.filter(i => i.id !== input)}} : x
    ),
  };
}
/** The destination a target node stands for. */
export function targetRef(w: Workspace, target: string): Ref {
  const ref = parseNodeId(target);
  if (ref.kind === 'conditionCard') return {card: ref.uid};
  const n = flatNode(w, target);
  if (n?.kind === 'hkxPlay' && n.action) return {action: n.action};
  throw Error(tr('HKX 카드나 조건 카드에 연결하세요.'));
}

/** A drag from `source` (its pin `port`) to `target`. */
export function connectFlat(w: Workspace, source: string, target: string, port?: string): Workspace {
  if (source === target) throw Error(tr('같은 카드끼리는 연결할 수 없습니다.'));
  const from = parseNodeId(source),
    to = parseNodeId(target);
  if (from.kind === 'qte' || to.kind === 'qte') {
    // A QTE result into a condition card goes through it (format 6).
    if (from.kind === 'qte' && to.kind === 'conditionCard') return connectQteCard(w, source, target, port);
    return connectQte(w, source, target, port, flatGraph(w).nodes)!;
  }
  if (from.kind === 'startCard' || from.kind === 'conditionCard' || from.kind === 'transition')
    return setDestination(w, source, port, targetRef(w, target));
  const s = flatNode(w, source),
    d = to.kind === 'conditionCard' ? undefined : flatNode(w, target);
  // A carry's putdown: the carry item onto a one-actor HKX.
  if (s?.kind === 'carry' && s.action) {
    const a = w.actions.find(x => x.uid === s.action),
      putdown = w.actions.find(x => x.uid === d?.action);
    if (!a?.pair?.carry || d?.kind !== 'hkxPlay' || !putdown || !putdownCandidate(putdown, a, w))
      throw Error(tr('시작이 없는 한 사람 일반 동작(내려놓기 동작) HKX에 연결하세요.'));
    return setPutdown(w, a.uid, putdown.uid);
  }
  // HKX to HKX or a condition card: a transition (its key or event is chosen on its card).
  if (s?.kind === 'hkxPlay' && s.action && (d?.kind === 'hkxPlay' || to.kind === 'conditionCard')) {
    const r = targetRef(w, target);
    return addTransition(w, s.action, r, undefined, 'input').workspace;
  }
  throw Error(tr('이 핀 조합은 연결할 수 없습니다. 시작·조건·전환 카드의 핀에서 HKX나 조건 카드로 이으세요.'));
}
/** A new transition from an action's HKX to a destination: by an event, or by a key of its own (a new binding of the
 *  source HKX whose key the details set). */
export function addTransition(
  w: Workspace,
  from: string,
  to: Ref,
  position?: {x: number; y: number},
  mode: Link['mode'] = 'event'
) {
  const a = w.actions.find(a => a.uid === from);
  if (!a) throw Error(tr('출발 HKX를 찾지 못했습니다.'));
  if (refAction(to) === from) throw Error(tr('출발 동작 자신으로는 전환할 수 없습니다.'));
  const id = uid(
    'link',
    w.links.map(l => l.id)
  );
  const l: Link = {
    id,
    from,
    to: refAction(to),
    ...(refCard(to) ? {card: refCard(to)} : {}),
    partnerTo: '',
    mode,
    input: '',
    event: '',
    window: mode === 'input',
    open: mark(0.3),
    close: mark(1.5),
    buffered: true,
    position: position ?? {x: a.position.x + 420, y: a.position.y + 90},
  };
  let next = {...w, links: [...w.links, l]};
  if (mode === 'input') {
    next = structuredClone(next);
    const source = next.actions.find(x => x.uid === from)!;
    let k = 1;
    while (source.config.inputs.some(i => i.id === 'binding' + k)) k++;
    source.config.inputs.push({id: 'binding' + k, label: 'binding' + k, key: '', gamepad: 0});
    next.links.at(-1)!.input = 'binding' + k;
  }
  const node = transitionId(id);
  return {workspace: position ? moveNodes(next, root, {[node]: position}) : next, id: node};
}
function connectQteCard(w: Workspace, source: string, target: string, pin: string | undefined): Workspace {
  const n = structuredClone(w),
    members = qteMembers(n, source);
  const r = qtePinRule(members, pin ?? '');
  if (!r) throw Error(tr('규칙의 성공·실패·완벽 결과를 선택하세요.'));
  if (r.partner) throw Error(tr('상대 동작은 HKX로 바로 이으세요.'));
  const result = r.q.results[r.outcome];
  result.mode = 'transition';
  result.to = '';
  result.card = parseNodeId(target).kind === 'conditionCard' ? (parseNodeId(target) as {uid: string}).uid : undefined;
  result.partnerTo = '';
  return n;
}
export function makePlaybackAction(w: Workspace, kind: 'single' | 'pair' = 'single') {
  const a = addAction(w, kind);
  a.nodeAuthored = true;
  a.enterBlendEnabled = false;
  a.exitBlendEnabled = false;
  a.config.steps[0].clip = '';
  a.config.steps[0].label = tr('새 HKX');
  a.config.inputs = [];
  return a;
}
/** A new card on the canvas: a start (key or event), a condition card, an HKX, a QTE; or an item of an HKX card
 *  (`action`): a feature, a moment, a blend. */
export function addFlat(w: Workspace, action: string, kind: string, position: {x: number; y: number}) {
  if (kind === 'qte') return addQte(w, position);
  if (kind === 'keyInput' || kind === 'markerReceive' || kind === 'startCard') {
    const s = newStart(w, position, kind === 'markerReceive' ? 'event' : 'input');
    const id = startCardId(s.uid);
    return {workspace: moveNodes({...w, starts: [...w.starts, s]}, root, {[id]: position}), id};
  }
  if (kind === 'conditionBranch' || kind === 'conditionCard') {
    const c: ConditionCard = newCard(w, position);
    const id = conditionCardId(c.uid);
    return {workspace: moveNodes({...w, cards: [...w.cards, c]}, root, {[id]: position}), id};
  }
  if (kind === 'playNode' || kind === 'state' || kind === 'hkxPlay') {
    const a = makePlaybackAction(w);
    const id = animId(a.uid, 'clip_' + a.config.steps[0].id);
    return {workspace: moveNodes({...w, actions: [...w.actions, a]}, root, {[id]: position}), id};
  }
  return addItem(w, action, kind);
}
/** The start or end blend an HKX play card's features add (10-20: 0.2 s was too short to read as a blend). */
export const HKX_BLEND_SECONDS = 0.3;
/** An item of an HKX card: its id is the item node's. */
export function addItem(w: Workspace, action: string, kind: string, before = false) {
  const a = w.actions.find(a => a.uid === action);
  if (!a) throw Error(tr('HKX 카드를 고른 뒤 추가하세요.'));
  if (kind === 'blend') {
    const next = structuredClone(w),
      x = next.actions.find(x => x.uid === action)!;
    if (before) {
      if (!x.enterBlendEnabled) x.config.enterBlend = HKX_BLEND_SECONDS;
      x.enterBlendEnabled = true;
    } else {
      if (!x.exitBlendEnabled) x.config.exitBlend = HKX_BLEND_SECONDS;
      x.exitBlendEnabled = true;
    }
    return {workspace: next, id: animId(action, before ? 'blendIn' : 'blendOut')};
  }
  if (kind === 'stateCondition') {
    const next = structuredClone(w);
    next.actions.find(x => x.uid === action)!.config.air = 'allow';
    return {workspace: next, id: flatId({kind: 'start', action}, 'stateCondition')};
  }
  if (kind.startsWith('notify:')) {
    const r = add(w, action, kind.slice(7), 0);
    return {workspace: r.workspace, id: `notify:${action}|${r.id}`};
  }
  return {workspace: mutateGraph(w, {kind: 'anim', action}, kind as never), id: animId(action, kind)};
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
  'strike',
  'sound',
  'globalSet',
  'modEvent',
];
