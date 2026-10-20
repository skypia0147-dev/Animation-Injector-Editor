// Connecting an output pin by choosing its destination from a list (the card's ▾ and the Details "연결"
// section), as well as by dragging. A choice runs the same connection as a drag (connectFlat), except that a
// condition's route is replaced outright: a drag onto another HKX shares the condition instead (F2).
import type {Workspace, Action} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {connectFlat, flatGraph} from './flat.ts';
import {parseNodeId} from './nodeRef.ts';
import {setBranchTarget} from './conditionCommands.ts';
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
export function portLabel(node: Pick<FlatNode, 'kind' | 'outputs' | 'eventQte'>, pin: string) {
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
  if (pin.startsWith('choice:')) return pin.split(':')[1] + ' · ' + (pin.endsWith(':pass') ? tr('통과') : tr('기본'));
  if (pin === 'pass') return tr('통과');
  if (pin === 'fail') return tr('실패');
  return pin === 'trigger' ? tr('도착') : pin;
}

/** The output pins a card draws as route rows, each with its list: the pins pinRows lists. */
export function routePins(node: Pick<FlatNode, 'id' | 'kind' | 'scope' | 'outputs'>): string[] {
  if (!routable(node)) return [];
  const ref = parseNodeId(node.id);
  if (node.scope?.kind === 'link') return node.outputs.filter(p => p === 'trigger' || p === 'partner');
  if (ref.kind === 'branch') return node.outputs.filter(p => p === 'pass' || p === 'fail');
  if (ref.kind === 'qte') return node.outputs;
  return node.outputs.filter(p => p === 'trigger');
}
export type RouteTone = 'pass' | 'fail' | 'perfect' | 'starter' | 'partner' | 'plain';
/** A QTE's choice pin read as qteGroups.ts qtePinRule does: its outcome and whether it is the victim's. */
export function qteChoice(pin: string) {
  const parts = pin.split(':'),
    grouped = ['success', 'failure', 'perfect'].includes(parts[2]);
  return {outcome: grouped ? parts[2] : parts[1], partner: pin.endsWith(':partner')};
}
/** A route's colour (its row's label, pin and line): a condition's pass and fail, a QTE's outcome, a pair's two
 *  roles; one destination alone stays plain. */
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
  if (parseNodeId(node.id).kind === 'branch') return pin === 'pass' ? 'pass' : pin === 'fail' ? 'fail' : 'plain';
  if (node.outputs.includes('partner')) return pin === 'partner' ? 'partner' : pin === 'trigger' ? 'starter' : 'plain';
  return 'plain';
}
/** What an unconnected route row says happens: a QTE result continues, a pair's victim is optional. */
export function routeEmpty(node: Pick<FlatNode, 'id' | 'kind'>, pin: string): string {
  if (node.kind === 'qte') return tr('계속');
  if (pin === 'partner') return tr('없음');
  return tr('고르기');
}

/** The transition node a choice created (a new node becomes its transition): it stays selected, so its
 *  victim and window are set next. */
export function createdLink(before: Workspace, after: Workspace) {
  const added = after.links.find(l => !before.links.some(x => x.id === l.id));
  return added ? `link:${added.id}|${added.mode === 'event' ? 'markerReceive' : 'keyInput'}` : '';
}

const group = (a: Action) => (a.pair ? tr('페어') : tr('일반 동작'));

/** Whether a node's outputs are chosen from a list: transitions, new nodes, conditions and QTE results. */
export function routable(node: Pick<FlatNode, 'id' | 'kind' | 'scope'>) {
  const ref = parseNodeId(node.id);
  return (
    (node.scope?.kind === 'link' && ['keyInput', 'markerReceive'].includes(node.kind)) ||
    ref.kind === 'draft' ||
    ref.kind === 'branch' ||
    ref.kind === 'qte'
  );
}

/** The output pins of a node that lead to another node, each with the destinations a list offers. */
export function pinRows(w: Workspace, view: View, id: string): PinRow[] {
  const node = view.nodes.find(n => n.id === id);
  if (!node || !routable(node)) return [];
  const ref = parseNodeId(id),
    link = node.scope?.kind === 'link' ? w.links.find(l => l.id === (node.scope as {link: string}).link) : undefined,
    actions = new Map(w.actions.map(a => [a.uid, a]));
  const titles = new Map(view.nodes.map(n => [n.id, n.title]));
  // An action's HKX card (its entry clip) stands for the action. A selecting action draws none
  // (graph/sharing.ts), yet a route may come back to it: its card from the full graph is listed too.
  const entryPlay = (n: FlatNode) => n.kind === 'hkxPlay' && n.action && n.step === actions.get(n.action)?.config.entry;
  const shown = view.nodes.filter(entryPlay),
    drawn = new Set(shown.map(n => n.action));
  const plays = [...shown, ...flatGraph(w).nodes.filter(n => entryPlay(n) && !drawn.has(n.action))];
  const actionTargets = (why?: (a: Action) => string | undefined): PinTarget[] =>
    plays.map(n => {
      const a = actions.get(n.action!)!;
      return {id: n.id, label: a.config.name || a.config.actionId, group: group(a), disabled: why?.(a)};
    });
  const conditions: PinTarget[] =
    ref.kind === 'branch'
      ? view.nodes
          .filter(n => n.id !== id && n.kind === 'conditionBranch')
          .flatMap(n => {
            const r = parseNodeId(n.id);
            return r.kind === 'branch' && r.owner === ref.owner ? [{id: n.id, label: r.test, group: tr('조건')}] : [];
          })
      : [];
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
              actionTargets(a => (a.uid === link.from ? tr('출발 동작 자신입니다.') : undefined)),
              false
            )
      );
  if (ref.kind === 'branch') {
    // The rules setBranchTarget applies, shown before the choice.
    const owner = actions.get(ref.owner);
    const why = (a: Action) =>
      a.pair && !owner?.pair
        ? tr('페어는 페어의 조건에서만 고를 수 있습니다.')
        : a.flow && a.uid !== ref.owner
          ? tr('자기 조건이 있는 동작입니다. 그 조건으로 연결하세요.')
          : undefined;
    return (['pass', 'fail'] as const)
      .filter(p => node.outputs.includes(p))
      .map(p => row(p, [...actionTargets(why), ...conditions], true));
  }
  if (ref.kind === 'qte')
    return node.outputs.map(p =>
      row(
        p,
        actionTargets(a => (p.endsWith(':partner') && a.pair ? tr('페어는 피해자 동작이 될 수 없습니다.') : undefined)),
        false
      )
    );
  // A new node (draft): its output goes to the HKX it starts, attaches to or transitions to.
  return node.outputs.filter(p => p === 'trigger').map(p => row(p, actionTargets(), false));
}

/** "공유 →" on a condition: the actions that can start through the same condition (shareCondition). */
export function shareRow(w: Workspace, view: View, id: string): PinRow | undefined {
  const ref = parseNodeId(id);
  if (ref.kind !== 'branch') return;
  const actions = new Map(w.actions.map(a => [a.uid, a]));
  const targets = view.nodes
    .filter(n => n.kind === 'hkxPlay' && n.action && n.step === actions.get(n.action)?.config.entry)
    .flatMap(n => {
      const a = actions.get(n.action!)!;
      if (a.uid === ref.owner) return [];
      return [
        {
          id: n.id,
          label: a.config.name || a.config.actionId,
          group: group(a),
          disabled: a.flow ? tr('이미 조건이 있는 동작입니다.') : undefined,
        },
      ];
    });
  return {pin: 'share', label: tr('공유'), current: '', currentLabel: '', targets, clearable: false};
}

/** Connect (or, with target '', clear) one output pin. */
export function connectPin(w: Workspace, view: View, id: string, pin: string, target: string): Workspace {
  const ref = parseNodeId(id);
  if (ref.kind === 'branch' && (pin === 'pass' || pin === 'fail')) {
    if (!target) return setBranchTarget(w, ref.owner, ref.test, pin);
    const to = parseNodeId(target);
    if (to.kind === 'branch') {
      if (to.owner !== ref.owner) throw Error(tr('같은 진입 경로의 조건을 고르세요.'));
      return setBranchTarget(w, ref.owner, ref.test, pin, {node: to.test});
    }
    // A selecting action's card is not drawn (graph/sharing.ts) but its lists offer it: the full graph has it.
    const n = view.nodes.find(n => n.id === target) ?? flatGraph(w).nodes.find(n => n.id === target);
    if (n?.kind !== 'hkxPlay' || !n.action) throw Error(tr('조건 또는 HKX 재생을 고르세요.'));
    return setBranchTarget(w, ref.owner, ref.test, pin, {action: n.action});
  }
  if (!target) {
    const node = view.nodes.find(n => n.id === id);
    const link = node?.scope?.kind === 'link' ? (node.scope as {link: string}).link : '';
    if (!link || pin !== 'partner') throw Error(tr('이 핀은 비워 둘 수 없습니다.'));
    const next = structuredClone(w);
    next.links.find(l => l.id === link)!.partnerTo = '';
    return next;
  }
  return connectFlat(w, id, target, pin);
}
