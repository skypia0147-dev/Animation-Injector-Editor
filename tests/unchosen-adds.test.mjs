import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {addFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {addFunction, functionErrors, unchosen} from '../src/eventRegistry.ts';
import {add as addMoment} from '../src/timeline/model.ts';
import {s4sample} from './fixtures/s4sample.ts';

// What the user adds chooses nothing for them (11-02, after the empty conditions): the choices are left empty and
// each is an error until made; numbers keep their values. A file's values left out stay the runtime's defaults.
const errors = w => validateWorkspace(w).filter(i => i.level === 'error');
const has = (w, message) => errors(w).some(i => i.message.endsWith(message));

test('a new key start has no key and no press; an event start presses nothing', () => {
  let w = addFlat(emptyWorkspace(), '', 'keyInput', {x: 0, y: 0}).workspace;
  const s = w.starts[0];
  assert.equal(s.key, '');
  assert.equal(s.press, '');
  assert.ok(has(w, '누름 방식을 선택하세요.'));
  assert.ok(has(w, '시작 키 또는 패드 버튼을 지정하세요.'));
  // A work in progress saves and opens again.
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).starts, w.starts);
  w = addFlat(emptyWorkspace(), '', 'markerReceive', {x: 0, y: 0}).workspace;
  assert.equal(w.starts[0].press, 'down');
});

test('a new QTE has no kind, key or anchor, and opens again as it is', () => {
  const w = addFlat(s4sample(), '', 'qte', {x: 0, y: 0}).workspace,
    q = w.qtes.at(-1);
  // On an HKX, as 「QTE 추가」 of its card puts it (a QTE on nothing is not checked or written).
  q.owner = w.actions[0].uid;
  q.step = w.actions[0].config.entry;
  assert.equal(q.type, '');
  assert.equal(q.key, '');
  assert.equal(q.anchor, '');
  for (const m of ['QTE 유형을 선택하세요.', 'QTE 기준점을 선택하세요.', '입력 키를 지정하세요.'])
    assert.ok(has(w, m), m);
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).qtes, w.qtes);
});

test('a registered function and a clip-time one leave their choices to the user', () => {
  let w = addFunction(emptyWorkspace(), 'Hit');
  const fn = w.eventRegistry[0].functions[0];
  assert.deepEqual(fn.values, {op: ''});
  assert.ok(functionErrors(fn.values).includes('기능을 선택하세요.'));
  assert.deepEqual(unchosen('ragdoll'), {direction: ''});
  assert.deepEqual(unchosen('sound'), {bone: ''});
  assert.deepEqual(unchosen('cost'), {measure: ''});
  assert.deepEqual(unchosen('strike', true), {pick: '', hand: '', block: '', reaction: '', target: ''});
  // Each one left empty asks for itself; chosen, it is gone. Left out (a file's), it is the runtime's default.
  assert.ok(functionErrors({op: 'ragdoll', direction: ''}).includes('방향: 선택하세요.'));
  assert.deepEqual(functionErrors({op: 'ragdoll', direction: 'left'}), []);
  assert.deepEqual(functionErrors({op: 'ragdoll'}), []);
  // A pair's clip-time strike: whom, how and who strikes are chosen.
  w = s4sample();
  const pair = w.actions.find(a => a.pair);
  const added = addMoment(w, pair.uid, 'strike', 0.5);
  const e = added.workspace.actions.find(a => a.uid === pair.uid).pair.effects.at(-1);
  assert.equal(e.values.target, '');
  assert.equal(e.values.pick, '');
  assert.ok(has(added.workspace, '적용: 선택하세요.'));
});

test('a vanilla transition added chooses nothing', () => {
  let w = s4sample();
  const single = w.actions.find(a => !a.pair);
  w = addMoment(w, single.uid, 'vanillaCancel', 0.2).workspace;
  assert.equal(w.actions.find(a => a.uid === single.uid).cancels.at(-1).to, '');
  assert.ok(has(w, '전환할 바닐라 동작을 고르세요.'));
});
