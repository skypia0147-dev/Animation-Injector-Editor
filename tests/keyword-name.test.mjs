import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {newCard, newStart} from '../src/cards.ts';
import {extensionDefaults, extensionSummary} from '../src/graph/conditionExtensions.ts';
import {vanillaKeywords} from '../src/vanillaKeywords.ts';
import {checker, needsChecker} from './local.mjs';

// Keyword checks named by editor ID (runtime keyword=, 10-30), as OAR names them: the default for a new check.
function keywordCheck(kind, test) {
  const w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].config.actionId = 'ClawAttack';
  const t = {id: 'Condition1', kind, subject: 'self', minimum: 0, ...extensionDefaults(kind), ...test};
  const card = {...newCard(w, {x: 0, y: 0}), tests: [t], guards: [t.id], true: {action: w.actions[0].uid}};
  w.cards.push(card);
  w.starts.push({...newStart(w, {x: 0, y: 0}, 'event'), event: 'attackStart', to: {card: card.uid}});
  return w;
}
const errors = w => cardIssues(w).filter(i => i.level === 'error');

test(
  'a new keyword check asks for a name; the name is written and read back as the runtime reads it',
  needsChecker,
  () => {
    assert.deepEqual(extensionDefaults('equippedKeyword'), {option: 'left', keyword: ''});
    assert.notDeepEqual(errors(keywordCheck('equippedKeyword', {})), []);
    const w = keywordCheck('equippedKeyword', {option: 'right', keyword: 'WeapTypeClaw'});
    assert.deepEqual(errors(w), []);
    const xml = compileWorkspace(w);
    assert.match(xml, /<Check kind="equippedKeyword" option="right" keyword="WeapTypeClaw"\/>/);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
    assert.equal(extensionSummary(w.cards[0].tests[0]), '본인 / 장비 키워드 / 오른손 / WeapTypeClaw');
    mkdirSync('tests/generated/keyword-name', {recursive: true});
    writeFileSync('tests/generated/keyword-name/name.xml', xml);
    execFileSync(checker, ['tests/generated/keyword-name/name.xml']);
  }
);

test('by plugin and form still works for every keyword check', needsChecker, () => {
  for (const kind of ['equippedKeyword', 'wornKeyword', 'keyword']) {
    const w = keywordCheck(kind, {keyword: undefined, form: {plugin: 'Skyrim.esm', id: '1E711'}});
    assert.deepEqual(errors(w), [], kind);
    const xml = compileWorkspace(w);
    assert.match(xml, /plugin="Skyrim.esm" form="1E711"/);
    assert.doesNotMatch(xml, /keyword=/);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
    writeFileSync(`tests/generated/keyword-name/${kind}.xml`, xml);
    execFileSync(checker, [`tests/generated/keyword-name/${kind}.xml`]);
  }
});

test('a name with a space is an error; keyword= is one or the other, and only on keyword checks', () => {
  assert.notDeepEqual(errors(keywordCheck('wornKeyword', {keyword: 'Armor Heavy'})), []);
  const xml = compileWorkspace(keywordCheck('wornKeyword', {keyword: 'ArmorHeavy'}));
  assert.match(xml, /<Check kind="wornKeyword" keyword="ArmorHeavy"\/>/);
  assert.throws(() =>
    importWorkspaceXml(xml.replace('keyword="ArmorHeavy"', 'keyword="ArmorHeavy" plugin="Skyrim.esm" form="6BBD2"'))
  );
  assert.throws(() => importWorkspaceXml(xml.replace('kind="wornKeyword"', 'kind="perk"')));
  assert.throws(() => importWorkspaceXml(xml.replace('keyword="ArmorHeavy"', 'keyword=""')));
});

test('the vanilla keyword list: the base game names, once each', () => {
  for (const name of ['WeapTypeSword', 'WeapTypeWarAxe', 'ArmorHeavy', 'ArmorShield', 'ActorTypeNPC'])
    assert.ok(vanillaKeywords.includes(name), name);
  assert.equal(new Set(vanillaKeywords.map(n => n.toLowerCase())).size, vanillaKeywords.length);
  assert.ok(vanillaKeywords.every(n => /^[\x21-\x7e]+$/.test(n)));
});
