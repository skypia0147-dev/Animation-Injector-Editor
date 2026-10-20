import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {parseWorkspace, emptyWorkspace} from '../src/workspace.ts';
import {packageNotices, packageProblems, request} from '../src/package.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseXml} from '../src/xml.ts';
import {t} from '../src/i18n/index.ts';

// A mod package is its XML and HKX files only (user decision 2026-09-30): no README, license or project,
// and no author or version, which only fed the README.
test('the request carries the XML and assets only', () => {
  const r = request(s4sample());
  assert.deepEqual(Object.keys(r).sort(), ['assets', 'folder', 'id', 'plugins', 'roots', 'xml']);
});

test('an older project drops the package fields that fed documents', () => {
  const old = JSON.parse(JSON.stringify(emptyWorkspace()));
  old.name = 'Old';
  Object.assign(old.packaging, {
    includeProject: true,
    author: 'Smooth',
    version: '1.0.0',
    license: 'mit',
    licenseText: '',
  });
  old.actions = s4sample().actions;
  const w = parseWorkspace(JSON.stringify(old));
  assert.deepEqual(Object.keys(w.packaging).sort(), ['folder', 'policies', 'roots']);
  // Any other field is still a shape error.
  assert.throws(() => parseWorkspace(JSON.stringify({...old, packaging: {...w.packaging, typo: 1}})));
});

test('a mod folder named outside ASCII is a notice (runtime 0.12.229 reads it), not an error', () => {
  const w = s4sample();
  assert.deepEqual(packageNotices(w), []);
  w.packaging.folder = '그래플 모드';
  assert.deepEqual(packageNotices(w), [t('export.folderAscii')]);
  assert.ok(!packageProblems(w).length);
});

test('import: External (removed in 0.12.238) is refused with its reason; a UTF-16 declaration is read', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="4" id="Ext"><External id="Other" type="action"/><Action id="A" clip="Animations\A.hkx"/></AnimationSet>`;
  assert.throws(() => importWorkspaceXml(xml), /External.*0\.12\.238/);
  const doc = parseXml('<?xml version="1.0" encoding="UTF-16"?><AnimationSet version="4" id="U"/>');
  assert.equal(doc.name, 'AnimationSet');
});
