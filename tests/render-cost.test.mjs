import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseWorkspace} from '../src/workspace.ts';
import {markerNames, markerUses, markerUseCounts} from '../src/ui/details/markerCatalog.ts';
import {authorReducer, captureGraph, lowerGraph} from '../src/graph/document.ts';
import {clone} from '../src/model.ts';
import {savedProject} from '../src/editorBlock.ts';
import {grappleXml} from './local.mjs';

// Stage 3 (E-4): cheaper render paths must give the same answers as the originals.
const projects = ['examples/S4Grapple.xml', 'examples/S5Packaging.xml', 'examples/S4Connections.xml', grappleXml]
  .filter(p => p && fs.existsSync(p))
  .map(p => [p, savedProject(fs.readFileSync(p, 'utf8')).project])
  .filter(([, project]) => project)
  .map(([p, project]) => [p, lowerGraph(captureGraph(parseWorkspace(project)))]);

test('marker use counts in one pass equal counting per marker name', () => {
  assert.ok(projects.length >= 3);
  for (const [path, w] of projects) {
    const expected = new Map(markerNames(w).map(name => [name, markerUses(w, name).length]));
    assert.deepEqual([...markerUseCounts(w)], [...expected], path);
  }
});

test('an edit with a pre-captured graph records the same history as capturing in the reducer', () => {
  for (const [path, w] of projects) {
    const start = authorReducer({present: captureGraph(w), past: [], future: []}, {type: 'adopt', next: w});
    const next = clone(w);
    next.actions[0].config.name += ' (edited)';
    const captured = authorReducer(start, {type: 'edit', next, graph: captureGraph(next)});
    const plain = authorReducer(start, {type: 'edit', next});
    assert.deepEqual(captured.present, plain.present, path);
    assert.equal(captured.past.length, 1, path);
    assert.equal(lowerGraph(captured.present).actions[0].config.name, next.actions[0].config.name, path);
  }
});
