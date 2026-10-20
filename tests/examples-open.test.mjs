import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {savedProject} from '../src/editorBlock.ts';
import {parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseTemplate} from '../src/templates.ts';

// tools/package.mjs ships every file in examples/. Each must open the way File > Open reads it
// (WorkspaceApp loadDocument) and compile: an example the editor refuses is the first thing a new user meets.
test('every shipped example opens and compiles', () => {
  const files = readdirSync('examples').filter(f => /\.(xml|aitemplate)$/i.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync('examples/' + file, 'utf8');
    let w;
    if (file.endsWith('.aitemplate')) w = parseTemplate(text);
    else {
      const saved = savedProject(text);
      w = saved.project ? parseWorkspace(saved.project) : importWorkspaceXml(saved.body);
    }
    assert.ok(w.actions.length > 0, file);
    assert.match(compileWorkspace(w), /<AnimationSet version="4"/, file);
  }
});
