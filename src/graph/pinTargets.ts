// Connecting an output pin by choosing its destination from a list (the card's ▾ and the Details "연결" section),
// as well as by dragging: a start's, a condition card's rows, True and False, a transition's and a QTE result's. A
// choice runs the same connection as a drag (connectFlat).
import type {Workspace, Action} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {connectFlat, setDestination} from './flat.ts';
import {parseNodeId} from './nodeRef.ts';
import {cardNames, cardTitle, makesLoop, refAction, refCard, type CardTest, type Ref} from '../cards.ts';
import {conditionNames} from './conditionExpression.ts';
import {qteMembers, qtePinRule} from './qteGroups.ts';
import {tr} from '../i18n/korean.ts';

type View = {nodes: FlatNode[]; edges: GraphEdge[]};
export type PinTarget = {id: string; label: string; group: string; disabled?: string};
export type PinRow = {
  pin: string;
  label: string;
  current: string;
  currentLabel: string;
  targets: PinTarget[];
  /** The pin may be left unconnected (its list offers "연결 안 함"). */
  clearable: boolean;
};

/** What a card and Details call an output pin. */
export function portLabel(node: Pick<FlatNode, 'kind' | 'outputs' | 'eventQte' | 'id'>, pin: string) {
  // A pair's transition starts the starter's (attacker's) action and the partner's (victim's) action.
  if (node.outputs.includes('partner') && (pin === 'trigger' || pin === 'partner'))
    return pin === 'trigger' ? tr('가해자') : tr('피해자');
  if (node.kind === 'qte') {
    if (pin === 'pass') return tr('성공');
    if (pin === 'fail') return tr('실패');
    if (pin === 'perfect') return tr('완벽');
    // A rule pin: choice:<rule>:<outcome>[:partner] in a group (qteGroups.ts qteRulePin), choice:<outcome>:partner
    // for a lone QTE's victim.
    if (pin.startsWith('choice:')) {
      const {outcome, partner} = qteChoice(pin);
      const names: Record<string, string> = {success: tr('성공'), failure: tr('실패'), perfect: tr('완벽')};
      return (names[outcome] ?? tr('결과')) + (partner ? (node.eventQte ? tr(' · 상대') : tr(' · 피해자')) : '');
    }
    return pin;
  }
  if (node.kind === 'conditionCard') {
    if (pin === 'true') return 'True';
    if (pin === 'false') return 'False';
    // A row's badge is its number (rows are tried from the top).
    if (pin.startsWith('row:'))
      return String((node.outputs as string[]).filter(p => p.startsWith('row:')).indexOf(pin) + 1);
  }
  return pin === 'trigger' ? tr('도착') : pin;
}

/** The output pins a card draws as route rows, each with its list: the pins pinRows lists. */
export function routePins(node: Pick<FlatNode, 'id' | 'kind' | 'scope' | 'outputs'>): string[] {
  if (!routable(node)) return [];
  if (node.kind === 'transition') return node.outputs.filter(p => p === 'trigger' || p === 'partner');
  return node.outputs;
}
export type RouteTone = 'pass' | 'fail' | 'perfect' | 'starter' | 'partner' | 'plain';
/** A QTE's choice pin read as qteGroups.ts qtePinRule does: its outcome and whether it is the victim's. */
export function qteChoice(pin: string) {
  const parts = pin.split(':'),
    grouped = ['success', 'failure', 'perfect'].includes(parts[2]);
  return {outcome: grouped ? parts[2] : parts[1], partner: pin.endsWith(':partner')};
}
/** A route's colour (its row's label, pin and line): a card's True and False, a QTE's outcome, a pair's two roles;
 *  one destination alone and a card's rows stay plain. */
export function routeTone(node: Pick<FlatNode, 'id' | 'kind' | 'outputs'>, pin: string): RouteTone {
  if (node.kind === 'qte') {
    const outcome = pin.startsWith('choice:') ? qteChoice(pin).outcome : pin;
    return outcome === 'pass' || outcome === 'success'
      ? 'pass'
      : outcome === 'fail' || outcome === 'failure'
        ? 'fail'
        : outcome === 'perfect'
          ? 'perfect'
          : 'plain';
  }
  if (node.kind === 'conditionCard') return pin === 'true' ? 'pass' : pin === 'false' ? 'fail' : 'plain';
  if (node.outputs.includes('partner')) return pin === 'partner' ? 'partner' : pin === 'trigger' ? 'starter' : 'plain';
  return 'plain';
}
/** What an unconnected route row says happens: a QTE result continues, a card's False plays nothing, a pair's
 *  victim is optional. */
export function routeEmpty(node: Pick<FlatNode, 'id' | 'kind'>, pin: string): string {
  if (node.kind === 'qte') return tr('계속');
  if (pin === 'partner') return tr('없음');
  if (node.kind === 'conditionCard' && pin === 'false') return tr('재생 안 함');
  return tr('고르기');
}

/** The transition node a choice created: none in format 6 (a choice sets a destination). */
export function createdLink(before: Workspace, after: Workspace) {
  const added = after.links.find(l => !before.links.some(x => x.id === l.id));
  return added ? 'transition:' + added.id : '';
}

const group = (a: Action) => (a.pair ? tr('페어') : tr('일반 동작'));

/** Whether a node's outputs are chosen from a list: starts, condition cards, transitions and QTE results. */
export function routable(node: Pick<FlatNode, 'id' | 'kind' | 'scope'>) {
  return ['startCard', 'conditionCard', 'transition', 'qte'].includes(node.kind);
}

/** The output pins of a node that lead to another node, each with the destinations a list offers. */
export function pinRows(w: Workspace, view: View, id: string): PinRow[] {
  const node = view.nodes.find(n => n.id === id);
  if (!node || !routable(node)) return [];
  const ref = parseNodeId(id),
    link = ref.kind === 'transition' ? w.links.find(l => l.id === ref.link) : undefined;
  const titles = new Map(view.nodes.map(n => [n.id, n.title]));
  const plays = view.nodes.filter(
    n => n.kind === 'hkxPlay' && n.action && n.step === w.actions.find(a => a.uid === n.action)?.config.entry
  );
  const actionTargets = (why?: (a: Action) => string | undefined): PinTarget[] =>
    plays.map(n => {
      const a = w.actions.find(a => a.uid === n.action)!;
      return {id: n.id, label: a.config.name || a.config.actionId, group: group(a), disabled: why?.(a)};
    });
  const cardTargets = (): PinTarget[] =>
    w.cards.map(c => ({
      id: 'conditionCard:' + c.uid,
      label: titles.get('conditionCard:' + c.uid) ?? tr('조건'),
      group: tr('조건 카드'),
      disabled:
        ref.kind === 'conditionCard' && (c.uid === ref.uid || makesLoop(w, ref.uid, c.uid))
          ? tr('이 카드로 이으면 순환합니다.')
          : undefined,
    }));
  const row = (pin: string, targets: PinTarget[], clearable: boolean): PinRow => {
    const current = view.edges.find(e => e.source === id && e.pin === pin)?.target ?? '';
    const known = targets.find(t => t.id === current);
    return {
      pin,
      label: portLabel(node, pin),
      current,
      currentLabel: known?.label ?? (current ? (titles.get(current) ?? current) : ''),
      targets,
      clearable,
    };
  };
  if (link)
    return node.outputs
      .filter(p => p === 'trigger' || p === 'partner')
      .map(p =>
        p === 'partner'
          ? row(
              p,
              actionTargets(a =>
                a.pair
                  ? tr('페어는 피해자 동작이 될 수 없습니다.')
                  : a.uid === link.to
                    ? tr('가해자 동작과 같습니다.')
                    : a.uid === link.from
                      ? tr('출발 동작입니다.')
                      : undefined
              ),
              true
            )
          : row(
              p,
              [
                ...actionTargets(a => (a.uid === link.from ? tr('출발 동작 자신입니다.') : undefined)),
                ...cardTargets(),
              ],
              true
            )
      );
  if (ref.kind === 'qte')
    return node.outputs.map(p =>
      row(
        p,
        [
          ...actionTargets(a =>
            p.endsWith(':partner') && a.pair ? tr('페어는 피해자 동작이 될 수 없습니다.') : undefined
          ),
          ...(p.endsWith(':partner') ? [] : cardTargets()),
        ],
        true
      )
    );
  return node.outputs.map(p => row(p, [...actionTargets(), ...cardTargets()], true));
}

/** Connect (or, with target '', clear) one output pin. */
export function connectPin(w: Workspace, _view: View, id: string, pin: string, target: string): Workspace {
  const ref = parseNodeId(id);
  if (!target) {
    if (ref.kind === 'qte') {
      const n = structuredClone(w),
        r = qtePinRule(qteMembers(n, id), pin);
      if (!r) throw Error(tr('QTE 결과를 찾지 못했습니다.'));
      const result = r.q.results[r.outcome];
      if (r.partner) result.partnerTo = '';
      else Object.assign(result, {mode: 'continue', to: '', partnerTo: '', card: undefined});
      return n;
    }
    return setDestination(w, id, pin, null);
  }
  return connectFlat(w, id, target, pin);
}

/** Where a start's, condition card's or transition's pin goes, by name ('' when nowhere). */
/** Where a card's route goes, by name. `short`: a condition card by its conditions alone (the canvas's route chips). */
export function routeDestination(w: Workspace, id: string, pin: string, short = false): string {
  const ref = parseNodeId(id);
  let to: Ref = null;
  if (ref.kind === 'startCard') to = w.starts.find(s => s.uid === ref.uid)?.to ?? null;
  else if (ref.kind === 'conditionCard') {
    const c = w.cards.find(c => c.uid === ref.uid);
    to = !c
      ? null
      : pin === 'true'
        ? (c.true ?? null)
        : pin === 'false'
          ? c.false
          : (c.rows.find(r => 'row:' + r.id === pin)?.to ?? null);
  } else if (ref.kind === 'transition') {
    const l = w.links.find(l => l.id === ref.link);
    to = !l
      ? null
      : pin === 'partner'
        ? l.partnerTo
          ? {action: l.partnerTo}
          : null
        : l.card
          ? {card: l.card}
          : l.to
            ? {action: l.to}
            : null;
  }
  const a = w.actions.find(a => a.uid === refAction(to));
  if (a) return a.config.name || a.config.actionId;
  const c = w.cards.find(c => c.uid === refCard(to));
  if (!c) return '';
  const name = (t: CardTest) => conditionNames[t.kind] ?? t.kind;
  return short ? cardNames(c, name) || cardTitle(c, name) : cardTitle(c, name);
}
