import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runtimeText} from '../src/runtimeText.ts';
import {getLanguage, setLanguage} from '../src/i18n/index.ts';
import {checker, needsChecker} from './local.mjs';

// The bundled runtime checker writes its findings in English (the plugin's own log words, 11-24); the editor shows
// them in the UI language by swapping the known pieces (tools/i18n-runtime.mjs). Real checker output.
const head = '<?xml version="1.0" encoding="utf-8"?>\n';
const cases = {
  empty: '<AnimationSet version="6" id="A"/>',
  version: '<AnimationSet version="5" id="A"/>',
  attribute: '<AnimationSet version="6" id="A"><Action id="X" clip="Animations\\a.hkx" foo="1"/></AnimationSet>',
  boolean:
    '<AnimationSet version="6" id="A"><Start key="G" to="X"/><Action id="X" clip="Animations\\a.hkx"><Transition key="H" to="X" buffer="maybe"/></Action></AnimationSet>',
  inside:
    '<AnimationSet version="6" id="A"><Action id="X" clip="Animations\\a.hkx"><Start key="G"/></Action></AnimationSet>',
  cardBlend:
    '<AnimationSet version="6" id="A"><Start key="G" to="F"/><Action id="F" clip="Animations\\a.hkx"><Transition key="H" blend="0.3"><Row to="S"><Check kind="actorStatus" option="blocking"/></Row></Transition></Action>' +
    '<Action id="S" clip="Animations\\b.hkx"/></AnimationSet>',
  playsNothing:
    '<AnimationSet version="6" id="A"><Start key="G"><True/></Start><Action id="S" clip="Animations\\b.hkx"/></AnimationSet>',
  // <Locomotion> (runtime 1.0.9): a set the runtime does not know, and the locomotion file holding an action too.
  locomotionSet: '<AnimationSet version="6" id="A"><Locomotion><Except set="Nope"/></Locomotion></AnimationSet>',
  locomotionMixed:
    '<AnimationSet version="6" id="A"><Locomotion/><Action id="X" clip="Animations\\a.hkx"/></AnimationSet>',
};

test('runtime checker findings show in the UI language', needsChecker, () => {
  mkdirSync('tests/generated/runtime-text', {recursive: true});
  const before = getLanguage();
  try {
    for (const [name, body] of Object.entries(cases)) {
      const path = `tests/generated/runtime-text/${name}.xml`;
      writeFileSync(path, head + body);
      const out = JSON.parse(spawnSync(checker, ['--json', path], {encoding: 'utf8'}).stdout);
      const messages = [...out.errors, ...out.warnings];
      assert.ok(messages.length, name);
      for (const message of messages) {
        assert.doesNotMatch(message, /[\uac00-\ud7a3]/, `${name}: the checker writes English: ${message}`);
        setLanguage('en');
        assert.equal(runtimeText(message), message, name);
        setLanguage('ko');
        assert.match(runtimeText(message), /[\uac00-\ud7a3]/, `${name}: ${runtimeText(message)}`);
      }
    }
  } finally {
    setLanguage(before);
  }
  setLanguage('ko');
  assert.equal(runtimeText("Unknown attribute 'foo'"), "알 수 없는 속성 'foo'");
  // A piece swaps as whole words only: an action id holding one stays as it is.
  const named = runtimeText("/AnimationSet/Action [MyAction]: Unknown attribute 'Action'");
  assert.match(named, /\[MyAction\]/);
  assert.doesNotMatch(named, /\/Action /);
  setLanguage(before);
});
