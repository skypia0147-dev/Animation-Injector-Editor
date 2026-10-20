import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {flatGraph, connectFlat} from '../src/graph/flat.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {
  groupConditions,
  tableProjection,
  reorderRow,
  addTableRow,
  removeTableRow,
} from '../src/graph/conditionTables.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
function sample() {
  const w = s4sample(),
    a = w.actions[0],
    b = w.actions[1];
  a.flow = {
    entry: 'Air',
    tests: [
      {id: 'Air', kind: 'air', subject: 'self', minimum: 0, pass: {action: b.uid}, fail: {node: 'Alive'}},
      {id: 'Alive', kind: 'alive', subject: 'self', minimum: 0, pass: {action: a.uid}, fail: {action: b.uid}},
    ],
  };
  return w;
}
test('table grouping preserves XML and project metadata; projection retains pin endpoints', () => {
  const w = sample(),
    n = groupConditions(w),
    raw = compactGraph(n, flatGraph(n)),
    before = JSON.stringify(raw),
    g = tableProjection(n, raw);
  assert.equal(compileWorkspace(n), compileWorkspace(w));
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(n))).conditionTables, n.conditionTables);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(g.nodes.filter(n => n.kind === 'conditionTable').length, 1);
  assert.ok(!g.nodes.some(n => n.id.startsWith('flow:')));
  for (const e of g.edges) {
    assert.ok(g.nodes.find(n => n.id === e.source)?.outputs.includes(e.pin));
    assert.ok(g.nodes.find(n => n.id === e.target)?.inputs.includes(e.targetPin ?? e.pin));
  }
});
test('table output connection modifies the exact original rule', () => {
  const w = groupConditions(sample()),
    a = w.actions[0],
    target = flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay');
  const n = connectFlat(w, 'conditionTable:' + a.uid, target.id, 'choice:Air:pass');
  assert.deepEqual(n.actions[0].flow.tests[0].pass, {action: a.uid});
  assert.deepEqual(n.actions[0].flow.tests[0].fail, w.actions[0].flow.tests[0].fail);
});
test('priority reorder preserves default; add and remove preserve existing candidates', () => {
  const w = sample(),
    owner = w.actions[0].uid,
    n = reorderRow(w, owner, 'Air', 1);
  assert.equal(n.actions[0].flow.entry, 'Alive');
  assert.deepEqual(n.actions[0].flow.tests.find(t => t.id === 'Air').fail, {action: w.actions[1].uid});
  const added = addTableRow(w, owner),
    key = added.actions[0].flow.entry;
  assert.deepEqual(removeTableRow(added, owner, key).actions[0].flow, w.actions[0].flow);
});
test('complex routes remain unchanged and cannot be reordered as a priority list', () => {
  const w = sample();
  w.actions[0].flow.tests[0].pass = {node: 'Alive'};
  assert.throws(() => reorderRow(w, w.actions[0].uid, 'Air', 1));
  assert.deepEqual(groupConditions(w).actions[0].flow, w.actions[0].flow);
});
