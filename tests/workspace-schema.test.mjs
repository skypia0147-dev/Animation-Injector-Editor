import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWorkspace} from '../src/workspace.ts';
import {savedProject} from '../src/editorBlock.ts';

// E-5: phases of parseWorkspace (check, normalize); only the current schema opens.
const grapple = () => savedProject(readFileSync('tests/fixtures/grapple-carry-qte-cuts.xml', 'utf8')).project;

test('only the current schema opens', () => {
  for (const schema of ['constructor', '__proto__', 'toString', '9', 8, 3.5, -1, null])
    assert.throws(
      () => parseWorkspace(JSON.stringify({schema, id: 'A', name: 'a', actions: [], links: []})),
      String(schema)
    );
});

test('the checks do not change a valid document: parsing twice gives the same result', () => {
  const once = parseWorkspace(grapple());
  assert.deepEqual(parseWorkspace(JSON.stringify(once)), once);
});
