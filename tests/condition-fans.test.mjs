import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {savedProject, withEditorBlock} from '../src/editorBlock.ts';
import {setBranchTarget, deleteCondition} from '../src/graph/conditionCommands.ts';
import {fanDropSlot, fanSlots, moveFanBranch} from '../src/graph/conditionFans.ts';
import {connectFlat, flatGraph} from '../src/graph/flat.ts';
import {disconnectEdge} from '../src/graph/disconnect.ts';

// One condition's pass fanned out to three conditions (docs/mockup-condition-fan, 10-21).
const cond = (id, extra = {}) => ({id, kind: 'air', subject: 'self', minimum: 0, ...extra});
const plain = () => {
  const w = s4sample();
  w.actions[0].flow = {
    entry: 'P',
    tests: [
      cond('P', {pass: {node: 'X'}}),
      cond('X', {pass: {action: 'a2'}}),
      cond('Y', {pass: {action: 'a2'}}),
      cond('Z', {pass: {action: 'a2'}}),
    ],
  };
  return w;
};
const fanned = () => {
  let w = plain();
  w = connectFlat(w, 'flow:a1:P', 'flow:a1:Y', 'pass');
  return connectFlat(w, 'flow:a1:P', 'flow:a1:Z', 'pass');
};
const tests = w => Object.fromEntries(w.actions[0].flow.tests.map(t => [t.id, t]));

test('a line drawn from a pass onto another condition fans out, written as the old chain', () => {
  const w = fanned(),
    t = tests(w);
  assert.deepEqual(w.actions[0].flow.fans, [{parent: 'P', branches: ['X', 'Y', 'Z'], fails: {}}]);
  assert.deepEqual(t.P.pass, {node: 'X'});
  assert.deepEqual(t.X.fail, {node: 'Y'});
  assert.deepEqual(t.Y.fail, {node: 'Z'});
  assert.equal(t.Z.fail, undefined, 'the last empty fail runs nothing: omitted');
  // The XML is the chain written by hand: no new grammar.
  const chain = plain();
  Object.assign(tests(chain).X, {fail: {node: 'Y'}});
  Object.assign(tests(chain).Y, {fail: {node: 'Z'}});
  assert.equal(compileWorkspace(w), compileWorkspace(chain));
});

test('the canvas draws one numbered line per branch and no line for an empty fail', () => {
  const g = flatGraph(fanned());
  const pass = g.edges.filter(e => e.source === 'flow:a1:P' && e.pin === 'pass');
  assert.deepEqual(
    pass.map(e => [e.target, e.rank]),
    [
      ['flow:a1:X', 0],
      ['flow:a1:Y', 1],
      ['flow:a1:Z', 2],
    ]
  );
  assert.equal(g.edges.filter(e => e.pin === 'fail').length, 0);
  const node = id => g.nodes.find(n => n.id === id);
  assert.equal(node('flow:a1:P').fanCount, 3);
  assert.deepEqual(
    ['X', 'Y', 'Z'].map(id => node('flow:a1:' + id).fan.index),
    [0, 1, 2]
  );
});

test('a connected fail goes there at once; a branch it skips is not reached', () => {
  const w = setBranchTarget(fanned(), 'a1', 'X', 'fail', {node: 'Z'}),
    t = tests(w);
  assert.deepEqual(t.X.fail, {node: 'Z'});
  assert.deepEqual(w.actions[0].flow.fans[0].fails, {X: {node: 'Z'}});
  const g = flatGraph(w),
    fan = id => g.nodes.find(n => n.id === 'flow:a1:' + id).fan;
  assert.equal(fan('Y').reached, false);
  assert.equal(fan('Z').reached, true);
  assert.equal(g.edges.filter(e => e.pin === 'fail').length, 1, 'only the connected fail is a line');
  // Emptied again, it tries the next branch.
  assert.deepEqual(tests(setBranchTarget(w, 'a1', 'X', 'fail')).X.fail, {node: 'Y'});
});

test('reordering keeps every connection and rewrites only the chain', () => {
  const w = setBranchTarget(fanned(), 'a1', 'Y', 'fail', {action: 'a2'}),
    moved = moveFanBranch(w, 'a1', 'Z', 0),
    t = tests(moved);
  assert.deepEqual(moved.actions[0].flow.fans[0].branches, ['Z', 'X', 'Y']);
  assert.deepEqual(t.P.pass, {node: 'Z'});
  assert.deepEqual(t.Z.fail, {node: 'X'});
  assert.deepEqual(t.X.fail, {node: 'Y'});
  assert.deepEqual(t.Y.fail, {action: 'a2'}, 'the connected fail stays');
  // An order whose fail would loop back is refused: the runtime rejects a cycle (ConditionFlow.h kCycle).
  const skip = setBranchTarget(fanned(), 'a1', 'X', 'fail', {node: 'Z'});
  assert.throws(() => moveFanBranch(skip, 'a1', 'Z', 0), /순환/);
});

test('cutting a fanned line or deleting a branch leaves the rest of the fan', () => {
  const w = fanned(),
    edge = flatGraph(w).edges.find(e => e.id === 'flow:a1:P:pass:Y'),
    cut = disconnectEdge(w, edge);
  assert.deepEqual(cut.actions[0].flow.fans[0].branches, ['X', 'Z']);
  assert.deepEqual(tests(cut).X.fail, {node: 'Z'});
  assert.equal(tests(cut).Y.fail, undefined);
  const deleted = deleteCondition(w, 'a1', 'Y');
  assert.deepEqual(deleted.actions[0].flow.fans[0].branches, ['X', 'Z']);
  assert.deepEqual(tests(deleted).X.fail, {node: 'Z'});
  // Down to one branch it is a plain route again.
  const one = disconnectEdge(
    cut,
    flatGraph(cut).edges.find(e => e.id === 'flow:a1:P:pass:Z')
  );
  assert.equal(one.actions[0].flow.fans, undefined);
  assert.deepEqual(tests(one).P.pass, {node: 'X'});
  assert.equal(tests(one).X.fail, undefined);
});

test('the order and the connected fails come back from the saved file', () => {
  const w = moveFanBranch(setBranchTarget(fanned(), 'a1', 'Y', 'fail', {action: 'a2'}), 'a1', 'Y', 0);
  const text = withEditorBlock(compileWorkspace(w), JSON.stringify(captureGraph(w)));
  const restored = parseWorkspace(savedProject(text).project);
  assert.deepEqual(restored.actions[0].flow.fans, w.actions[0].flow.fans);
});

test('a card dropped onto another branch is inserted above or below its middle', () => {
  const box = (id, y) => ({id, x: 0, y, w: 200, h: 100});
  const branches = [box('X', 0), box('Y', 150), box('Z', 300)];
  assert.equal(fanDropSlot({...box('Z', -20)}, branches)?.at, 0);
  assert.equal(fanDropSlot({...box('Z', 30)}, branches)?.at, 1);
  assert.equal(fanDropSlot({...box('Z', 600)}, branches), undefined, 'an empty spot only moves the card');
  assert.equal(fanDropSlot({...box('Z', 10), x: 150}, branches), undefined, 'beside the card is not onto it');
  assert.deepEqual(fanSlots(['Z', 'X', 'Y'], {X: {x: 0, y: 0}, Y: {x: 0, y: 150}, Z: {x: 0, y: 300}}), {
    Z: {x: 0, y: 0},
    X: {x: 0, y: 150},
    Y: {x: 0, y: 300},
  });
});
