import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, duplicateAction, validateWorkspace} from '../src/workspace.ts';
import {readFileSync} from 'node:fs';
import {readEditorBlock} from '../src/editorBlock.ts';
import {lowerGraph} from '../src/graph/document.ts';
import {addFlat} from '../src/graph/flat.ts';
import {addRow, removeRow} from '../src/graph/cardCommands.ts';
import {parseXml} from '../src/xml.ts';
import {groupRuleError} from '../src/cards.ts';

// Code review 2026-10-28 (AnimationInjector/docs/코드리뷰-2026-10-28.md), E-17 and E-18.

test('E-17: a row added on a True card and removed again gives True its destination back', () => {
  let w = emptyWorkspace();
  w = addFlat(w, '', 'playNode', {x: 0, y: 0}).workspace;
  w = addFlat(w, '', 'conditionCard', {x: 0, y: 0}).workspace;
  const uid = w.cards[0].uid;
  w.cards[0].true = {action: 'a1'};
  w = addRow(w, uid).workspace;
  assert.equal(w.cards[0].true, undefined);
  assert.deepEqual(w.cards[0].rows[0].to, {action: 'a1'});
  w = removeRow(w, uid, w.cards[0].rows[0].id);
  assert.deepEqual(w.cards[0].true, {action: 'a1'});
  assert.deepEqual(w.cards[0].rows, []);
  // With other rows left, the removed row simply goes and True stays away.
  w = addRow(w, uid).workspace;
  w = addRow(w, uid).workspace;
  const [first, second] = w.cards[0].rows;
  w = removeRow(w, uid, first.id);
  assert.equal(w.cards[0].true, undefined);
  assert.deepEqual(
    w.cards[0].rows.map(r => r.id),
    [second.id]
  );
});

test('E-18: a duplicated action keeps everything the original holds, under its own uid and Action ID', () => {
  let w = emptyWorkspace();
  w = addFlat(w, '', 'playNode', {x: 0, y: 0}).workspace;
  const a = w.actions[0];
  a.config.steps[0].clip = 'Animations/Test/A.hkx';
  a.enterBlendEnabled = false;
  a.exitBlendEnabled = false;
  a.cameraEnabled = true;
  a.camera = {reset: 'Camera_Reset', blend: 0.4};
  a.cancels = [
    {id: 'cancel1', to: 'MoveStart', open: {seconds: 0.2}, close: {seconds: 0.6}, buffered: true, blend: 0.15},
  ];
  a.clipWindows = {[a.config.steps[0].id]: {open: {seconds: 0.1}, close: {seconds: 0.5}}};
  a.view = 'first';
  const copy = duplicateAction(w, a, 'A copy');
  assert.notEqual(copy.uid, a.uid);
  assert.notEqual(copy.config.actionId, a.config.actionId);
  assert.ok(!w.actions.some(x => x.uid === copy.uid || x.config.actionId === copy.config.actionId));
  assert.equal(copy.config.name, 'A copy');
  assert.deepEqual(copy.position, {x: a.position.x + 45, y: a.position.y + 55});
  // Everything else is the original's, and a copy of it (editing one never edits the other).
  const strip = x => ({...x, uid: '', position: null, config: {...x.config, actionId: '', name: ''}});
  assert.deepEqual(strip(copy), strip(a));
  copy.cancels[0].blend = 0.9;
  assert.equal(a.cancels[0].blend, 0.15);
});

test('E-22: an XML declaration with standalone opens, as the runtime reads it', () => {
  assert.equal(
    parseXml('<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<AnimationSet/>').name,
    'AnimationSet'
  );
  assert.throws(() => parseXml('<?xml version="1.0" standalone="maybe"?><AnimationSet/>'));
});

test('E-24: the group rule counts conditions as the XML writes them (turned-off ones left out)', () => {
  const check = (id, extra = {}) => ({id, kind: 'sneaking', subject: 'self', minimum: 0, ...extra});
  const card = off => ({
    tests: [check('t1'), check('t2', off ? {enabled: false} : {}), {id: 'g', kind: 'any', operands: ['t1', 't2']}],
    guards: ['g'],
    rows: [],
  });
  assert.equal(groupRuleError(card(false)), undefined);
  assert.match(groupRuleError(card(true)), /둘 이상/);
});

// 10-28 report: Grapple's Pounding E QTE (QTE1) and its attack QTE (QTE3) both start on Grapple_Stage_Start_01 on
// channel 0, so the game skipped the E QTE every time. The editor now says so; channel 1 (as it was) clears it.
// The installed Grapple as it was (tests/fixtures/GrappleQte.xml, 10-27): QTE1 (E) and QTE3 (attack) both on channel 0.
test('two QTEs starting together on one channel are flagged', () => {
  const w = lowerGraph(readEditorBlock(readFileSync('tests/fixtures/GrappleQte.xml', 'utf8')).block.project);
  const clashes = () => validateWorkspace(w).filter(i => /같은 채널/.test(i.message));
  assert.equal(clashes().length, 1);
  assert.match(clashes()[0].message, /QTE3.*QTE1.*채널 0/);
  // Channel 1, as the installed file has it again: nothing to say.
  w.qtes.find(q => q.id === 'QTE1').channel = 1;
  assert.deepEqual(clashes(), []);
});
