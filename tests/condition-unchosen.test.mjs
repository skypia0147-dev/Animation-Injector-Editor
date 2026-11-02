import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {newCard} from '../src/cards.ts';
import {addCondition, addRow} from '../src/graph/cardCommands.ts';
import {conditionName, editExpression, patchTest} from '../src/graph/conditionExpression.ts';
import {extensionKinds, kindPatch, subjectlessKinds} from '../src/graph/conditionExtensions.ts';

// A new condition chooses nothing for the user (11-02): no kind, no target, no value, so a default never has to be
// taken back out. What is left to choose is an error that names it.
const errors = w => cardIssues(w).filter(i => i.level === 'error');
function withCard() {
  const w = emptyWorkspace();
  w.cards.push(newCard(w, {x: 0, y: 0}));
  return w;
}

test('a new condition, row or group member starts with nothing chosen and asks for its kind', () => {
  let w = withCard();
  const uid = w.cards[0].uid;
  const added = addCondition(w, uid, 'guards');
  w = added.workspace;
  const t = w.cards[0].tests.find(t => t.id === added.id);
  assert.deepEqual(t, {id: added.id, kind: '', subject: ''});
  assert.ok(errors(w).some(e => e.message === '검사 항목을 선택하세요.'));
  assert.equal(conditionName(t), '조건 선택');
  // The project keeps it as it is, saved and opened again.
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).cards, w.cards);
  const row = addRow(w, uid);
  const rowTest = row.workspace.cards[0].tests.at(-1);
  assert.equal(rowTest.kind, '');
  // A member added to a group.
  const wrapped = editExpression(w, uid, {type: 'wrap', id: added.id, mode: 'any'});
  const grown = editExpression(wrapped, uid, {type: 'add', parent: added.id});
  assert.equal(grown.cards[0].tests.at(-1).kind, '');
});

test('picking a kind fills in nothing: every value and the target are the user’s to choose', () => {
  for (const kind of extensionKinds) {
    const p = kindPatch({id: 'C', kind: '', subject: ''}, kind);
    for (const key of ['option', 'compare', 'measure', 'value', 'upper', 'within'])
      assert.equal(p[key], undefined, `${kind} ${key}`);
    assert.equal(p.subject, subjectlessKinds.includes(kind) ? 'self' : '', kind);
  }
  for (const kind of ['equippedType', 'attackState', 'global', 'space', 'ground']) {
    const p = kindPatch({id: 'C', kind: '', subject: ''}, kind);
    for (const key of ['hand', 'equipmentType', 'attackState', 'equals', 'space'])
      assert.equal(p[key], undefined, `${kind} ${key}`);
  }
  // The target chosen for one kind stays for the next; another kind's values go.
  const p = kindPatch({id: 'C', kind: 'resource', subject: 'partner', option: 'stamina', value: 5}, 'scale');
  assert.equal(p.subject, undefined);
  assert.equal(p.option, undefined);
  assert.equal(p.value, undefined);
});

test('each choice left empty is an error until chosen, then the condition is complete', () => {
  let w = withCard();
  const uid = w.cards[0].uid;
  const added = addCondition(w, uid, 'guards');
  const id = added.id;
  w = patchTest(added.workspace, uid, id, kindPatch({id, kind: '', subject: ''}, 'equippedType'));
  const messages = () => errors(w).map(e => e.message);
  // Equipment checks the actor itself only (11-02): no target to choose.
  assert.equal(w.cards[0].tests.find(t => t.id === id).subject, 'self');
  assert.ok(messages().includes('검사할 손과 장착 종류를 선택하세요.'));
  w = patchTest(w, uid, id, {hand: 'right', equipmentType: 'bow'});
  assert.ok(!messages().some(m => /선택하세요/.test(m)), messages().join(' | '));
  // A numeric check: the way to compare first, then the value.
  w = patchTest(
    w,
    uid,
    id,
    kindPatch(
      w.cards[0].tests.find(t => t.id === id),
      'scale'
    )
  );
  // Leaving a kind without a target, the target is chosen again.
  assert.ok(messages().includes('검사 대상을 선택하세요.'));
  w = patchTest(w, uid, id, {subject: 'self'});
  assert.ok(messages().includes('비교 방식을 선택하세요.'));
  w = patchTest(w, uid, id, {compare: 'le'});
  assert.ok(messages().includes('비교 값을 입력하세요.'));
  w = patchTest(w, uid, id, {value: 150});
  assert.ok(!messages().some(m => /비교|선택하세요/.test(m)), messages().join(' | '));
});
