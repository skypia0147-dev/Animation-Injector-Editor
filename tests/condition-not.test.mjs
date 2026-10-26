import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {newCard, newStart} from '../src/cards.ts';
import {checker, needsChecker} from './local.mjs';

// A condition's NOT is a checkbox on it (XML format 6: not="true" on <Check>, <And>, <Or>).
/** An HKX whose start goes through a card: its common conditions `tests` (roots `guards`), True to the HKX. */
function sample(tests, guards = tests.map(t => t.id)) {
  const w = addFlat(emptyWorkspace(), '', 'playNode', {x: 600, y: 50}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  const card = {...newCard(w, {x: 300, y: 50}), tests, guards, true: {action: w.actions[0].uid}};
  w.cards.push(card);
  w.starts.push({...newStart(w, {x: 0, y: 50}), key: 'G', to: {card: card.uid}});
  return w;
}
test('Female NOT checkbox survives project and runtime XML without a separate editor node', needsChecker, () => {
  for (const subject of ['self', 'partner'])
    for (const negate of [true, false]) {
      const w = sample([{id: 'Condition1', kind: 'female', subject, minimum: 0, ...(negate ? {negate: true} : {})}]);
      assert.deepEqual(
        validateWorkspace(w).filter(i => i.level === 'error'),
        []
      );
      assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).cards, w.cards);
      const xml = compileWorkspace(w),
        restored = importWorkspaceXml(xml);
      assert.match(xml, /kind="female"/);
      assert.equal(xml.includes('not="true"'), negate);
      assert.deepEqual(restored.cards[0].tests, w.cards[0].tests);
      mkdirSync('tests/generated/condition-not', {recursive: true});
      const file = `tests/generated/condition-not/${subject}-${negate}.xml`;
      writeFileSync(file, xml);
      execFileSync(checker, [file]);
    }
});
test('NOT on AND groups keeps its operands and their own NOTs', () => {
  const w = sample(
    [
      {
        id: 'Condition1',
        kind: 'all',
        negate: true,
        subject: 'self',
        minimum: 0,
        operands: ['Condition2', 'Condition3'],
      },
      {id: 'Condition2', kind: 'female', subject: 'partner', minimum: 0},
      {id: 'Condition3', kind: 'air', negate: true, subject: 'self', minimum: 0},
    ],
    ['Condition1']
  );
  const xml = compileWorkspace(w);
  assert.match(xml, /<And not="true">\s*<Check kind="female" subject="partner"\/>\s*<Check kind="air" not="true"\/>/);
  const again = importWorkspaceXml(xml);
  assert.deepEqual(again.cards[0].tests, w.cards[0].tests);
  assert.deepEqual(again.cards[0].guards, ['Condition1']);
});
