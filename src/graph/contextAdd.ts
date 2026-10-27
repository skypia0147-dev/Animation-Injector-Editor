import type {Workspace} from '../workspace.ts';
import {addFlat, addItem, addTransition, flatGraph, flatNode, notifyKinds, rowPin, setDestination} from './flat.ts';
import {rows, slots, title} from '../timeline/model.ts';
import {parseNodeId} from './nodeRef.ts';
import {addRow} from './cardCommands.ts';
import type {Ref} from '../cards.ts';
import {tr} from '../i18n/korean.ts';
import {ordinaryEffectOps} from '../clipEffects.ts';
export type AddOption = {
  label: string;
  kind: string;
  before?: boolean;
  /** The pin it is added on: a card's row (row:<id>), True or False; a start's or transition's destination. */
  port?: string;
  entry?: boolean;
  /** Shown dimmed with this reason (a menu that lists what is already there). */
  disabled?: string;
  /** A short note beside an option that can be added (a blend: the engine's own plays until one is added). */
  note?: string;
};
export {HKX_BLEND_SECONDS} from './flat.ts';
const offset = (p: {x: number; y: number}, dx: number, dy = 0) => ({x: p.x + dx, y: p.y + dy});

/** Add what a card's menu offers, joined to it (`source`): an item of an HKX card, a start before it, a transition
 *  after it, a condition card or an HKX on a free pin. Returns the new node. */
export function addConnected(w: Workspace, source: string, option: AddOption, position: {x: number; y: number}) {
  const ref = parseNodeId(source);
  const node = flatNode(w, source);
  if (!node) throw Error(tr('연결할 카드를 찾지 못했습니다.'));
  // A card's own row.
  if (ref.kind === 'conditionCard' && option.kind === 'row') {
    const r = addRow(w, ref.uid);
    return {workspace: r.workspace, id: source};
  }
  // On a free pin of a start, a card or a transition: a new condition card or HKX there.
  if (ref.kind === 'startCard' || ref.kind === 'conditionCard' || ref.kind === 'transition') {
    const made = addFlat(w, '', option.kind === 'conditionCard' ? 'conditionCard' : 'playNode', offset(position, 380));
    const to: Ref =
      option.kind === 'conditionCard'
        ? {card: parseNodeId(made.id).kind === 'conditionCard' ? (parseNodeId(made.id) as {uid: string}).uid : ''}
        : {action: made.workspace.actions.at(-1)!.uid};
    return {workspace: setDestination(made.workspace, source, option.port, to), id: made.id};
  }
  if (node.kind !== 'hkxPlay' || !node.action) throw Error(tr('이 카드에는 추가할 것이 없습니다.'));
  const action = node.action;
  // A start before it: a new start card going to this HKX.
  if ((option.kind === 'keyInput' || option.kind === 'markerReceive') && option.before) {
    const made = addFlat(w, '', option.kind, offset(position, -420));
    const uid = (parseNodeId(made.id) as {uid: string}).uid;
    return {workspace: setDestination(made.workspace, 'startCard:' + uid, undefined, {action}), id: made.id};
  }
  // A transition after it (key or event), to choose its destination on its card; the next action: a new HKX too.
  if (option.kind === 'keyInput' || option.kind === 'markerReceive' || option.kind === 'playNode') {
    let next = w,
      to: Ref = null;
    if (option.kind === 'playNode') {
      const made = addFlat(w, '', 'playNode', offset(position, 760));
      next = made.workspace;
      to = {action: next.actions.at(-1)!.uid};
    }
    return addTransition(next, action, to, offset(position, 380), option.kind === 'keyInput' ? 'input' : 'event');
  }
  // A condition card in front of it: the starts that went to it go through the card, whose True plays it.
  if (option.kind === 'conditionBranch' || option.kind === 'conditionCard') {
    const made = addFlat(w, '', 'conditionCard', offset(position, -380));
    const uid = (parseNodeId(made.id) as {uid: string}).uid;
    const next = structuredClone(made.workspace);
    const card = next.cards.find(c => c.uid === uid)!;
    card.true = {action};
    for (const s of next.starts) if (s.to && 'action' in s.to && s.to.action === action) s.to = {card: uid};
    return {workspace: next, id: made.id};
  }
  if (option.kind === 'qte') {
    const made = addFlat(w, action, 'qte', offset(position, 320, 160));
    const next = structuredClone(made.workspace),
      q = next.qtes!.at(-1)!;
    q.owner = action;
    q.step = next.actions.find(a => a.uid === action)!.config.entry;
    return {workspace: next, id: made.id};
  }
  if (option.kind === 'blend') return addItem(w, action, 'blend', !!option.before);
  return addItem(w, action, option.kind);
}
/** What a card's menu offers to add. */
export function contextualAdds(w: Workspace, id: string, graph = flatGraph(w)): AddOption[] {
  const ref = parseNodeId(id);
  if (ref.kind === 'conditionCard') {
    const c = w.cards.find(c => c.uid === ref.uid);
    if (!c) return [];
    const options: AddOption[] = [
      // On a True card the new row takes True's place and destination (cardCommands addRow).
      {label: tr('조건 추가'), kind: 'row'},
    ];
    const free = [
      ...(c.true !== undefined && !c.true ? [{pin: 'true', name: 'True'}] : []),
      ...c.rows.flatMap((r, i) => (r.to ? [] : [{pin: rowPin(r.id), name: tr('행 {n}', {n: i + 1})}])),
      ...(c.false ? [] : [{pin: 'false', name: 'False'}]),
    ];
    for (const f of free)
      options.push(
        {label: tr('{name} → HKX 재생 추가', {name: f.name}), kind: 'playNode', port: f.pin},
        {label: tr('{name} → 조건 카드 추가', {name: f.name}), kind: 'conditionCard', port: f.pin}
      );
    return options;
  }
  if (ref.kind === 'startCard' || ref.kind === 'transition') {
    const empty =
      ref.kind === 'startCard'
        ? !w.starts.find(s => s.uid === ref.uid)?.to
        : (l => !!l && !l.to && !l.card)(w.links.find(l => l.id === ref.link));
    return empty
      ? [
          {label: tr('HKX 재생 추가'), kind: 'playNode', port: 'trigger'},
          {label: tr('조건 카드 추가'), kind: 'conditionCard', port: 'trigger'},
        ]
      : [];
  }
  const node = graph.nodes.find(n => n.id === id);
  if (!node || node.kind !== 'hkxPlay') return [];
  const a = w.actions.find(a => a.uid === node.action),
    options: AddOption[] = [
      {label: tr('시작 키 입력 추가'), kind: 'keyInput', before: true},
      {label: tr('시작 이벤트 추가'), kind: 'markerReceive', before: true},
      {label: tr('전환 키 입력 추가'), kind: 'keyInput'},
      {label: tr('전환 이벤트 추가'), kind: 'markerReceive'},
      {label: tr('공중 규칙 추가'), kind: 'stateCondition', before: true},
      {label: tr('앞에 조건 카드 추가'), kind: 'conditionCard', entry: true},
      {label: tr('앞에 블렌드 추가'), kind: 'blend', before: true},
      {label: tr('뒤에 블렌드 추가'), kind: 'blend'},
      {label: tr('다음 동작 추가'), kind: 'playNode'},
      {label: tr('바닐라 이벤트 차단 추가'), kind: 'suppress'},
      {label: tr('QTE 추가'), kind: 'qte'},
    ];
  // Only a carry's putdown Action takes a release moment (the runtime rejects it elsewhere).
  if (a && !a.pair && w.actions.some(x => x.pair?.carry?.putdownAction === a.uid))
    options.push({label: tr('대상 놓기 추가'), kind: 'carryRelease'});
  // Camera restore: any action (10-16, runtime 0.12.260); a carry is a pair's.
  options.push({label: tr('카메라 복구 추가'), kind: 'cameraRestore'});
  if (a?.pair) options.push({label: tr('운반 추가'), kind: 'carry'});
  for (const kind of notifyKinds.filter(k =>
    a?.pair
      ? k !== 'vanillaCancel' && k !== 'fireArrow'
      : ['rotate', 'iframe', 'armor', 'cost', 'recovery', 'vanillaCancel', ...ordinaryEffectOps].includes(k)
  ))
    options.push({
      label: title(kind) + tr(' 추가'),
      kind: 'notify:' + kind,
      // A slot, the cost and the recovery are an action's once.
      ...(a && [...slots, 'cost', 'recovery'].includes(kind) && rows(w, a).some(r => r.kind === kind)
        ? {disabled: tr('이미 있음')}
        : {}),
    });
  return options
    .sort((a, b) => Number(b.kind === 'blend') - Number(a.kind === 'blend'))
    .filter(o => {
      if (o.kind === 'stateCondition') return a?.config.air === 'deny';
      if (o.kind === 'cameraRestore') return !a?.cameraEnabled;
      if (o.kind === 'carry') return !a?.pair?.carry;
      if (o.kind === 'blend') return !(o.before ? a?.enterBlendEnabled : a?.exitBlendEnabled);
      if (o.kind === 'suppress' || o.kind === 'carryRelease') return !a?.config[o.kind];
      if (o.kind === 'markerReceive' && !o.before) return a?.config.kind === 'single';
      return true;
    });
}
