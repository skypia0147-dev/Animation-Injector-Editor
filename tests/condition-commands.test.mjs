import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {setBranchTarget, deleteCondition, setConditionOperands} from '../src/graph/conditionCommands.ts';
import {connectFlat, deleteFlat, flatGraph} from '../src/graph/flat.ts';
import {groupConditions, addTableRow} from '../src/graph/conditionTables.ts';
import {contextualAdds, addConnected} from '../src/graph/contextAdd.ts';
import {documentReducer} from '../src/graph/state.ts';
import {executeGraphCommand} from '../src/graph/commands.ts';
const sample = () => {
  const w = s4sample();
  w.actions[0].flow = {
    entry: 'A',
    tests: [
      {id: 'A', kind: 'air', subject: 'self', minimum: 0, pass: {action: 'a2'}, fail: {node: 'B'}},
      {id: 'B', kind: 'alive', subject: 'self', minimum: 0, pass: {action: 'a1'}},
    ],
  };
  return w;
};
test('table and canvas destinations use the same checks and preserve input on rejection', () => {
  const w = sample(),
    before = structuredClone(w);
  assert.deepEqual(
    setBranchTarget(w, 'a1', 'B', 'fail', {action: 'a2'}),
    connectFlat(w, 'flow:a1:B', 'anim:a2:|clip_A1', 'fail')
  );
  assert.throws(() => setBranchTarget(w, 'a1', 'B', 'fail', {node: 'A'}), /순환/);
  assert.throws(() => connectFlat(w, 'conditionTable:a1', 'flow:a1:A', 'choice:B:fail'), /순환/);
  assert.throws(() => setBranchTarget(w, 'a1', 'A', 'pass', {node: 'missing'}));
  assert.throws(() => setBranchTarget(w, 'a1', 'A', 'pass', {action: 'missing'}));
  assert.deepEqual(w, before);
});
test('deletion removes only a rule and attached relations in both table and canvas', () => {
  const w = sample(),
    before = structuredClone(w),
    next = deleteCondition(w, 'a1', 'B');
  assert.deepEqual(next, deleteFlat(w, 'flow:a1:B'));
  assert.equal(next.actions[0].flow.tests[0].fail, undefined);
  assert.deepEqual(next.actions[0].flow.tests[0].pass, {action: 'a2'});
  assert.deepEqual(next.actions.slice(1), w.actions.slice(1));
  assert.deepEqual(next.links, w.links);
  assert.deepEqual(w, before);
  const state = {present: w, past: [], future: []};
  const edited = documentReducer(state, {type: 'edit', next});
  assert.deepEqual(documentReducer(edited, {type: 'undo'}).present, w);
  assert.deepEqual(documentReducer(documentReducer(edited, {type: 'undo'}), {type: 'redo'}).present, next);
});
test('group context adds one rule without discarding the prior entry and supports grouped input', () => {
  const w = groupConditions(sample()),
    before = structuredClone(w);
  const options = contextualAdds(w, 'conditionTable:a1', flatGraph(w));
  assert.equal(options.length, 1);
  const result = addConnected(w, 'conditionTable:a1', options[0], {x: 10, y: 20});
  assert.deepEqual(result.workspace, addTableRow(w, 'a1'));
  assert.equal(result.id, 'conditionTable:a1');
  assert.deepEqual(result.workspace.actions[0].flow.tests.at(-1).fail, {node: 'A'});
  const expanded = connectFlat(w, 'start:a1|keyInput', 'flow:a1:A', 'trigger');
  assert.deepEqual(connectFlat(w, 'start:a1|keyInput', 'conditionTable:a1', 'trigger'), expanded);
  assert.deepEqual(w, before);
});

test('connected condition insertion keeps the existing destination and commits as one undo step', () => {
  const w = sample(),
    before = structuredClone(w);
  const options = contextualAdds(w, 'flow:a1:A');
  assert.ok(!options.some(o => o.kind === 'playNode' && o.port === 'pass'));
  const option = options.find(o => o.kind === 'conditionBranch' && o.port === 'pass');
  const result = executeGraphCommand(w, {type: 'addConnected', source: 'flow:a1:A', option, position: {x: 12, y: 34}});
  const flow = result.workspace.actions[0].flow,
    newKey = result.id.split(':').at(-1);
  assert.deepEqual(flow.tests.find(t => t.id === 'A').pass, {node: newKey});
  assert.deepEqual(flow.tests.find(t => t.id === newKey).pass, {action: 'a2'});
  assert.deepEqual(w, before);
  const state = documentReducer({present: w, past: [], future: []}, {type: 'edit', next: result.workspace});
  assert.equal(state.past.length, 1);
  assert.deepEqual(documentReducer(state, {type: 'undo'}).present, w);
});

test('operand editing and canvas reject cycles and branched predicates consistently', () => {
  const w = sample();
  w.actions[0].flow.tests.push(
    {id: 'C', kind: 'all', subject: 'self', minimum: 0, operands: []},
    {id: 'D', kind: 'all', subject: 'self', minimum: 0, operands: []}
  );
  const before = structuredClone(w);
  const n = setConditionOperands(w, 'a1', 'C', ['D']);
  assert.deepEqual(n, connectFlat(w, 'flow:a1:D', 'flow:a1:C', 'condition'));
  assert.throws(() => setConditionOperands(n, 'a1', 'D', ['C']), /순환/);
  assert.throws(() => connectFlat(n, 'flow:a1:C', 'flow:a1:D', 'condition'), /순환/);
  assert.throws(() => setConditionOperands(n, 'a1', 'C', ['A']), /통과·실패/);
  assert.throws(() => setBranchTarget(n, 'a1', 'D', 'pass', {action: 'a2'}), /통과·실패/);
  assert.deepEqual(w, before);
  assert.deepEqual(setConditionOperands(n, 'a1', 'C', []).actions[0].flow.tests.at(-2).operands, []);
});
