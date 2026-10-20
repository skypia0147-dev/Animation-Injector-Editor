import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWorkspace, WORKSPACE_SCHEMA} from '../src/workspace.ts';
import {savedProject} from '../src/editorBlock.ts';

// E-5: phases of parseWorkspace (migrate, fill later fields, check, normalize).
const grapple = () => savedProject(readFileSync('examples/S4Grapple.xml', 'utf8')).project;
const current = () => JSON.parse(JSON.stringify(parseWorkspace(grapple())));

test('schema values that are not migration steps never select one', () => {
  for (const schema of ['constructor', '__proto__', 'toString', '3', 3.5, -1, null])
    assert.throws(
      () => parseWorkspace(JSON.stringify({schema, id: 'A', name: 'a', actions: [], links: []})),
      String(schema)
    );
});

test('a schema 3 project walks every migration step to the current schema', () => {
  const w = parseWorkspace(JSON.stringify({schema: 3, id: 'Old', name: 'old', actions: [], links: []}));
  assert.equal(w.schema, WORKSPACE_SCHEMA);
  assert.deepEqual(w.layout, {});
  assert.deepEqual(w.sharedInputs, []);
  assert.deepEqual(w.assets, []);
  assert.equal(typeof w.packaging.folder, 'string');
  assert.deepEqual(w.globals, {cameraReset: ''}); // inferredCamera of no actions (schema 4 -> 5 step)
});

test('fields added within schema 7 get their defaults when a file predates them', () => {
  const doc = current();
  assert.ok(
    doc.actions.some(a => a.pair),
    'fixture has a pair'
  );
  delete doc.assets;
  for (const a of doc.actions) {
    delete a.cancels;
    if (a.pair) {
      delete a.pair.targetRig;
      a.pair.keepRootPosition = true; // the per-pair end position of older projects (gone since 0.12.255)
    }
  }
  const w = parseWorkspace(JSON.stringify(doc));
  assert.deepEqual(w.assets, []);
  for (const a of w.actions) {
    assert.deepEqual(a.cancels, []);
    if (a.pair) {
      assert.equal(a.pair.targetRig, 'character');
      assert.equal('keepRootPosition' in a.pair, false);
    }
  }
});

test('the checks do not change a valid document: parsing twice gives the same result', () => {
  const once = parseWorkspace(grapple());
  assert.deepEqual(parseWorkspace(JSON.stringify(once)), once);
});
