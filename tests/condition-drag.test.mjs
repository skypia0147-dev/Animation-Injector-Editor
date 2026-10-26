import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../src/workspace.ts';
import {
  addCondition,
  mergeCondition,
  moveCondition,
  rowIntoList,
  setGroupJoin,
  setRowJoin,
  transferCondition,
  transferRow,
} from '../src/graph/cardCommands.ts';
import {groupRuleError} from '../src/cards.ts';
import {compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';

// Dragging a condition on a condition card (10-26): between the common conditions, rows and groups, or out into a
// row of its own.
const check = (id, kind = 'sneaking') => ({id, kind, subject: 'self', minimum: 0});
const sample = () => {
  const w = emptyWorkspace();
  w.cards = [
    {
      uid: 'card1',
      tests: [
        check('A', 'weaponDrawn'),
        {id: 'G', kind: 'any', subject: 'self', minimum: 0, operands: ['B', 'C']},
        check('B', 'attackState'),
        check('C', 'attackState'),
        check('D', 'sneaking'),
        check('E', 'movementDirection'),
        check('F', 'movementDirection'),
      ],
      guards: ['A', 'G', 'D'],
      rows: [
        {id: 'Row1', guards: ['E'], to: {action: 'a1'}},
        {id: 'Row2', guards: ['F'], to: {action: 'a2'}},
      ],
      false: null,
      position: {x: 0, y: 0},
    },
  ];
  return w;
};
const card = w => w.cards[0];

test('condition drag: common conditions to a row and back, order kept', () => {
  let w = moveCondition(sample(), 'card1', 'guards', 'D', 'row:Row1', 0);
  assert.deepEqual(card(w).guards, ['A', 'G']);
  assert.deepEqual(card(w).rows[0].guards, ['D', 'E']);
  w = moveCondition(w, 'card1', 'row:Row1', 'D', 'guards', 0);
  assert.deepEqual(card(w).guards, ['D', 'A', 'G']);
  // Within one list the index is where it lands among the list as it was.
  w = moveCondition(w, 'card1', 'guards', 'D', 'guards', 3);
  assert.deepEqual(card(w).guards, ['A', 'G', 'D']);
  assert.equal(card(w).tests.length, 7);
});

test('condition drag: into and out of a group, never into itself', () => {
  let w = moveCondition(sample(), 'card1', 'guards', 'D', 'group:G', 1);
  assert.deepEqual(card(w).tests.find(t => t.id === 'G').operands, ['B', 'D', 'C']);
  w = moveCondition(w, 'card1', 'group:G', 'B', 'guards', 0);
  assert.deepEqual(card(w).guards, ['B', 'A', 'G']);
  assert.throws(() => moveCondition(sample(), 'card1', 'guards', 'G', 'group:G', 0), /자기 자신/);
});

test('condition drag: out into a new row, and a row left empty goes', () => {
  let w = moveCondition(sample(), 'card1', 'guards', 'D', 'newRow', 2);
  assert.deepEqual(
    card(w).rows.map(r => [r.guards, r.to]),
    [
      [['E'], {action: 'a1'}],
      [['F'], {action: 'a2'}],
      [['D'], null],
    ]
  );
  w = moveCondition(w, 'card1', 'row:Row2', 'F', 'row:Row1', 1);
  assert.deepEqual(
    card(w).rows.map(r => r.guards),
    [['E', 'F'], ['D']]
  );
  // On a True card a new row takes True's place and destination.
  const trueCard = sample();
  trueCard.cards[0].rows = [];
  trueCard.cards[0].true = {action: 'a9'};
  const opened = card(moveCondition(trueCard, 'card1', 'guards', 'D', 'newRow', 0));
  assert.equal(opened.true, undefined);
  assert.deepEqual(
    opened.rows.map(r => [r.guards, r.to]),
    [[['D'], {action: 'a9'}]]
  );
});

const twoCards = () => {
  const w = sample();
  w.cards.push({
    uid: 'card2',
    tests: [check('Condition1', 'alive')],
    guards: ['Condition1'],
    rows: [],
    true: {action: 'a3'},
    false: null,
    position: {x: 400, y: 0},
  });
  return w;
};
test('condition drag: to another card moves it with fresh ids, its members too', () => {
  const w = transferCondition(twoCards(), 'card1', 'guards', 'G', 'card2', 'guards', 0, false);
  const [one, two] = w.cards;
  assert.deepEqual(one.guards, ['A', 'D']);
  assert.ok(!one.tests.some(t => ['G', 'B', 'C'].includes(t.id)), 'the group and its members left card1');
  const g = two.tests.find(t => t.id === two.guards[0]);
  assert.equal(g.kind, 'any');
  assert.deepEqual(
    g.operands.map(id => two.tests.find(t => t.id === id).kind),
    ['attackState', 'attackState']
  );
  assert.equal(new Set(two.tests.map(t => t.id)).size, two.tests.length, 'no id twice on card2');
  // A True card takes it as its first row, with True's destination.
  const x = transferCondition(twoCards(), 'card1', 'guards', 'D', 'card2', 'newRow', 0, false);
  assert.equal(x.cards[1].true, undefined);
  assert.deepEqual(x.cards[1].rows[0].to, {action: 'a3'});
});
test('condition drag: Ctrl copies, on another card or its own', () => {
  let w = transferCondition(twoCards(), 'card1', 'row:Row1', 'E', 'card2', 'guards', 1, true);
  assert.deepEqual(w.cards[0].rows[0].guards, ['E'], 'the original stays');
  assert.equal(w.cards[1].guards.length, 2);
  assert.equal(w.cards[1].tests.find(t => t.id === w.cards[1].guards[1]).kind, 'movementDirection');
  w = transferCondition(twoCards(), 'card1', 'row:Row1', 'E', 'card1', 'newRow', 0, true);
  assert.equal(w.cards[0].rows.length, 3);
  assert.deepEqual(w.cards[0].rows[1].guards, ['E']);
  assert.notEqual(w.cards[0].rows[0].guards[0], 'E');
});
test('condition drag: a moved row-only condition takes its row along', () => {
  const w = transferCondition(twoCards(), 'card1', 'row:Row2', 'F', 'card2', 'guards', 0, false);
  assert.deepEqual(
    w.cards[0].rows.map(r => r.id),
    ['Row1']
  );
});

// Groups (runtime 0.12.301, docs/mockup-condition-groups ⑥): made by dropping one condition on another, one level,
// the operator opposite to what holds them; tidied after every edit.
test('condition groups: a drop on a condition makes an OR group among AND conditions', () => {
  let w = mergeCondition(sample(), 'card1', 'guards', 'D', 'card1', 'guards', 'A', false);
  const c = card(w),
    g = c.tests.find(t => t.id === c.guards[0]);
  assert.equal(g.kind, 'any');
  assert.deepEqual(g.operands, ['A', 'D']);
  assert.deepEqual(c.guards, [g.id, 'G']);
  assert.equal(groupRuleError(c), undefined);
  // In an OR row the group is AND; a row of one group takes the group's operator.
  w = setRowJoin(w, 'card1', 'Row1', true);
  assert.equal(card(w).rows[0].any, undefined, 'one condition makes no OR');
  w = mergeCondition(w, 'card1', 'row:Row2', 'F', 'card1', 'row:Row1', 'E', false);
  assert.deepEqual(card(w).rows[0].guards, ['E', 'F'], 'a row holding only a group takes its members');
  assert.equal(card(w).rows[0].any, true, '…and its operator (OR)');
  assert.deepEqual(
    card(w).rows.map(r => r.id),
    ['Row1'],
    'the row the condition left goes'
  );
});
test('condition groups: operators flip with the row, the same operator dissolves a group', () => {
  let w = addCondition(sample(), 'card1', 'row:Row1').workspace;
  w = mergeCondition(w, 'card1', 'guards', 'D', 'card1', 'row:Row1', 'E', false);
  const r = () => card(w).rows[0],
    group = () => card(w).tests.find(t => t.id === r().guards[0]);
  assert.equal(group().kind, 'any', 'an AND row holds OR groups');
  w = setRowJoin(w, 'card1', 'Row1', true);
  assert.equal(group().kind, 'all', 'an OR row holds AND groups');
  w = setGroupJoin(w, 'card1', 'row:Row1', group().id, 'any');
  assert.equal(r().guards.length, 3, 'the same operator as the row gives the members back');
  assert.equal(groupRuleError(card(w)), undefined);
});
test('condition groups: the XML writes match="any", reads only the rule', () => {
  const base = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="T">
  <Start id="S" key="G"><Row to="A"><Check kind="combat"/><Check kind="air"/></Row></Start>
  <Action id="A" clip="Animations\a.hkx"/>
</AnimationSet>`;
  const w = importWorkspaceXml(base.replace('<Row to="A">', '<Row to="A" match="any">'));
  assert.equal(w.cards[0].rows[0].any, true);
  assert.match(compileWorkspace(w), /<Row to="A" match="any">/);
  for (const row of [
    '<Row to="A"><And><Check kind="air"/><Check kind="sneaking"/></And>',
    '<Row to="A"><Or><Check kind="air"/><Or><Check kind="combat"/><Check kind="sneaking"/></Or></Or>',
    '<Row to="A"><Or><Check kind="air"/></Or>',
  ])
    assert.throws(() => importWorkspaceXml(base.replace('<Row to="A">', row)), /묶음/);
});

// A whole row (a group of its operator) dragged into the common conditions, another row or another card.
test('row drag: into the common conditions or another row, as a group when the operators differ', () => {
  let w = addCondition(sample(), 'card1', 'row:Row1').workspace;
  w = setRowJoin(w, 'card1', 'Row1', true);
  // An OR row into the common conditions (AND): one OR group there; the row and its destination go.
  let x = rowIntoList(w, 'card1', 'Row1', 'card1', 'guards', false);
  const g = card(x).tests.find(t => t.id === card(x).guards.at(-1));
  assert.equal(g.kind, 'any');
  assert.equal(g.operands.length, 2);
  assert.deepEqual(
    card(x).rows.map(r => r.id),
    ['Row2']
  );
  // An AND row into an OR row: an AND group there; Ctrl keeps the row.
  x = rowIntoList(
    setRowJoin(addCondition(w, 'card1', 'row:Row2').workspace, 'card1', 'Row2', false),
    'card1',
    'Row2',
    'card1',
    'row:Row1',
    true
  );
  assert.equal(card(x).rows.length, 2);
  const inner = card(x).tests.find(t => t.id === card(x).rows[0].guards.at(-1));
  assert.equal(inner.kind, 'all');
  assert.equal(groupRuleError(card(x)), undefined);
  // A row holding a group cannot become a group (one level).
  const nested = mergeCondition(
    addCondition(w, 'card1', 'row:Row2').workspace,
    'card1',
    'guards',
    'D',
    'card1',
    'row:Row2',
    'F',
    false
  );
  assert.throws(() => rowIntoList(nested, 'card1', 'Row2', 'card1', 'row:Row1', false), /한 단계/);
});
test('row drag: to another card with its destination, never into a loop', () => {
  const w = sample();
  w.cards.push({
    uid: 'card2',
    tests: [check('Condition1', 'alive')],
    guards: ['Condition1'],
    rows: [{id: 'Row1', guards: ['Condition1'], to: {card: 'card1'}}],
    false: null,
    position: {x: 0, y: 0},
  });
  w.cards[1].guards = [];
  const x = transferRow(w, 'card1', 'Row1', 'card2', 0, false);
  assert.deepEqual(x.cards[1].rows[0].to, {action: 'a1'});
  assert.equal(x.cards[0].rows.length, 1);
  // card2's row goes to card1: moving it into card1 points card1 at itself.
  assert.throws(() => transferRow(w, 'card2', 'Row1', 'card1', 0, true), /순환/);
});

test('True comes back when the last row goes, with its destination', () => {
  // Both rows' conditions into the common conditions: no rows left, True goes where the last of them went.
  let w = moveCondition(sample(), 'card1', 'row:Row1', 'E', 'guards', 0);
  assert.equal(card(w).true, undefined);
  w = moveCondition(w, 'card1', 'row:Row2', 'F', 'guards', 0);
  assert.deepEqual(card(w).rows, []);
  assert.deepEqual(card(w).true, {action: 'a2'});
  // And a condition dropped back opens a row with it.
  w = moveCondition(w, 'card1', 'guards', 'F', 'newRow', 0);
  assert.equal(card(w).true, undefined);
  assert.deepEqual(card(w).rows[0].to, {action: 'a2'});
});
test('the last row dragged into the common conditions leaves its destination to True', () => {
  const w = moveCondition(sample(), 'card1', 'row:Row2', 'F', 'row:Row1', 1);
  const x = rowIntoList(w, 'card1', 'Row1', 'card1', 'guards', false);
  assert.deepEqual(card(x).rows, []);
  assert.deepEqual(card(x).true, {action: 'a1'});
});
