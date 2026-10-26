import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {parseWorkspace, emptyWorkspace} from '../src/workspace.ts';
import {packageNotices, packageProblems, request} from '../src/package.ts';
import {parseXml} from '../src/xml.ts';
import {t} from '../src/i18n/index.ts';

// A mod package is its XML, HKX and sound files only (user decision 2026-09-30, sounds 10-26): no README, license
// or project, and no author or version, which only fed the README.
test('the request carries the XML and assets only', () => {
  const r = request(s4sample());
  assert.deepEqual(Object.keys(r).sort(), ['assets', 'folder', 'id', 'plugins', 'roots', 'sounds', 'xml']);
});

test('a mod folder named outside ASCII is a notice (runtime 0.12.229 reads it), not an error', () => {
  const w = s4sample();
  assert.deepEqual(packageNotices(w), []);
  w.packaging.folder = '그래플 모드';
  assert.deepEqual(packageNotices(w), [t('export.folderAscii')]);
  assert.ok(!packageProblems(w).length);
});

test('import: a UTF-16 declaration is read', () => {
  const doc = parseXml('<?xml version="1.0" encoding="UTF-16"?><AnimationSet version="6" id="U"/>');
  assert.equal(doc.name, 'AnimationSet');
});
