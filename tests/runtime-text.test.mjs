import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runtimeText} from '../src/runtimeText.ts';
import {getLanguage, setLanguage} from '../src/i18n/index.ts';
import {checker, needsChecker} from './local.mjs';

// The bundled runtime checker writes its findings in Korean (the plugin's own log words); the editor shows them in
// the UI language by swapping the known pieces (tools/i18n-runtime.mjs). Real checker output, English UI.
const head = '<?xml version="1.0" encoding="utf-8"?>\n';
const cases = {
  empty: '<AnimationSet version="6" id="A"/>',
  version: '<AnimationSet version="5" id="A"/>',
  attribute: '<AnimationSet version="6" id="A"><Action id="X" clip="Animations\\a.hkx" foo="1"/></AnimationSet>',
  boolean:
    '<AnimationSet version="6" id="A"><Start key="G" onKeyUp="maybe" to="X"/><Action id="X" clip="Animations\\a.hkx"/></AnimationSet>',
  inside:
    '<AnimationSet version="6" id="A"><Action id="X" clip="Animations\\a.hkx"><Start key="G"/></Action></AnimationSet>',
  cardBlend:
    '<AnimationSet version="6" id="A"><Start key="G" to="F"/><Action id="F" clip="Animations\\a.hkx"><Transition key="H" blend="0.3"><Row to="S"><Check kind="blocking"/></Row></Transition></Action>' +
    '<Action id="S" clip="Animations\\b.hkx"/></AnimationSet>',
  playsNothing:
    '<AnimationSet version="6" id="A"><Start key="G"><True/></Start><Action id="S" clip="Animations\\b.hkx"/></AnimationSet>',
};

test('runtime checker findings show without Korean in the English UI', needsChecker, () => {
  mkdirSync('tests/generated/runtime-text', {recursive: true});
  const before = getLanguage();
  setLanguage('en');
  try {
    for (const [name, body] of Object.entries(cases)) {
      const path = `tests/generated/runtime-text/${name}.xml`;
      writeFileSync(path, head + body);
      const out = JSON.parse(spawnSync(checker, ['--json', path], {encoding: 'utf8'}).stdout);
      const messages = [...out.errors, ...out.warnings];
      assert.ok(messages.length, name);
      for (const message of messages) {
        assert.match(message, /[\uac00-\ud7a3]/, `${name}: the checker writes Korean`);
        assert.doesNotMatch(runtimeText(message), /[\uac00-\ud7a3]/, `${name}: ${runtimeText(message)}`);
      }
    }
  } finally {
    setLanguage(before);
  }
  setLanguage('ko');
  assert.equal(runtimeText("알 수 없는 속성 'foo'"), "알 수 없는 속성 'foo'");
  setLanguage(before);
});
