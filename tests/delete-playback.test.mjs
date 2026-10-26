import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace, compileWorkspace, addAction, addLink} from '../src/workspace.ts';
import {addFlat, deleteFlat, flatGraph} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {newCard, newStart} from '../src/cards.ts';

// Deleting an HKX card deletes its action (XML format 6): its items go with it, and what went to it (start cards,
// condition card rows, True and False, QTE results) goes nowhere; its transitions go.
function sample() {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
    const a = w.actions.at(-1);
    a.config.steps[0].clip = `animations\\Test${i}.hkx`;
    w.starts.push({...newStart(w, {x: i * 400 - 300, y: 0}, 'event'), event: `Test${i}`, to: {action: a.uid}});
  }
  return w;
}
const play = a => `anim:${a.uid}:|clip_${a.config.entry}`;
const roundtrip = w => parseWorkspace(JSON.stringify(captureGraph(w)));

test('ordinary and paired owners retire with their HKX card', () => {
  for (const kind of ['single', 'pair']) {
    let w = emptyWorkspace();
    w.actions.push(addAction(w, kind));
    w.actions[0].nodeAuthored = true;
    w = deleteFlat(w, flatGraph(w).nodes.find(n => n.kind === 'hkxPlay').id);
    assert.equal(w.actions.length, 0, kind);
    assert.equal(roundtrip(w).actions.length, 0, kind);
  }
});

test('the start card stays, going nowhere; the other action is untouched', () => {
  const w = sample(),
    [a, b] = w.actions;
  a.config.recovery.enabled = true;
  const before = JSON.stringify(w),
    saved = structuredClone(b);
  const next = deleteFlat(w, play(a));
  assert.equal(JSON.stringify(w), before, 'the document given is not changed');
  assert.deepEqual(next.actions, [saved]);
  assert.deepEqual(
    next.starts.map(s => [s.event, s.to]),
    [
      ['Test0', null],
      ['Test1', {action: b.uid}],
    ]
  );
  // A start going nowhere is not written.
  const xml = compileWorkspace(roundtrip(next));
  assert.doesNotMatch(xml, /Test0|CustomAction1"/);
  assert.ok(!flatGraph(next).nodes.some(n => n.action === a.uid));
});

test('a condition card keeps its other destinations', () => {
  const w = sample(),
    [a, b] = w.actions;
  const card = {
    ...newCard(w, {x: 0, y: 0}),
    tests: [{id: 'Condition1', kind: 'female', subject: 'self', minimum: 0}],
    rows: [{id: 'row1', guards: ['Condition1'], to: {action: b.uid}}],
    false: {action: a.uid},
  };
  w.cards.push(card);
  w.starts[0].to = {card: card.uid};
  const n = deleteFlat(w, play(b));
  assert.equal(n.cards[0].rows[0].to, null);
  assert.deepEqual(n.cards[0].false, {action: a.uid});
  assert.ok(compileWorkspace(roundtrip(n)));
});

test('shared settings keep the remaining action; transitions from and to it go', () => {
  let w = sample();
  const [a, b] = w.actions;
  for (const x of w.actions) {
    x.config.rotationLocked = true;
    x.config.recovery.enabled = true;
  }
  w.links.push({...addLink(w, a.uid, b.uid), event: 'Next'});
  w.links.push({...addLink(w, b.uid, a.uid), id: 'link9', event: 'Return'});
  const expected = structuredClone(w.actions[1]);
  const next = roundtrip(deleteFlat(w, play(a)));
  assert.deepEqual(next.actions, [expected]);
  assert.equal(next.links.length, 0);
  assert.ok(compileWorkspace(next));
});
