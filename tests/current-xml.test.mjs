import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {request} from '../src/package.ts';
import {checker, needsChecker} from './local.mjs';
const out = resolve('tests/generated/current-xml');
mkdirSync(out, {recursive: true});
const check = (...args) => {
  const r = spawnSync(checker, args, {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
};

test(
  'current-format fixtures retain executable declarations across import, project save and export',
  needsChecker,
  () => {
    for (const name of ['Single', 'Directional', 'Event', 'Chain', 'Grapple', 'Connections']) {
      const fixture = resolve('tests/fixtures/current-xml', name + '.xml');
      const w = importWorkspaceXml(readFileSync(fixture, 'utf8'));
      const restored = parseWorkspace(JSON.stringify(captureGraph(w)));
      const xml = compileWorkspace(restored),
        destination = resolve(out, name + '.xml');
      writeFileSync(destination, xml);
      check('--compare', fixture, destination);
      assert.equal(request(restored).xml, xml);
      assert.equal(restored.xmlVersion, undefined);
    }
  }
);

test('Editor and runtime reject legacy and future XML without partially loading it', needsChecker, () => {
  const fixture = readFileSync('tests/fixtures/current-xml/Single.xml', 'utf8');
  for (const [name, xml] of [
    [
      'legacy',
      '<AnimationInjector version="1" mod="Old"><Action id="Old"><Clip file="Animations\\Old.hkx"/></Action></AnimationInjector>',
    ],
    ['future', fixture.replace('version="4"', 'version="99"')],
    ['missing-version', fixture.replace(' version="4"', '')],
  ]) {
    assert.throws(() => importWorkspaceXml(xml));
    const file = resolve(out, name + '.xml');
    writeFileSync(file, xml);
    check('--reject', file);
  }
});

test('retired output preference is removed from a saved graph without changing playback', () => {
  const w = importWorkspaceXml(readFileSync('tests/fixtures/current-xml/Connections.xml', 'utf8'));
  const old = captureGraph(w);
  old.meta.xmlVersion = 1;
  const restored = parseWorkspace(JSON.stringify(old));
  assert.equal(restored.xmlVersion, undefined);
  assert.equal(compileWorkspace(restored), compileWorkspace(w));
  assert.ok(!JSON.stringify(captureGraph(restored)).includes('xmlVersion'));
});

test('native equivalence checks detect a changed rotation lock', needsChecker, () => {
  const fixture = readFileSync('tests/fixtures/current-xml/Single.xml', 'utf8');
  const files = [false, true].map(locked => {
    const file = resolve(out, `rotation-${locked}.xml`);
    writeFileSync(file, fixture.replace('    <Attack', `    <Rotate locked="${locked}"/>\n    <Attack`));
    check(file);
    return file;
  });
  const r = spawnSync(checker, ['--compare', ...files], {encoding: 'utf8'});
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Semantic mismatch/);
});
