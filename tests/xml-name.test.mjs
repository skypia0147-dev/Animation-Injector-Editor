import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xmlFileName, xmlSavePath} from '../src/package.ts';
import {emptyWorkspace} from '../src/workspace.ts';

test('exported XML is named after the mod folder, like the mod package', () => {
  assert.equal(xmlFileName('My Animation Mod'), 'My Animation Mod.xml');
  assert.equal(xmlFileName('그래플 모드'), '그래플 모드.xml');
  assert.equal(xmlFileName(emptyWorkspace().packaging.folder), 'My Animation Mod.xml');
  // A name the mod package would refuse never becomes a file name.
  for (const bad of ['', '  ', 'a/b', 'CON', 'bad.', 'x:y'])
    assert.equal(xmlFileName(bad), 'AnimationInjector.xml', bad);
});

test('the XML save keeps the last folder but follows the current mod name', () => {
  assert.equal(xmlSavePath('Grapple'), 'Grapple.xml');
  assert.equal(
    xmlSavePath('Grapple', 'H:\\mods\\Grapple\\SKSE\\Plugins\\AnimationInjector\\Grapple\\AnimationInjector.xml'),
    'H:\\mods\\Grapple\\SKSE\\Plugins\\AnimationInjector\\Grapple\\Grapple.xml'
  );
  assert.equal(xmlSavePath('New Name', 'C:/out/Old Name.xml'), 'C:/out/New Name.xml');
});
