import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage, getLanguage} from '../src/i18n/index.ts';
import {tr} from '../src/i18n/korean.ts';
import {handLabel} from '../src/graph/multiValue.ts';
import {conditionNames} from '../src/graph/conditionExpression.ts';
import {definition} from '../src/graph/conditionExtensions.ts';
import {cardNames, cardTitle} from '../src/cards.ts';

// The condition card in other languages (docs/mockup-chip-i18n, 10-30).
function inLanguage(language, f) {
  const before = getLanguage();
  setLanguage(language);
  try {
    return f();
  } finally {
    setLanguage(before);
  }
}

test('a key names its use after @: Korean shows the text before it, the others that use', () => {
  // ⑥ The hand chip's 「모두」 is 「Either」, the join's 「All」; the hand chip's own short words.
  assert.equal(
    inLanguage('ko', () => tr('모두@손 칩')),
    '모두'
  );
  assert.equal(
    inLanguage('en', () => tr('모두@손 칩')),
    'Either'
  );
  assert.equal(
    inLanguage('en', () => tr('모두')),
    'All'
  );
  assert.deepEqual(
    inLanguage('en', () => ['left', 'right', 'either'].map(handLabel)),
    ['Left', 'Right', 'Either']
  );
  assert.deepEqual(
    inLanguage('ko', () => ['left', 'right', 'either'].map(handLabel)),
    ['왼손', '오른손', '모두']
  );
  assert.equal(
    inLanguage('en', () => definition('equippedKeyword').choices.at(-1)[1]),
    'Either hand'
  );
});

test("an extension condition's name follows the language (⑤: it stayed Korean)", () => {
  assert.equal(
    inLanguage('ko', () => conditionNames.hitReceived),
    '받은 공격'
  );
  assert.equal(
    inLanguage('en', () => conditionNames.hitReceived),
    'Hit taken'
  );
  assert.equal(
    inLanguage('ja', () => conditionNames.hitReceived),
    '受けた攻撃'
  );
});

test('a route chip names a condition card by its conditions; the title keeps 「조건 ·」 (③)', () => {
  const c = {
    tests: [
      {id: 'a', kind: 'weaponDrawn'},
      {id: 'b', kind: 'hitReceived'},
    ],
    guards: ['a'],
    rows: [{id: 'r', guards: ['b']}],
  };
  const name = t => conditionNames[t.kind];
  assert.equal(
    inLanguage('en', () => cardNames(c, name)),
    'Weapon drawn / Hit taken'
  );
  assert.equal(
    inLanguage('en', () => cardTitle(c, name)),
    'Condition · Weapon drawn / Hit taken'
  );
  assert.equal(cardNames({tests: [], guards: [], rows: []}, name), '');
});
