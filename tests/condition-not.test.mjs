import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {foldNotConditions, checkFlows} from '../src/graph/conditions.ts';
import {checker, needsChecker} from './local.mjs';
function sample() {
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 600, y: 50}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  return addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 250, y: 50}).workspace;
}
test('Female NOT checkbox survives project and runtime XML without a separate editor node', needsChecker, () => {
  for (const subject of ['self', 'partner'])
    for (const negate of [true, false]) {
      const w = sample(),
        a = w.actions[0];
      Object.assign(a.flow.tests[0], {kind: 'female', subject, ...(negate ? {negate: true} : {})});
      assert.deepEqual(checkFlows(w), []);
      assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).actions[0].flow, a.flow);
      const xml = compileWorkspace(w),
        restored = importWorkspaceXml(xml);
      assert.match(xml, /kind="female"/);
      assert.equal(xml.includes('<Not'), negate);
      assert.deepEqual(JSON.parse(JSON.stringify(restored.actions[0].flow)), a.flow);
      const nodes = flatGraph(restored).nodes.filter(n => n.kind === 'conditionBranch');
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].title.includes('NOT'), negate);
      mkdirSync('tests/generated/condition-not', {recursive: true});
      const file = `tests/generated/condition-not/${subject}-${negate}.xml`;
      writeFileSync(file, xml);
      execFileSync(checker, [file]);
    }
});
test('NOT on AND groups and shared operands preserves routing and independent conditions', () => {
  const w = sample(),
    a = w.actions[0];
  a.flow = {
    entry: 'Group',
    tests: [
      {
        id: 'Group',
        kind: 'all',
        negate: true,
        subject: 'self',
        minimum: 0,
        operands: ['Female', 'Air'],
        pass: {action: a.uid},
        fail: {node: 'Female'},
      },
      {id: 'Female', kind: 'female', subject: 'partner', minimum: 0},
      {id: 'Air', kind: 'air', negate: true, subject: 'self', minimum: 0},
    ],
  };
  const xml = compileWorkspace(w),
    again = importWorkspaceXml(xml);
  assert.deepEqual(JSON.parse(JSON.stringify(again.actions[0].flow)), a.flow);
  assert.equal(again.actions[0].flow.tests.length, 3);
});
test('import folds shared and double NOT without changing shared predicate', () => {
  const w = sample(),
    f = w.actions[0].flow;
  f.entry = 'Double';
  f.tests = [
    {
      id: 'Double',
      kind: 'not',
      subject: 'self',
      minimum: 0,
      operands: ['Inverse'],
      pass: {action: w.actions[0].uid},
      fail: {node: 'Female'},
    },
    {id: 'Inverse', kind: 'not', subject: 'self', minimum: 0, operands: ['Female']},
    {id: 'Female', kind: 'female', subject: 'partner', minimum: 0},
  ];
  foldNotConditions(w);
  assert.equal(f.tests.length, 2);
  assert.equal(f.tests[0].kind, 'female');
  assert.equal(!!f.tests[0].negate, false);
  assert.equal(f.tests[1].id, 'Female');
  assert.equal(!!f.tests[1].negate, false);
  assert.equal(f.tests[0].subject, 'partner');
});
