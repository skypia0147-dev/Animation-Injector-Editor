import type {Workspace} from './workspace.ts';
import {node, type Xml} from './xml.ts';
import {byKeywordName, extensionAttrs, formKinds} from './graph/conditionExtensions.ts';
import {
  cardUses,
  isGroup,
  choosesOrdinary,
  frontAngle,
  frontRange,
  refAction,
  refCard,
  type CardTest,
  type ConditionCard,
  type Ref,
  type StartCard,
} from './cards.ts';
import {gamepadXml} from './keys.ts';
import {uniqueEvents} from './runtimeExtensions.ts';
import {tr} from './i18n/korean.ts';

// XML format 6 (runtime 0.12.291): the document's starts, condition cards and HKX cards as the XML holds them
// (docs/설계-형식6-에디터.md 2). A card more than one place goes to (or one a file named) is a root <Condition id>;
// any other is written where it is used.

const actionId = (w: Workspace, uid: string) => w.actions.find(a => a.uid === uid)?.config.actionId ?? '';

/** One condition: <Check kind …> or <And>/<Or> with its members; disabled members are not written (authoring data). */
export function checkXml(w: Workspace, c: Pick<ConditionCard, 'tests'>, id: string): Xml {
  const t = c.tests.find(t => t.id === id);
  if (!t) throw Error(tr('구성 조건을 찾지 못했습니다.'));
  let out: Xml;
  if (isGroup(t))
    out = node(
      t.kind === 'all' ? 'And' : 'Or',
      {},
      (t.operands ?? []).filter(m => c.tests.find(x => x.id === m)?.enabled !== false).map(m => checkXml(w, c, m))
    );
  else {
    out = node('Check', {kind: t.kind});
    if (t.subject !== 'self') out.attrs.subject = t.subject;
    Object.assign(out.attrs, extensionAttrs(t as CardTest & {pass?: undefined}));
    if (t.kind === 'equippedType') Object.assign(out.attrs, {hand: t.hand, type: t.equipmentType});
    if (t.kind === 'attackState') out.attrs.state = t.attackState!;
    if (byKeywordName(t)) out.attrs.keyword = t.keyword!;
    else if (formKinds.includes(t.kind) && t.form) Object.assign(out.attrs, {plugin: t.form.plugin, form: t.form.id});
    if (t.kind === 'global') out.attrs.equals = String(t.equals);
    // The last action the subject finished (runtime 0.12.296): the actions by their XML ids.
    if (t.kind === 'previousAction') {
      out.attrs.actions = (t.actions ?? []).map(uid => actionId(w, uid)).join(',');
      if (t.within !== undefined) out.attrs.within = String(t.within);
      if (t.ended && t.ended !== 'any') out.attrs.ended = t.ended;
    }
    // The last weapon hit the subject received: how long ago it may be.
    if (t.kind === 'hitReceived' && t.within !== undefined) out.attrs.within = String(t.within);
    // Measured where the actor stands, for no particular action (runtime 0.12.299): no candidate.
    if ((t.kind === 'space' || t.kind === 'ground') && t.space)
      Object.assign(out.attrs, {distance: String(t.space.distance), direction: t.space.direction});
    if (t.kind === 'ground')
      for (const [k, v] of Object.entries(t.ground ?? {maxRise: 20, maxDrop: 40, maxSlope: 45, radius: 20}))
        out.attrs[k] = String(v);
  }
  if (t.negate) out.attrs.not = 'true';
  return out;
}
const live = (c: ConditionCard, roots: string[]) =>
  roots.filter(id => c.tests.find(t => t.id === id)?.enabled !== false);

/** How the cards are written: which are root <Condition>s, under which id. */
export function cardNames(w: Workspace): Map<string, string> {
  const uses = cardUses(w),
    names = new Map<string, string>(),
    taken = new Set((w.cards ?? []).flatMap(c => (c.xmlId ? [c.xmlId.toLowerCase()] : [])));
  for (const c of w.cards ?? []) {
    const n = uses.get(c.uid) ?? 0;
    if (n >= 2 || (c.xmlId && n >= 1)) {
      let id = c.xmlId;
      if (!id) {
        let i = 1;
        while (taken.has(('Choice' + i).toLowerCase())) i++;
        id = 'Choice' + i;
        taken.add(id.toLowerCase());
      }
      names.set(c.uid, id);
    }
  }
  return names;
}

type Writer = {w: Workspace; names: Map<string, string>; cards: Map<string, ConditionCard>};
/** A card's content: common conditions, rows or True, False. */
function content(x: Writer, c: ConditionCard): Xml[] {
  const out: Xml[] = [];
  for (const g of live(c, c.guards)) out.push(checkXml(x.w, c, g));
  if (c.true !== undefined) out.push(destination(x, node('True'), c.true));
  for (const r of c.rows) {
    const row = node('Row');
    const to = refAction(r.to);
    if (to) row.attrs.to = actionId(x.w, to);
    const inner = refCard(r.to);
    if (inner && x.names.has(inner)) row.attrs.condition = x.names.get(inner)!;
    if (r.any) row.attrs.match = 'any';
    row.children = live(c, r.guards).map(g => checkXml(x.w, c, g));
    if ((inner && !x.names.has(inner)) || !r.to)
      row.children.push(node('Condition', {}, inner ? content(x, x.cards.get(inner)!) : []));
    out.push(row);
  }
  if (c.false) out.push(destination(x, node('False'), c.false));
  return out;
}
/** A destination on an element (True, False, a start, a transition, a QTE result): to, condition or the card as its
 *  content. */
function destination(x: Writer, e: Xml, r: Ref): Xml {
  const a = refAction(r),
    c = refCard(r);
  if (a) e.attrs.to = actionId(x.w, a);
  else if (c && x.names.has(c)) e.attrs.condition = x.names.get(c)!;
  else if (c) e.children.push(...content(x, x.cards.get(c)!));
  return e;
}
/** An owner's destination (1.4): a card of common conditions whose True is an HKX is to="X" with those conditions. */
function owner(x: Writer, e: Xml, r: Ref): Xml {
  const c = refCard(r);
  const card = c && !x.names.has(c) ? x.cards.get(c) : undefined;
  if (card && card.true !== undefined && refAction(card.true) && !card.rows.length && !card.false) {
    const to = refAction(card.true);
    e.attrs = {to: actionId(x.w, to), ...e.attrs};
    e.children.push(...live(card, card.guards).map(g => checkXml(x.w, card, g)));
    return e;
  }
  const a = refAction(r);
  if (a) e.attrs = {to: actionId(x.w, a), ...e.attrs};
  else if (c && x.names.has(c)) e.attrs = {condition: x.names.get(c)!, ...e.attrs};
  else if (card) e.children.push(...content(x, card));
  return e;
}
export function startXml(x: Writer, s: StartCard): Xml {
  const e = node('Start', {
    id: s.xmlId,
    ...(s.mode === 'event'
      ? {event: s.event, actor: s.actor === 'both' ? undefined : s.actor}
      : s.control
        ? {control: s.control}
        : {key: s.key || undefined, gamepad: s.gamepad ? gamepadXml(s.gamepad) : undefined}),
    target: s.target === 'combatTarget' ? s.target : undefined,
    // The actor-ahead cone of a start choosing among ordinary actions (runtime 0.12.299), when not the default.
    ...(s.target !== 'combatTarget' && choosesOrdinary(x.w, s)
      ? {
          range: s.range !== undefined && s.range !== frontRange ? String(s.range) : undefined,
          angle: s.angle !== undefined && s.angle !== frontAngle ? String(s.angle) : undefined,
        }
      : {}),
    onKeyUp: s.onKeyUp ? 'true' : undefined,
    cooldown: s.cooldown ? s.cooldown : undefined,
    block: s.block ? uniqueEvents(s.block.events).join(',') : undefined,
    blockWhen: s.block && s.block.when !== 'startable' ? s.block.when : undefined,
  });
  const out = owner(x, e, s.to);
  // id first, as the runtime's examples write it.
  if (s.xmlId) out.attrs = {id: s.xmlId, ...out.attrs};
  return out;
}
export const writerOf = (w: Workspace): Writer => ({
  w,
  names: cardNames(w),
  cards: new Map((w.cards ?? []).map(c => [c.uid, c])),
});
/** A transition's (or a QTE result's) destination. */
export function linkDestination(x: Writer, e: Xml, to: string, card: string | undefined) {
  return owner(x, e, card ? {card} : to ? {action: to} : null);
}
/** The root <Condition>s, by their names. */
export function sharedXml(x: Writer, uid: string): Xml {
  return node('Condition', {id: x.names.get(uid)!}, content(x, x.cards.get(uid)!));
}
/** Root elements in the document's order (w.order: starts, HKX cards and named cards as a file had them); what is
 *  not in it goes after what is, named cards first. */
export function rootOrder(w: Workspace, x: Writer): {kind: 'start' | 'action' | 'card'; uid: string}[] {
  const all = [
    ...(w.cards ?? []).filter(c => x.names.has(c.uid)).map(c => ({kind: 'card' as const, uid: c.uid})),
    ...(w.starts ?? []).map(s => ({kind: 'start' as const, uid: s.uid})),
    ...w.actions.map(a => ({kind: 'action' as const, uid: a.uid})),
  ];
  const byUid = new Map(all.map(e => [e.uid, e]));
  const out: typeof all = [],
    seen = new Set<string>();
  const missing = all.filter(e => !(w.order ?? []).includes(e.uid));
  // An unplaced named card goes first; an unplaced start goes right before the HKX it goes to, else at the end.
  for (const e of missing.filter(e => e.kind === 'card')) (out.push(e), seen.add(e.uid));
  const before = new Map<string, typeof all>();
  const tail: typeof all = [];
  for (const e of missing.filter(e => e.kind === 'start')) {
    const s = w.starts!.find(s => s.uid === e.uid)!;
    const to = refAction(s.to) || firstAction(w, s.to);
    if (to) (before.get(to) ?? before.set(to, []).get(to)!).push(e);
    else tail.push(e);
  }
  const place = (e: (typeof all)[number]) => {
    if (seen.has(e.uid)) return;
    if (e.kind === 'action') for (const s of before.get(e.uid) ?? []) (out.push(s), seen.add(s.uid));
    out.push(e);
    seen.add(e.uid);
  };
  for (const uid of w.order ?? []) {
    const e = byUid.get(uid);
    if (e) place(e);
  }
  for (const e of all) if (e.kind === 'action') place(e);
  for (const e of [...tail, ...missing]) place(e);
  return out;
}
/** The first HKX a destination reaches through cards (for placing a new start). */
function firstAction(w: Workspace, r: Ref, seen = new Set<string>()): string {
  const a = refAction(r);
  if (a) return a;
  const c = w.cards?.find(c => c.uid === refCard(r));
  if (!c || seen.has(c.uid)) return '';
  seen.add(c.uid);
  for (const next of [...c.rows.map(r => r.to), c.true ?? null, c.false]) {
    const found = firstAction(w, next, seen);
    if (found) return found;
  }
  return '';
}
export type {Writer};
