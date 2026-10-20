import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {bodyHash, draftBody, isDraftBody, readEditorBlock, savedProject, withEditorBlock} from '../src/editorBlock.ts';
import {checker, needsChecker} from './local.mjs';

// One file, no .aiproj (10-03): the runtime XML carries the whole project in a comment the runtime skips.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="4" id="EditorBlock">
  <Action id="Roll" clip="Animations\\EditorBlock\\Roll.hkx">
    <Start key="G"/>
  </Action>
</AnimationSet>
`;
const saved = w => withEditorBlock(compileWorkspace(w), JSON.stringify(captureGraph(w)));

test('a saved XML restores its whole project while its runtime body is untouched', () => {
  const w = importWorkspaceXml(XML);
  w.actions[0].config.name = '구르기 -- 시험'; // a display name the XML does not hold, "--" included
  const text = saved(w);
  const block = text.slice(text.lastIndexOf('<!--'));
  assert.ok(!block.slice(4, -4).includes('--'), 'a comment may not hold "--"');
  const opened = savedProject(text);
  assert.equal(opened.stale, false);
  const restored = parseWorkspace(opened.project);
  assert.equal(restored.actions[0].config.name, '구르기 -- 시험');
  assert.equal(JSON.stringify(captureGraph(restored)), JSON.stringify(captureGraph(w)));
  // The runtime body is the compiled XML, and the editor's own XML reader skips the block.
  assert.equal(readEditorBlock(text).body.trimEnd(), compileWorkspace(w).trimEnd());
  assert.equal(compileWorkspace(importWorkspaceXml(text)), compileWorkspace(w));
});

test('line ends do not count; an edited body sets the block aside', () => {
  const w = importWorkspaceXml(XML);
  const text = saved(w);
  assert.ok(savedProject(text.replace(/\n/g, '\r\n')).project, 'CRLF from git or an editor is the same body');
  assert.equal(bodyHash(XML), bodyHash(XML.replace(/\n/g, '\r\n') + '\n\n'));
  const edited = savedProject(text.replace('key="G"', 'key="H"'));
  assert.equal(edited.stale, true);
  assert.equal(edited.project, undefined);
  assert.match(edited.body, /key="H"/);
});

test('no block, a broken one or another version opens from the XML', () => {
  assert.deepEqual(savedProject(XML), {body: XML, stale: false});
  const text = saved(importWorkspaceXml(XML));
  const broken = text.replace('"version":1', '"version":1,,');
  assert.equal(savedProject(broken).project, undefined);
  assert.equal(savedProject(broken).stale, false);
  assert.equal(savedProject(text.replace('"version":1', '"version":2')).project, undefined);
  // Text after the block (another comment or element) means it is not the editor's trailing block.
  assert.equal(readEditorBlock(text + '<!-- other -->\n').block, undefined);
});

test('the runtime reads an XML with the block as its body', needsChecker, () => {
  mkdirSync('tests/generated/editor-block', {recursive: true});
  const path = 'tests/generated/editor-block/EditorBlock.xml';
  writeFileSync(path, saved(importWorkspaceXml(XML)));
  execFileSync(checker, [path]);
  const plain = 'tests/generated/editor-block/Plain.xml';
  writeFileSync(plain, XML);
  execFileSync(checker, ['--compare', plain, path]);
});

test('a draft saves the project with an empty body the plugin skips, and opens as saved', needsChecker, () => {
  // Work saved while the project has errors (WorkspaceApp save): the game plays nothing from it.
  const project = JSON.stringify({name: 'Draft', actions: []});
  const body = draftBody('MyAnimationSet');
  assert.ok(isDraftBody(body));
  assert.equal(draftBody('bad id!'), draftBody('Draft'));
  assert.ok(!isDraftBody(XML));
  const text = withEditorBlock(body, project);
  assert.equal(savedProject(text).project, project);
  mkdirSync('tests/generated/editor-block', {recursive: true});
  const path = 'tests/generated/editor-block/Draft.xml';
  writeFileSync(path, text);
  // The plugin's parser rejects it as a whole (exit 2): nothing of a draft reaches the game.
  assert.throws(
    () => execFileSync(checker, [path], {stdio: 'pipe'}),
    e => e.status === 2
  );
});
