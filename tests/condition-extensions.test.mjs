import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {newCard, newStart} from '../src/cards.ts';
import {
  extensionKinds,
  definition,
  extensionDefaults,
  extensionError,
  extensionSummary,
  subjectlessKinds,
} from '../src/graph/conditionExtensions.ts';
import {readExpression, editExpression} from '../src/graph/conditionExpression.ts';
import {multiValueField} from '../src/graph/multiValue.ts';
import {checker, needsChecker} from './local.mjs';
// Errors of the project's condition cards (cardChecks.ts).
const cardErrors = w => cardIssues(w).filter(i => i.level === 'error');
/** An HKX whose start goes through a card with one condition of `kind` (the partner's), True to the HKX. */
function sample(kind) {
  const w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].config.actionId = 'test';
  // A roll, the world, the movement keys: no partner target.
  const subject = subjectlessKinds.includes(kind) ? 'self' : 'partner';
  const t = {id: 'Condition1', kind, subject, minimum: 0, ...extensionDefaults(kind)};
  // A keyword check names its keyword by editor ID (the default, runtime keyword=); the other forms by plugin and form.
  if (t.keyword !== undefined) t.keyword = 'TestKeyword';
  else if (definition(kind)?.form) t.form = {plugin: 'Test.esp', id: '123'};
  // The last action the subject finished names one of the project's (runtime 0.12.296).
  if (kind === 'previousAction') Object.assign(t, {actions: [w.actions[0].uid], within: 1.5, ended: 'completed'});
  const card = {...newCard(w, {x: 0, y: 0}), tests: [t], guards: [t.id], true: {action: w.actions[0].uid}};
  w.cards.push(card);
  w.starts.push({...newStart(w, {x: 0, y: 0}), key: 'G', to: {card: card.uid}});
  return w;
}
const testOf = w => w.cards[0].tests[0];
for (const kind of extensionKinds)
  test(`extended condition ${kind}: project, NOT, XML and runtime parser round trip`, needsChecker, () => {
    const w = sample(kind),
      t = testOf(w);
    t.negate = true;
    // A value list where the condition takes one (runtime 0.12.301): any of them holds.
    if (multiValueField[kind] === 'option')
      t.option = definition(kind)
        .choices.slice(0, 2)
        .map(([v]) => v)
        .join(',');
    assert.deepEqual(cardErrors(w), []);
    const saved = parseWorkspace(JSON.stringify(captureGraph(w)));
    assert.deepEqual(saved.cards, w.cards);
    const xml = compileWorkspace(w),
      restored = importWorkspaceXml(xml);
    assert.equal(compileWorkspace(restored), xml);
    assert.ok(extensionSummary(t).includes(t.subject === 'partner' ? '상대' : '본인'));
    const card = w.cards[0];
    const expression = readExpression(card, t.id);
    // A group among AND conditions is an OR (runtime 0.12.301: one level, the opposite operator).
    const wrapped = editExpression(w, card.uid, {type: 'wrap', id: t.id, mode: 'any'});
    const added = editExpression(wrapped, card.uid, {type: 'add', parent: t.id, expression});
    assert.deepEqual(cardErrors(added), []);
    mkdirSync('tests/generated/condition-extensions', {recursive: true});
    const path = `tests/generated/condition-extensions/${kind}.xml`;
    writeFileSync(path, xml);
    execFileSync(checker, [path]);
  });
test('a condition that is the same whoever is asked takes no target', needsChecker, () => {
  const kinds = extensionKinds.filter(k => subjectlessKinds.includes(k));
  assert.deepEqual(new Set(kinds), new Set(['chance', 'gameHour', 'weather', 'movementDirection']));
  for (const kind of kinds) {
    const w = sample(kind),
      xml = compileWorkspace(w);
    assert.ok(!xml.includes('subject='), kind);
    // The editor and the runtime both refuse a partner target.
    const partner = xml.replace(`kind="${kind}"`, `kind="${kind}" subject="partner"`);
    assert.notEqual(partner, xml);
    assert.throws(() => importWorkspaceXml(partner), kind);
    const path = `tests/generated/condition-extensions/${kind}-partner.xml`;
    writeFileSync(path, partner);
    assert.throws(() => execFileSync(checker, [path], {stdio: 'pipe'}), kind);
    // A target a project kept from the condition's previous kind is the actor itself once opened.
    testOf(w).subject = 'partner';
    assert.ok(cardErrors(w).length, kind);
    const opened = parseWorkspace(JSON.stringify(captureGraph(w)));
    assert.equal(testOf(opened).subject, 'self', kind);
    assert.deepEqual(cardErrors(opened), [], kind);
  }
});
test('resource units, comparisons and ranges reject invalid values', () => {
  const w = sample('resource'),
    t = testOf(w);
  for (const option of ['health', 'stamina', 'magicka'])
    for (const measure of ['current', 'percent'])
      for (const compare of ['lt', 'le', 'eq', 'ge', 'gt', 'range']) {
        Object.assign(t, {option, measure, compare, value: 20, upper: 30});
        const xml = compileWorkspace(w);
        assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
      }
  Object.assign(t, {measure: 'percent', value: 101});
  assert.ok(extensionError(t));
  Object.assign(t, {value: 20, upper: 10});
  assert.ok(extensionError(t));
  Object.assign(t, {value: NaN});
  assert.ok(extensionError(t));
});
test('unknown rigs, missing options and irrelevant XML attributes are rejected', () => {
  const w = sample('rig'),
    t = testOf(w);
  t.option = 'unknown';
  assert.ok(cardErrors(w).length);
  t.option = 'chicken';
  const xml = compileWorkspace(w);
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', 'option="unrecognized"')));
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', '')));
  assert.throws(() => importWorkspaceXml(xml.replace('option="chicken"', 'option="chicken" value="20"')));
  const chance = sample('chance');
  testOf(chance).value = 101;
  assert.ok(cardErrors(chance).length);
});
