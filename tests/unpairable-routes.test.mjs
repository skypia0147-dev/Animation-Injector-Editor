import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {addFlat} from '../src/graph/flat.ts';
import {unpairableRoutes, checkFlows} from '../src/graph/conditions.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';

// A lead with a condition flow, a paired destination P and an ordinary destination N.
const flow = (entry, tests) => ({
  actions: [
    {uid: 'L', pair: {}, config: {name: 'Lead'}, flow: {entry, tests}},
    {uid: 'P', pair: {}, config: {name: 'Grab'}},
    {uid: 'N', config: {name: 'Solo'}},
  ],
});
const status = (id, option, extra = {}) => ({
  id,
  kind: 'actorStatus',
  option,
  subject: 'partner',
  minimum: 0,
  ...extra,
});
const combat = (id, extra = {}) => ({id, kind: 'combat', subject: 'partner', minimum: 0, ...extra});
const nodes = w => unpairableRoutes(w).map(i => i.node);

test('a paired destination reached only when the partner is down is reported on its condition', () => {
  let w = s4sample();
  w = addFlat(w, 'a1', 'conditionBranch', {x: 0, y: 0}).workspace;
  const t = w.actions[0].flow.tests[0];
  Object.assign(t, {kind: 'actorStatus', option: 'ragdoll', subject: 'partner', pass: {action: 'a1'}});
  assert.deepEqual(checkFlows(w), []);
  const issues = validateWorkspace(w).filter(i => i.message.includes('0.12.217'));
  assert.deepEqual(
    issues.map(i => [i.level, i.node]),
    [['warning', 'flow:a1:' + t.id]]
  );
  assert.ok(issues[0].message.includes(w.actions[0].config.name));
  assert.ok(compileWorkspace(w), 'a warning never blocks the output');
  t.negate = true;
  assert.deepEqual(nodes(w), [], 'NOT ragdoll on the pass route can pair');
  t.fail = {action: 'a2'};
  assert.deepEqual(nodes(w), ['flow:a1:' + t.id], 'NOT ragdoll failing means a ragdolled partner');
  t.subject = 'self';
  assert.deepEqual(nodes(w), [], 'the initiator state does not gate the partner');
});

test('every unpairable partner state is covered, other states are not', () => {
  for (const option of ['ragdoll', 'recovering', 'child'])
    assert.equal(nodes(flow('A', [status('A', option, {pass: {action: 'P'}})])).length, 1, option);
  for (const option of ['bleedingOut', 'killmove', 'paired', 'staggered'])
    assert.equal(nodes(flow('A', [status('A', option, {pass: {action: 'P'}})])).length, 0, option);
  const alive = {id: 'A', kind: 'alive', subject: 'partner', minimum: 0, pass: {action: 'P'}, fail: {action: 'P'}};
  assert.deepEqual(unpairableRoutes(flow('A', [alive])).length, 1, 'only the dead (fail) route');
});

test('only a route to a paired action is reported', () => {
  assert.deepEqual(nodes(flow('A', [status('A', 'ragdoll', {pass: {action: 'N'}})])), []);
});

test('groups force the partner state only when every way through them does', () => {
  const group = (kind, operands, extra) => ({id: 'G', kind, operands, subject: 'self', minimum: 0, ...extra});
  const pass = {pass: {action: 'P'}},
    fail = {fail: {action: 'P'}};
  assert.equal(nodes(flow('G', [group('all', ['R', 'C'], pass), status('R', 'ragdoll'), combat('C')])).length, 1);
  assert.equal(nodes(flow('G', [group('any', ['R', 'C'], pass), status('R', 'ragdoll'), combat('C')])).length, 0);
  assert.equal(
    nodes(flow('G', [group('any', ['R', 'U'], pass), status('R', 'ragdoll'), status('U', 'recovering')])).length,
    1
  );
  assert.equal(nodes(flow('G', [group('all', ['R', 'C'], fail), status('R', 'ragdoll'), combat('C')])).length, 0);
  assert.equal(
    nodes(flow('G', [group('any', ['R', 'C'], fail), status('R', 'ragdoll', {negate: true}), combat('C')])).length,
    1,
    'OR false: NOT ragdoll is false'
  );
  const not = {id: 'X', kind: 'not', operands: ['R'], subject: 'self', minimum: 0, ...fail};
  assert.equal(nodes(flow('X', [not, status('R', 'ragdoll')])).length, 1, 'NOT group failing means ragdoll');
});

test('a forcing condition carries down the route to later conditions', () => {
  const w = flow('A', [
    status('A', 'ragdoll', {pass: {node: 'B'}}),
    combat('B', {pass: {action: 'P'}, fail: {action: 'N'}}),
  ]);
  assert.deepEqual(nodes(w), ['flow:L:A']);
  w.actions[0].flow.tests[0].pass = undefined;
  w.actions[0].flow.tests[0].fail = {node: 'B'};
  assert.deepEqual(nodes(w), [], 'the other route of the same condition can pair');
});
