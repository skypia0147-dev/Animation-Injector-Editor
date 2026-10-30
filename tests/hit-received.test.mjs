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
import {checker, needsChecker} from './local.mjs';

// The last weapon hit taken (runtime hitReceived, 10-29): a blocked hit's start picks its clip by the attack.
function blockHit(test) {
  const w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].config.actionId = 'HeavyBlockHit';
  const t = {
    id: 'Condition1',
    kind: 'hitReceived',
    subject: 'self',
    minimum: 0,
    ...extensionDefaults('hitReceived'),
    ...test,
  };
  const card = {...newCard(w, {x: 0, y: 0}), tests: [t], guards: [t.id], true: {action: w.actions[0].uid}};
  w.cards.push(card);
  w.starts.push({...newStart(w, {x: 0, y: 0}, 'event'), event: 'blockHitStart', to: {card: card.uid}});
  return w;
}
const errors = w => cardIssues(w).filter(i => i.level === 'error');

test(
  'a power attack within half a second by default, written and read back as the runtime reads it',
  needsChecker,
  () => {
    const w = blockHit({});
    assert.deepEqual(errors(w), []);
    const xml = compileWorkspace(w);
    assert.match(xml, /<Check kind="hitReceived" option="power" within="0.5"\/>/);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
    assert.equal(extensionSummary(w.cards[0].tests[0]), '본인 / 받은 공격 / 파워어택 / 0.5초 안');
    mkdirSync('tests/generated/hit-received', {recursive: true});
    writeFileSync('tests/generated/hit-received/power.xml', xml);
    execFileSync(checker, ['tests/generated/hit-received/power.xml']);
  }
);

test('several kinds, no time limit, the partner', needsChecker, () => {
  const w = blockHit({option: 'power,bash', within: undefined, subject: 'partner'});
  assert.deepEqual(errors(w), []);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Check kind="hitReceived" subject="partner" option="power,bash"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  writeFileSync('tests/generated/hit-received/list.xml', xml);
  execFileSync(checker, ['tests/generated/hit-received/list.xml']);
});

test('a kind not offered or a time out of range is an error; within belongs to this check', () => {
  assert.notDeepEqual(errors(blockHit({option: 'heavy'})), []);
  assert.notDeepEqual(errors(blockHit({within: 700})), []);
  const xml = compileWorkspace(blockHit({}));
  assert.throws(() =>
    importWorkspaceXml(xml.replace('kind="hitReceived" option="power"', 'kind="weather" option="rainy"'))
  );
  assert.throws(() => importWorkspaceXml(xml.replace('option="power"', 'option="heavy"')));
});
