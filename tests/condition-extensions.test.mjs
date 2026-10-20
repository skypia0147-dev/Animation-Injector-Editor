import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checkFlows} from '../src/graph/conditions.ts';
import {
  extensionKinds,
  definition,
  extensionDefaults,
  extensionError,
  extensionSummary,
} from '../src/graph/conditionExtensions.ts';
import {readExpression, editExpression} from '../src/graph/conditionExpression.ts';
import {checker, needsChecker} from './local.mjs';
function sample(kind) {
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 0, y: 0}).workspace;
  const t = w.actions[0].flow.tests[0];
  Object.assign(t, {kind, subject: 'partner', ...extensionDefaults(kind)});
  if (definition(kind)?.form) t.form = {plugin: 'Test.esp', id: '123'};
  return w;
}
for (const kind of extensionKinds)
  test(`extended condition ${kind}: project, NOT, XML and runtime parser round trip`, needsChecker, () => {
    const w = sample(kind),
      t = w.actions[0].flow.tests[0];
    t.negate = true;
    assert.deepEqual(checkFlows(w), []);
    const saved = parseWorkspace(JSON.stringify(captureGraph(w)));
    assert.deepEqual(saved.actions[0].flow, w.actions[0].flow);
    const xml = compileWorkspace(w),
      restored = importWorkspaceXml(xml);
    assert.equal(compileWorkspace(restored), xml);
    assert.ok(extensionSummary(t).includes('상대'));
    const expression = readExpression(w.actions[0].flow, t.id);
    const wrapped = editExpression(w, w.actions[0].uid, {type: 'wrap', id: t.id, mode: 'all'});
    const added = editExpression(wrapped, w.actions[0].uid, {type: 'add', parent: t.id, expression});
    assert.deepEqual(checkFlows(added), []);
    mkdirSync('tests/generated/condition-extensions', {recursive: true});
    const path = `tests/generated/condition-extensions/${kind}.xml`;
    writeFileSync(path, xml);
    execFileSync(checker, [path]);
  });
test('resource units, comparisons and ranges reject invalid values', () => {
  const w = sample('resource'),
    t = w.actions[0].flow.tests[0];
  for (const option of ['health', 'stamina', 'magicka'])
    for (const measure of ['current', 'percent'])
      for (const compare of ['lt', 'le', 'eq', 'ge', 'gt', 'range']) {
        Object.assign(t, {option, measure, compare, value: 20, upper: 30});
        const xml = compileWorkspace(w);
        assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
      }
  Object.assign(t, {measure: 'percent', value: 101});
  assert.ok(extensionError(t));
  Object.assign(t, {value: 20, upper: 10});
  assert.ok(extensionError(t));
  Object.assign(t, {value: NaN});
  assert.ok(extensionError(t));
});
test('unknown rigs, missing options and irrelevant XML attributes are rejected', () => {
  const w = sample('rig'),
    t = w.actions[0].flow.tests[0];
  t.option = 'unknown';
  assert.ok(checkFlows(w).length);
  t.option = 'chicken';
  const xml = compileWorkspace(w);
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', 'option="unrecognized"')));
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', '')));
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', 'option="chicken" value="20"')));
  const chance = sample('chance');
  chance.actions[0].flow.tests[0].value = 101;
  assert.ok(checkFlows(chance).length);
});
