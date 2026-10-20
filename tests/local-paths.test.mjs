import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readEditorBlock, savedProject, withEditorBlock} from '../src/editorBlock.ts';
import {localProject, shareableProject, splitLocalPaths} from '../src/localPaths.ts';
import {parseWorkspace} from '../src/workspace.ts';

// The editor block ships with the mod: it must hold no local paths, and this computer gets them back on open.
const memory = new Map();
globalThis.localStorage = {
  getItem: k => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: k => memory.delete(k),
  clear: () => memory.clear(),
};
const absolute = /"(?:[A-Za-z]:\\\\|[A-Za-z]:\/|\\\\\\\\)/;
// A user's Grapple save: 22 HKX sources under D:\Mods\Grapple.
const fixture = readFileSync('tests/fixtures/grapple-carry-qte-cuts.xml', 'utf8');
const {body, block} = readEditorBlock(fixture);
const project = JSON.stringify(block.project);

test('a saved block holds no local path and this computer restores every one', () => {
  memory.clear();
  assert.match(project, absolute);
  const text = withEditorBlock(body, shareableProject(project));
  assert.doesNotMatch(readEditorBlock(text).block ? JSON.stringify(readEditorBlock(text).block.project) : '', absolute);
  assert.doesNotMatch(text, /D:\\\\Mods/);
  const opened = savedProject(text).project;
  assert.equal(localProject(opened), project);
  parseWorkspace(localProject(opened));
});

test('on another computer the block opens with empty paths', () => {
  memory.clear();
  const text = withEditorBlock(body, shareableProject(project));
  memory.clear();
  const opened = localProject(savedProject(text).project);
  assert.doesNotMatch(opened, absolute);
  parseWorkspace(opened);
});

test('only absolute local paths are emptied, and only back into the slots they left', () => {
  const {shared, local} = splitLocalPaths({
    a: 'C:\\Data\\me\\x.hkx',
    b: 'Animations\\x.hkx',
    'c/d': ['\\\\server\\share\\y.hkx', 'D:/mods/z.hkx'],
  });
  assert.deepEqual(shared, {a: '', b: 'Animations\\x.hkx', 'c/d': ['', '']});
  assert.deepEqual(Object.keys(local).sort(), ['/a', '/c~1d/0', '/c~1d/1']);
});
