import type {Position} from './model.ts';
import type {BranchTest} from './graph/conditions.ts';
import type {Workspace} from './workspace.ts';
import {tr} from './i18n/korean.ts';
import {gameControlLabel, type GameControl} from './keys.ts';

// XML format 6 (runtime 0.12.291, docs/설계-형식6-에디터.md): a start goes to an HKX, or through a condition card.
// The document holds them as the XML does: starts, condition cards and HKX cards (actions), joined by destinations.

/** Where a start, a transition, a QTE result or a card's row, True or False goes: an HKX card (action uid), a
 *  condition card (card uid), or nowhere yet. */
export type Ref = {action: string} | {card: string} | null;
/** A condition of a card: a check, or an AND/OR group whose members are other conditions of the same card (by id). */
export type CardTest = Omit<BranchTest, 'pass' | 'fail'>;
/** A row: its conditions (roots among the card's tests) and where it goes when they all hold, or (`any`, runtime
 *  0.12.301 match="any") when one of them does. */
export type CardRow = {id: string; guards: string[]; to: Ref; any?: boolean};
/** A condition card (<Start>'s content, a root <Condition>, a <Row>'s <Condition>, a <True>/<False>'s content):
 *  common conditions, then rows or one True, then False. */
export type ConditionCard = {
  uid: string;
  /** The id a file gave it as a root <Condition> (kept, docs 2); a card the editor shares is named Choice1, … */
  xmlId?: string;
  tests: CardTest[];
  guards: string[];
  rows: CardRow[];
  /** Present: the card's only row, taken when its common conditions hold (no other row with it). */
  true?: Ref;
  /** Where it goes when a common condition fails or no row holds; null: nothing plays. */
  false: Ref;
  position: Position;
};
/** A start card (<Start>): its trigger, the cooldown and block that are this start's, and where it goes. */
export type StartCard = {
  uid: string;
  /** The id a file gave it (<Start id>): the name of the runtime's selecting action in the log. */
  xmlId?: string;
  mode: 'input' | 'event';
  key: string;
  gamepad: number;
  /** A game control instead of the key and button (runtime 0.12.292): every device's binding. */
  control?: GameControl;
  event: string;
  actor: 'both' | 'player' | 'npc';
  /** A pair's event start: the actor's combat target as the partner. A start whose card plays no pair (runtime
   *  0.12.299): 'nearest' is the actor ahead (range, angle), 'combatTarget' the sender's combat target. */
  target: 'nearest' | 'combatTarget';
  /** The actor-ahead cone of such a start (game units, degrees); absent: 200, 90. */
  range?: number;
  angle?: number;
  onKeyUp: boolean;
  cooldown: number;
  block?: {events: string[]; when: 'startable' | 'active' | 'both'};
  to: Ref;
  position: Position;
};

export const refAction = (r: Ref) => (r && 'action' in r ? r.action : '');
export const refCard = (r: Ref) => (r && 'card' in r ? r.card : '');
/** Whether `r` may play a pair (the runtime's playsPair): a pair, or a card reaching one. */
export function playsPair(w: Workspace, r: Ref | undefined, seen = new Set<string>()): boolean {
  if (!r) return false;
  if (w.actions.find(a => a.uid === refAction(r))?.pair) return true;
  const c = w.cards.find(c => c.uid === refCard(r));
  if (!c || seen.has(c.uid)) return false;
  seen.add(c.uid);
  return [...c.rows.map(x => x.to), c.true ?? null, c.false].some(x => playsPair(w, x, seen));
}
/** A start choosing among ordinary actions (runtime 0.12.299): it goes to a card that plays no pair. Its conditions
 *  read the actor ahead or the combat target (StartCard target, range, angle). */
export const choosesOrdinary = (w: Workspace, s: Pick<StartCard, 'to'>) => !!refCard(s.to) && !playsPair(w, s.to);
/** The actor-ahead cone's defaults. */
export const frontRange = 200,
  frontAngle = 90;

/** Every place a destination is held, with a setter: starts, transitions, QTE results, and each card's rows, True
 *  and False. `card` is the card holding it, for the card's own places. */
export type Place = {
  kind: 'start' | 'link' | 'qte' | 'row' | 'true' | 'false';
  /** The start, link or QTE's id, or the card's uid. */
  owner: string;
  /** The row's id, the QTE result's outcome. */
  part?: string;
  ref: Ref;
};
export function places(w: Workspace): Place[] {
  const out: Place[] = [];
  for (const s of w.starts ?? []) out.push({kind: 'start', owner: s.uid, ref: s.to});
  for (const l of w.links)
    out.push({kind: 'link', owner: l.id, ref: l.card ? {card: l.card} : l.to ? {action: l.to} : null});
  for (const q of w.qtes ?? [])
    for (const [k, r] of Object.entries(q.results))
      if (r.mode === 'transition')
        out.push({kind: 'qte', owner: q.id, part: k, ref: r.card ? {card: r.card} : r.to ? {action: r.to} : null});
  for (const c of w.cards ?? []) {
    for (const r of c.rows) out.push({kind: 'row', owner: c.uid, part: r.id, ref: r.to});
    if (c.true !== undefined) out.push({kind: 'true', owner: c.uid, ref: c.true});
    out.push({kind: 'false', owner: c.uid, ref: c.false});
  }
  return out;
}
/** How many places the file writes go to each card: a start that goes somewhere, a transition, a written QTE's
 *  result, and the cards those reach (a card nothing written reaches is not written, nor what it goes to). */
export function cardUses(w: Workspace): Map<string, number> {
  const actions = new Set(w.actions.map(a => a.uid)),
    written = (w.qtes ?? []).filter(q => q.eventStart !== undefined || actions.has(q.owner)).map(q => q.id);
  const all = places(w),
    owners = all.filter(
      p =>
        (p.kind === 'start' && p.ref) ||
        (p.kind === 'link' && actions.has(w.links.find(l => l.id === p.owner)?.from ?? '')) ||
        (p.kind === 'qte' && written.includes(p.owner))
    );
  const live = new Set<string>(),
    queue = owners.map(p => refCard(p.ref)).filter(Boolean);
  while (queue.length) {
    const c = queue.pop()!;
    if (live.has(c)) continue;
    live.add(c);
    const card = w.cards.find(x => x.uid === c);
    if (card) queue.push(...cardTargets(card));
  }
  const uses = new Map<string, number>();
  for (const p of [...owners, ...all.filter(p => ['row', 'true', 'false'].includes(p.kind) && live.has(p.owner))]) {
    const c = refCard(p.ref);
    if (c) uses.set(c, (uses.get(c) ?? 0) + 1);
  }
  return uses;
}
/** The cards a card goes to (rows, True, False). */
export const cardTargets = (c: ConditionCard): string[] =>
  [...c.rows.map(r => r.to), ...(c.true !== undefined ? [c.true] : []), c.false].map(refCard).filter(Boolean);
/** A card that reaches itself through the cards it goes to (the runtime refuses a loop): the loop's uids, or none. */
/** Whether `r` plays `action`: directly, or through condition cards. */
export function reaches(w: Workspace, r: Ref, action: string, seen = new Set<string>()): boolean {
  if (refAction(r) === action) return true;
  const c = w.cards.find(c => c.uid === refCard(r));
  if (!c || seen.has(c.uid)) return false;
  seen.add(c.uid);
  return [...c.rows.map(x => x.to), c.true ?? null, c.false].some(x => reaches(w, x, action, seen));
}
export function cardLoop(w: Workspace): string[] | undefined {
  const byUid = new Map((w.cards ?? []).map(c => [c.uid, c]));
  const state = new Map<string, 1 | 2>(),
    path: string[] = [];
  const visit = (uid: string): string[] | undefined => {
    if (state.get(uid) === 2) return;
    if (state.get(uid) === 1) return path.slice(path.indexOf(uid)).concat(uid);
    state.set(uid, 1);
    path.push(uid);
    for (const next of cardTargets(byUid.get(uid)!).filter(u => byUid.has(u))) {
      const loop = visit(next);
      if (loop) return loop;
    }
    path.pop();
    state.set(uid, 2);
  };
  for (const c of w.cards ?? []) {
    const loop = visit(c.uid);
    if (loop) return loop;
  }
}
/** Would `from` going to card `to` make a loop? */
export function makesLoop(w: Workspace, from: string, to: string): boolean {
  const byUid = new Map((w.cards ?? []).map(c => [c.uid, c]));
  const seen = new Set<string>(),
    queue = [to];
  while (queue.length) {
    const u = queue.pop()!;
    if (u === from) return true;
    if (seen.has(u)) continue;
    seen.add(u);
    const c = byUid.get(u);
    if (c) queue.push(...cardTargets(c));
  }
  return false;
}
export const isGroup = (t: Pick<CardTest, 'kind'>) => t.kind === 'all' || t.kind === 'any';
/** The group rule (runtime 0.12.301, docs/mockup-condition-groups ⑥): a group sits among a card's common conditions
 *  or a row's, one level deep, of the operator opposite to what holds it (OR among AND conditions, AND in an OR row),
 *  with two or more checks. */
export function groupRuleError(c: Pick<ConditionCard, 'tests' | 'guards' | 'rows'>): string | undefined {
  const lists: [string[], boolean][] = [
    [c.guards, false],
    ...c.rows.map(r => [r.guards, !!r.any] as [string[], boolean]),
  ];
  for (const [roots, any] of lists)
    for (const id of roots) {
      const t = c.tests.find(t => t.id === id);
      if (!t || !isGroup(t)) continue;
      if ((t.kind === 'any') === any)
        return tr('묶음은 감싼 쪽의 반대 연산자로만 씁니다(AND 조건 사이에는 OR 묶음, OR 행에는 AND 묶음).');
      const members = (t.operands ?? []).map(m => c.tests.find(x => x.id === m));
      if (members.some(m => !m || isGroup(m))) return tr('묶음 안에는 묶음을 넣지 않습니다(한 단계까지).');
      if (members.length < 2) return tr('묶음에는 조건이 둘 이상 필요합니다.');
    }
}
/** The ids a list of roots holds, with their members. */
export function descendants(c: Pick<ConditionCard, 'tests'>, roots: string[], out = new Set<string>()) {
  for (const id of roots) {
    if (out.has(id)) continue;
    out.add(id);
    descendants(c, c.tests.find(t => t.id === id)?.operands ?? [], out);
  }
  return out;
}
/** A fresh condition id in a card. */
export function testId(c: Pick<ConditionCard, 'tests'>) {
  let i = 1;
  while (c.tests.some(t => t.id === 'Condition' + i)) i++;
  return 'Condition' + i;
}
/** Conditions no root reaches are dropped (after a row or a common condition is removed). */
export function pruneTests(c: ConditionCard) {
  const used = descendants(c, [...c.guards, ...c.rows.flatMap(r => r.guards)]);
  c.tests = c.tests.filter(t => used.has(t.id));
}
const uidOf = (prefix: string, taken: Iterable<string>) => {
  const set = new Set(taken);
  let i = 1;
  while (set.has(prefix + i)) i++;
  return prefix + i;
};
export const newCardUid = (w: Workspace) =>
  uidOf(
    'card',
    (w.cards ?? []).map(c => c.uid)
  );
export const newStartUid = (w: Workspace) =>
  uidOf(
    'start',
    (w.starts ?? []).map(s => s.uid)
  );
export const newRowId = (c: ConditionCard) =>
  uidOf(
    'row',
    c.rows.map(r => r.id)
  );
export function newCard(w: Workspace, position: Position): ConditionCard {
  return {uid: newCardUid(w), tests: [], guards: [], rows: [], false: null, position};
}
export function newStart(w: Workspace, position: Position, mode: StartCard['mode'] = 'input'): StartCard {
  return {
    uid: newStartUid(w),
    mode,
    key: mode === 'input' ? 'Num0' : '',
    gamepad: 0,
    event: '',
    actor: 'both',
    target: 'nearest',
    onKeyUp: false,
    cooldown: 0,
    to: null,
    position,
  };
}
/** A condition card's title: 「조건」 with several conditions, 「조건 (이름)」 with one (docs decision 6). */
export function cardTitle(c: ConditionCard, name: (t: CardTest) => string): string {
  const roots = [...c.guards, ...c.rows.flatMap(r => r.guards)];
  if (roots.length === 1) {
    const t = c.tests.find(t => t.id === roots[0]);
    if (t) return tr('조건 ({name})', {name: t.label || name(t)});
  }
  return tr('조건');
}
/** A start's trigger in words. */
export function startText(s: StartCard): string {
  return s.mode === 'event'
    ? s.event || tr('이벤트 미지정')
    : s.control
      ? gameControlLabel(s.control)
      : [s.key, s.gamepad ? tr('패드') : ''].filter(Boolean).join(' · ') || tr('키 미지정');
}
