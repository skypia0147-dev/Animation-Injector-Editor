import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupSummary, partText} from '../src/graph/groupSummary.ts';

// A group chip in one line (docs/mockup-group-summary A + B).
test('group chip: one name for the same conditions, then the first and how many more', () => {
  const same = groupSummary([
    {name: '공격 상태', value: 'bowAttached'},
    {name: '공격 상태', value: 'bowDrawn'},
  ]);
  assert.deepEqual(same.first, {name: '공격 상태', value: 'bowAttached·bowDrawn'});
  assert.equal(same.more, 0);

  const mixed = groupSummary([
    {name: '장착 종류', value: '왼손 활'},
    {name: '공격 상태', value: 'bowDrawn'},
    {name: '이동 입력 방향', value: '뒤'},
    {name: '공격 상태', value: 'bowAttached'},
  ]);
  assert.equal(partText(mixed.first), '장착 종류 왼손 활');
  assert.equal(mixed.more, 2);
  assert.deepEqual(mixed.parts.map(partText), [
    '장착 종류 왼손 활',
    '공격 상태 bowDrawn·bowAttached',
    '이동 입력 방향 뒤',
  ]);

  // NOT and a condition without a value are not merged into another.
  const kept = groupSummary([
    {name: '무기 뽑음', value: ''},
    {name: '무기 뽑음', value: ''},
    {name: '공격 상태', value: 'bash'},
    {name: '공격 상태', value: 'hit', not: true},
  ]);
  assert.deepEqual(kept.parts.map(partText), ['무기 뽑음', '무기 뽑음', '공격 상태 bash', 'NOT 공격 상태 hit']);
  assert.equal(kept.more, 3);

  assert.deepEqual(groupSummary([]), {first: undefined, more: 0, parts: []});
});

// The hand is its own chip (docs/mockup-hand-chip B): the same check on two hands is not merged into one value.
test('group chip: a hand check merges only with the same hand', () => {
  const s = groupSummary([
    {name: '장착 종류', value: '검', hand: 'left'},
    {name: '장착 종류', value: '대검', hand: 'left'},
    {name: '장착 종류', value: '검', hand: 'right'},
    {name: '장비 키워드', value: 'Skyrim.esm : 0x1E711', hand: 'either'},
  ]);
  assert.deepEqual(s.parts.map(partText), [
    '장착 종류 왼손 검·대검',
    '장착 종류 오른손 검',
    '장비 키워드 모두 Skyrim.esm : 0x1E711',
  ]);
  assert.equal(s.first.hand, 'left');
});
