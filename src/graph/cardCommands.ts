import type {Workspace} from '../workspace.ts';
import {
  cardLoop,
  descendants,
  isGroup,
  newRowId,
  pruneTests,
  testId,
  type CardTest,
  type ConditionCard,
  type Ref,
} from '../cards.ts';
import {readExpression, insertExpression} from './conditionExpression.ts';
import {tr} from '../i18n/korean.ts';

// A condition card's own edits (docs/설계-형식6-에디터.md 3): its rows, True, False and the conditions on each.
// Every function returns a new document.

/** Where a condition sits on its card: the common conditions or a row's. */
export type CardPlace = 'guards' | `row:${string}`;

/** A short line under a card's title: what it holds. */
export function cardSummary(c: ConditionCard): string {
  const parts = [
    c.guards.length ? tr('공통 {n}', {n: c.guards.length}) : '',
    c.rows.length ? tr('행 {n}', {n: c.rows.length}) : '',
    c.true !== undefined ? 'True' : '',
  ].filter(Boolean);
  return parts.join(' · ') || tr('빈 카드');
}
function edit(w: Workspace, uid: string, fn: (c: ConditionCard) => void): Workspace {
  const n = structuredClone(w),
    c = n.cards.find(c => c.uid === uid);
  if (!c) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  fn(c);
  tidyCard(c);
  return n;
}
/** The group rule kept after every edit (runtime 0.12.301, cards.ts groupRuleError): a group of one condition is that
 *  condition, an empty one goes, one of the operator holding it gives its members to it, a row holding only one
 *  group takes that group's operator, one condition makes no OR, and a row left without conditions goes. */
export function tidyCard(c: ConditionCard) {
  const find = (id: string) => c.tests.find(t => t.id === id);
  const tidy = (roots: string[], any: boolean) => {
    for (let i = 0; i < roots.length; i++) {
      const g = find(roots[i]);
      if (!g || !isGroup(g)) continue;
      const members = (g.operands ?? []).filter(m => find(m));
      if (members.length < 2) {
        const m = members[0] ? find(members[0])! : undefined;
        if (m && g.negate) m.negate = !m.negate || undefined;
        if (m && !m.negate) delete m.negate;
        roots.splice(i, 1, ...(m ? [m.id] : []));
        i--;
      } else if ((g.kind === 'any') === any && !g.negate) {
        roots.splice(i, 1, ...members);
        i--;
      }
    }
  };
  tidy(c.guards, false);
  for (const r of c.rows) {
    tidy(r.guards, !!r.any);
    const only = r.guards.length === 1 ? find(r.guards[0]) : undefined;
    if (only && isGroup(only) && !only.negate) {
      r.any = only.kind === 'any';
      r.guards = [...(only.operands ?? [])];
      tidy(r.guards, r.any);
    }
    if (r.guards.length < 2 || !r.any) delete r.any;
  }
  const gone = c.rows.filter(r => !r.guards.length);
  c.rows = c.rows.filter(r => r.guards.length);
  // No rows left: the card is its common conditions and True (docs 10-27: True comes and goes by itself), where the
  // last row went.
  if (!c.rows.length && c.true === undefined) c.true = gone.find(r => r.to)?.to ?? null;
  pruneTests(c);
}
/** A card showing True takes rows again (a row arrives): True goes and its destination is the new row's. */
function trueToRow(c: ConditionCard): Ref {
  if (c.true === undefined) return null;
  const to = c.true;
  delete c.true;
  return to;
}
/** A row's conditions all (AND) or one of them (OR); its groups turn to the other operator with it. */
export function setRowJoin(w: Workspace, uid: string, row: string, any: boolean): Workspace {
  return edit(w, uid, c => {
    const r = c.rows.find(r => r.id === row);
    if (!r) throw Error(tr('행을 찾지 못했습니다.'));
    r.any = any;
    for (const id of r.guards) {
      const g = c.tests.find(t => t.id === id);
      if (g && isGroup(g)) g.kind = any ? 'all' : 'any';
    }
  });
}
/** A group's operator; the one holding it (a row's or AND) gives it its members back (a negated group stays). */
export function setGroupJoin(w: Workspace, uid: string, list: CardPlace, group: string, kind: 'all' | 'any') {
  return edit(w, uid, c => {
    const g = c.tests.find(t => t.id === group);
    if (!g || !isGroup(g)) throw Error(tr('묶음을 찾지 못했습니다.'));
    const holder = list === 'guards' ? 'all' : c.rows.find(r => 'row:' + r.id === list)?.any ? 'any' : 'all';
    if (kind === holder && g.negate) throw Error(tr('NOT인 묶음은 풀 수 없습니다. NOT을 먼저 끄세요.'));
    g.kind = kind;
  });
}
/** A condition let go on another (docs/mockup-condition-groups ⑥): the two become a group in the target's place, of
 *  the operator opposite to its list's. From another card it is copied over first; `copy` keeps it where it was. */
export function mergeCondition(
  w: Workspace,
  fromCard: string,
  from: CondList,
  id: string,
  toCard: string,
  list: CardPlace,
  target: string,
  copy: boolean
): Workspace {
  if (fromCard === toCard && id === target) return w;
  const n = structuredClone(w),
    source = n.cards.find(c => c.uid === fromCard),
    card = n.cards.find(c => c.uid === toCard);
  if (!source || !card) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  const dragged = source.tests.find(t => t.id === id);
  if (!dragged) throw Error(tr('조건을 찾지 못했습니다.'));
  if (isGroup(dragged)) throw Error(tr('묶음 안에는 묶음을 넣지 않습니다(한 단계까지).'));
  const roots = listOf(source, from);
  let member = id;
  if (fromCard === toCard && !copy) roots.splice(roots.indexOf(id), 1);
  else member = insertExpression(card, readExpression(source, id));
  const holder = listOf(card, list),
    at = holder.indexOf(target);
  if (at < 0 || isGroup(card.tests.find(t => t.id === target)!)) throw Error(tr('조건을 찾지 못했습니다.'));
  const any = list !== 'guards' && !!card.rows.find(r => 'row:' + r.id === list)?.any,
    group: CardTest = {
      id: testId(card),
      kind: any ? 'all' : 'any',
      subject: 'self',
      minimum: 0,
      operands: [target, member],
    };
  card.tests.push(group);
  holder.splice(at, 1, group.id);
  if (fromCard !== toCard && !copy) {
    roots.splice(roots.indexOf(id), 1);
    tidyCard(source);
  }
  tidyCard(card);
  return n;
}
const rootsOf = (c: ConditionCard, place: CardPlace) => {
  if (place === 'guards') return c.guards;
  const r = c.rows.find(r => r.id === place.slice(4));
  if (!r) throw Error(tr('행을 찾지 못했습니다.'));
  return r.guards;
};
const newTest = (c: ConditionCard, kind: CardTest['kind'] = 'air'): CardTest => ({
  id: testId(c),
  kind,
  subject: 'self',
  minimum: 0,
});
/** A new row (with one condition to set: a row needs one), at the end or at `index`. On a True card it takes True's
 *  place and destination. */
export function addRow(w: Workspace, uid: string, index?: number) {
  let id = '';
  const next = edit(w, uid, c => {
    const to = trueToRow(c);
    const t = newTest(c);
    c.tests.push(t);
    id = newRowId(c);
    const row = {id, guards: [t.id], to};
    c.rows.splice(index ?? c.rows.length, 0, row);
  });
  return {workspace: next, id};
}
export function removeRow(w: Workspace, uid: string, row: string): Workspace {
  return edit(w, uid, c => {
    c.rows = c.rows.filter(r => r.id !== row);
    pruneTests(c);
  });
}
/** Move a row to `index` (its place is the order rows are tried in). */
export function moveRow(w: Workspace, uid: string, row: string, index: number): Workspace {
  return edit(w, uid, c => {
    const at = c.rows.findIndex(r => r.id === row);
    if (at < 0) throw Error(tr('행을 찾지 못했습니다.'));
    const [r] = c.rows.splice(at, 1);
    c.rows.splice(Math.max(0, Math.min(index, c.rows.length)), 0, r);
  });
}
/** The card's one row to True (「True로 (공통 조건만)」): its conditions join the common ones and its destination
 *  becomes True's. A card goes back to rows by itself when a row arrives (trueToRow). */
export function setTrue(w: Workspace, uid: string): Workspace {
  return edit(w, uid, c => {
    if (c.true !== undefined) return;
    if (c.rows.length > 1) throw Error(tr('행이 여럿인 카드는 True를 쓰지 않습니다. 행을 하나만 남기세요.'));
    const row = c.rows[0];
    c.true = row?.to ?? null;
    if (row) c.guards = [...c.guards, ...row.guards];
    c.rows = [];
  });
}
/** Add a condition to the common conditions or a row (a group is made by dropping one condition on another). */
export function addCondition(w: Workspace, uid: string, place: CardPlace) {
  let id = '';
  const next = edit(w, uid, c => {
    const t = newTest(c);
    c.tests.push(t);
    rootsOf(c, place).push(t.id);
    id = t.id;
  });
  return {workspace: next, id};
}
/** Remove a root condition (with its members) from where it sits; a row keeps at least one (remove the row
 *  instead). */
export function removeCondition(w: Workspace, uid: string, place: CardPlace, id: string): Workspace {
  return edit(w, uid, c => {
    const roots = rootsOf(c, place);
    if (place !== 'guards' && roots.length === 1) throw Error(tr('행에는 조건이 하나 이상 필요합니다. 행을 지우세요.'));
    roots.splice(roots.indexOf(id), 1);
    pruneTests(c);
  });
}
/** A list conditions sit in: the common conditions, a row's, or a group's members. */
export type CondList = CardPlace | `group:${string}`;
const listOf = (c: ConditionCard, list: CondList) => {
  if (!list.startsWith('group:')) return rootsOf(c, list as CardPlace);
  const g = c.tests.find(t => t.id === list.slice(6));
  if (!g || (g.kind !== 'all' && g.kind !== 'any')) throw Error(tr('조건 그룹을 찾지 못했습니다.'));
  return (g.operands ??= []);
};
/** Move a condition (with its members) to `index` of another list or its own, or into a new row at `index` of the
 *  rows (`to` 'newRow'): dragged on the card. A row left without conditions goes with its destination. */
export function moveCondition(
  w: Workspace,
  uid: string,
  from: CondList,
  id: string,
  to: CondList | 'newRow',
  index: number
) {
  return edit(w, uid, c => {
    const source = listOf(c, from),
      at = source.indexOf(id);
    if (at < 0) throw Error(tr('조건을 찾지 못했습니다.'));
    if (to.startsWith('group:') && descendants(c, [id]).has(to.slice(6)))
      throw Error(tr('자기 자신이나 자식 그룹으로 이동할 수 없습니다.'));
    if (to.startsWith('group:') && isGroup(c.tests.find(t => t.id === id)!))
      throw Error(tr('묶음 안에는 묶음을 넣지 않습니다(한 단계까지).'));
    source.splice(at, 1);
    if (to === 'newRow') {
      const carry = trueToRow(c);
      c.rows.splice(Math.max(0, Math.min(index, c.rows.length)), 0, {id: newRowId(c), guards: [id], to: carry});
    } else {
      const target = listOf(c, to);
      // Within its own list the index counts the list as it was.
      const i = to === from && index > at ? index - 1 : index;
      target.splice(Math.max(0, Math.min(i, target.length)), 0, id);
    }
  });
}
/** A condition (with its members) dragged to another card, or copied (Ctrl held, onto any card): it goes to `index`
 *  of `to` there, or into a new row at `index` ('newRow'), as a copy with fresh ids. Moved, it leaves its card as
 *  moveCondition leaves it: a row without conditions goes. A move within one card is moveCondition. */
export function transferCondition(
  w: Workspace,
  fromCard: string,
  from: CondList,
  id: string,
  toCard: string,
  to: CondList | 'newRow',
  index: number,
  copy: boolean
) {
  if (fromCard === toCard && !copy) return moveCondition(w, fromCard, from, id, to, index);
  const n = structuredClone(w),
    source = n.cards.find(c => c.uid === fromCard),
    target = n.cards.find(c => c.uid === toCard);
  if (!source || !target) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  const roots = listOf(source, from);
  if (!roots.includes(id)) throw Error(tr('조건을 찾지 못했습니다.'));
  const made = insertExpression(target, readExpression(source, id));
  if (to === 'newRow') {
    const carry = trueToRow(target);
    target.rows.splice(Math.max(0, Math.min(index, target.rows.length)), 0, {
      id: newRowId(target),
      guards: [made],
      to: carry,
    });
  } else {
    const list = listOf(target, to);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, made);
  }
  if (to.startsWith('group:') && isGroup(source.tests.find(t => t.id === id)!))
    throw Error(tr('묶음 안에는 묶음을 넣지 않습니다(한 단계까지).'));
  if (!copy) {
    roots.splice(roots.indexOf(id), 1);
    tidyCard(source);
  }
  tidyCard(target);
  return n;
}
/** A copy of a condition (with its members) beside it. */
export function duplicateCondition(w: Workspace, uid: string, place: CardPlace, id: string) {
  return edit(w, uid, c => {
    const copy = insertExpression(c, readExpression(c, id));
    const roots = rootsOf(c, place);
    roots.splice(roots.indexOf(id) + 1, 0, copy);
  });
}
/** `w` with the card `uid` tidied (after an edit made elsewhere, such as a group member added or removed). */
export const tidyCardIn = (w: Workspace, uid: string) => edit(w, uid, () => {});
/** A row dragged between two parts of another card (or Ctrl: copied, onto any card): a row there at `index` with its
 *  conditions and destination. A destination that would loop the cards back is refused. */
export function transferRow(w: Workspace, fromCard: string, row: string, toCard: string, index: number, copy: boolean) {
  if (fromCard === toCard && !copy) {
    const at = w.cards.find(c => c.uid === fromCard)?.rows.findIndex(r => r.id === row) ?? -1;
    return moveRow(w, fromCard, row, index > at ? index - 1 : index);
  }
  const n = structuredClone(w),
    source = n.cards.find(c => c.uid === fromCard),
    card = n.cards.find(c => c.uid === toCard);
  if (!source || !card) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  const r = source.rows.find(r => r.id === row);
  if (!r) throw Error(tr('행을 찾지 못했습니다.'));
  const carry = trueToRow(card);
  const made = {
    id: newRowId(card),
    guards: r.guards.map(id => insertExpression(card, readExpression(source, id))),
    to: r.to ?? carry,
    ...(r.any ? {any: true as const} : {}),
  };
  card.rows.splice(Math.max(0, Math.min(index, card.rows.length)), 0, made);
  if (!copy) source.rows = source.rows.filter(x => x.id !== row);
  tidyCard(source);
  tidyCard(card);
  if (cardLoop(n)) throw Error(tr('이 행의 목적지가 이 카드로 되돌아와 순환합니다.'));
  return n;
}
/** A row dropped into the common conditions or another row: its conditions join that list (one group of the row's
 *  operator when the list's is the other), its destination left behind with the row. Ctrl keeps the row. */
export function rowIntoList(
  w: Workspace,
  fromCard: string,
  row: string,
  toCard: string,
  list: CardPlace,
  copy: boolean
) {
  if (fromCard === toCard && list === 'row:' + row) return w;
  const n = structuredClone(w),
    source = n.cards.find(c => c.uid === fromCard),
    card = n.cards.find(c => c.uid === toCard);
  if (!source || !card) throw Error(tr('조건 카드를 찾지 못했습니다.'));
  const r = source.rows.find(r => r.id === row);
  if (!r) throw Error(tr('행을 찾지 못했습니다.'));
  const holder = listOf(card, list),
    holderAny = list !== 'guards' && !!card.rows.find(x => 'row:' + x.id === list)?.any,
    rowAny = !!r.any && r.guards.length > 1;
  const copies = r.guards.map(id => insertExpression(card, readExpression(source, id)));
  if (rowAny === holderAny || copies.length === 1) holder.push(...copies);
  else {
    // The row becomes a group: one level only, so a row holding a group cannot.
    if (copies.some(id => isGroup(card.tests.find(t => t.id === id)!)))
      throw Error(tr('묶음 안에는 묶음을 넣지 않습니다(한 단계까지).'));
    const group: CardTest = {
      id: testId(card),
      kind: rowAny ? 'any' : 'all',
      subject: 'self',
      minimum: 0,
      operands: copies,
    };
    card.tests.push(group);
    holder.push(group.id);
  }
  // Emptied rather than taken out: the last row's destination passes to the True that tidyCard brings back.
  if (!copy) r.guards = [];
  tidyCard(source);
  tidyCard(card);
  return n;
}
