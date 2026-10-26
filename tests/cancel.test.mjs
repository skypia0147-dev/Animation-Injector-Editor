import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {patch, remove} from '../src/timeline/model.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {mark} from '../src/model.ts';
const xml =
  '<AnimationSet version="6" id="Test"><Inputs><Input id="use" key="LAlt"/></Inputs><Start input="use" to="Dodge"/><Action id="Dodge" clip="Animations\\Dodge.hkx" air="both" safety="0.7"><Vanilla id="cancel" to="Attack" from="0.35"/></Action></AnimationSet>';

test('vanilla cancel survives current XML import, export and project save without changing inherited blend', () => {
  const w = importWorkspaceXml(xml),
    expected = w.actions[0].cancels;
  for (const v of [1, 2]) {
    const output = compileWorkspace(w, v),
      r = importWorkspaceXml(output);
    assert.deepEqual(r.actions[0].cancels, expected);
    assert.equal(expected[0].blend, null);
    assert.ok(!validateWorkspace(r).some(i => i.level === 'error'));
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).actions[0].cancels, expected);
  assert.ok(flatGraph(w).nodes.some(n => n.notify === 'cancel:cancel'));
});
test('cancel timing edit, an event close and deletion affect executable XML', () => {
  let w = importWorkspaceXml(xml);
  w = patch(w, w.actions[0].uid, 'cancel:cancel', {from: mark(0.5)});
  w.actions[0].cancels[0].close = {...mark(0, 'event'), event: 'Close'};
  for (const v of [1, 2])
    assert.deepEqual(importWorkspaceXml(compileWorkspace(w, v)).actions[0].cancels, w.actions[0].cancels);
  w = remove(w, w.actions[0].uid, 'cancel:cancel');
  assert.ok(!compileWorkspace(w).includes('<Cancel'));
});
test('invalid cancel target, duplicate id and backwards timing are rejected', () => {
  for (const mutate of [
    w => (w.actions[0].cancels[0].to = 'vanilla:Typo'),
    w => w.actions[0].cancels.push(structuredClone(w.actions[0].cancels[0])),
    w => (w.actions[0].cancels[0].close = mark(0.1)),
  ]) {
    const w = importWorkspaceXml(xml);
    mutate(w);
    assert.throws(() => compileWorkspace(w));
  }
});
