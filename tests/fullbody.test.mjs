import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createProject, fullBodyGraph} from '../src/model.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, emptyWorkspace, addAction} from '../src/workspace.ts';
import {rows, remove, patch} from '../src/timeline/model.ts';
import {grappleXml, needsGrapple, checker, needsChecker} from './local.mjs';
const dir = resolve('tests/generated/fullbody');
mkdirSync(dir, {recursive: true});
function native(xml, name) {
  const file = resolve(dir, name + '.xml');
  writeFileSync(file, xml);
  const result = spawnSync(checker, [file], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
test('an ordinary action plays on the full-body route without naming a graph (format 4)', needsChecker, () => {
  const p = createProject();
  assert.deepEqual(p.graph, [fullBodyGraph]);
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config = p;
  w.actions.push(a);
  const xml = compileWorkspace(w);
  assert.doesNotMatch(xml, /graph=/);
  native(xml, 'single');
  assert.deepEqual(importWorkspaceXml(xml).actions[0].config.graph, [fullBodyGraph]);
});
test(
  'Grapple locked rotation survives XML and project roundtrip and removal',
  {skip: needsChecker.skip || needsGrapple.skip},
  () => {
    const path = grappleXml;
    let w = importWorkspaceXml(readFileSync(path, 'utf8'));
    w = parseWorkspace(JSON.stringify(w));
    const stages = w.actions.filter(a => a.config.rotationLocked);
    assert.equal(stages.length, 6);
    for (const a of stages) {
      const row = rows(w, a).find(r => r.id === 'rotate');
      assert.ok(row);
      assert.equal(row.until.basis, 'end');
      assert.equal(patch(w, a.uid, 'rotate', {from: {...row.from, seconds: 1}}), w);
      const removed = remove(w, a.uid, 'rotate');
      assert.equal(removed.actions.find(x => x.uid === a.uid).config.rotationLocked, false);
    }
    const xml = compileWorkspace(w);
    assert.equal((xml.match(/<Rotate locked="true"/g) || []).length, 6);
    native(xml, 'grapple');
    assert.equal(importWorkspaceXml(xml).actions.filter(a => a.config.rotationLocked).length, 6);
  }
);
