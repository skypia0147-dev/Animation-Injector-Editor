import type {Workspace} from '../workspace.ts';
import {newRowId, pruneTests, testId, type CardTest, type ConditionCard} from '../cards.ts';
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
/** A new row (with one condition to set: a row needs one), at the end or at `index`. Not beside a True. */
export function addRow(w: Workspace, uid: string, index?: number) {
  let id = '';
  const next = edit(w, uid, c => {
    if (c.true !== undefined) throw Error(tr('True만 있는 카드입니다. True를 행으로 바꾸거나 지운 뒤 행을 더하세요.'));
    const t = newTest(c);
    c.tests.push(t);
    id = newRowId(c);
    const row = {id, guards: [t.id], to: null};
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
/** True on or off. On: the card's only row, taken when its common conditions hold (no rows beside it). Off: its
 *  destination becomes a row's, with that row's conditions taken from the common ones when there is one. */
export function setTrue(w: Workspace, uid: string, on: boolean): Workspace {
  return edit(w, uid, c => {
    if (on) {
      if (c.true !== undefined) return;
      if (c.rows.length > 1) throw Error(tr('행이 여럿인 카드는 True를 쓰지 않습니다. 행을 하나만 남기세요.'));
      // One row: its conditions join the common ones and its destination becomes True's.
      const row = c.rows[0];
      c.true = row?.to ?? null;
      if (row) c.guards = [...c.guards, ...row.guards];
      c.rows = [];
    } else {
      if (c.true === undefined) return;
      const to = c.true;
      delete c.true;
      // The common conditions' last one becomes the row's (a row needs a condition).
      const last = c.guards.pop();
      const t = last ? undefined : newTest(c);
      if (t) c.tests.push(t);
      c.rows = [{id: newRowId(c), guards: [last ?? t!.id], to}];
    }
  });
}
/** Add a condition: to the common conditions or a row (a check, or an empty AND group). */
export function addCondition(w: Workspace, uid: string, place: CardPlace, group = false) {
  let id = '';
  const next = edit(w, uid, c => {
    const t = newTest(c, group ? 'all' : 'air');
    if (group) t.operands = [];
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
/** Move a root condition between the common conditions and rows (or within one), to `index`. */
export function moveCondition(w: Workspace, uid: string, from: CardPlace, id: string, to: CardPlace, index: number) {
  return edit(w, uid, c => {
    const source = rootsOf(c, from);
    if (from !== to && from !== 'guards' && source.length === 1) throw Error(tr('행에는 조건이 하나 이상 필요합니다.'));
    source.splice(source.indexOf(id), 1);
    const target = rootsOf(c, to);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  });
}
/** A copy of a condition (with its members) beside it. */
export function duplicateCondition(w: Workspace, uid: string, place: CardPlace, id: string) {
  return edit(w, uid, c => {
    const copy = insertExpression(c, readExpression(c, id));
    const roots = rootsOf(c, place);
    roots.splice(roots.indexOf(id) + 1, 0, copy);
  });
}
