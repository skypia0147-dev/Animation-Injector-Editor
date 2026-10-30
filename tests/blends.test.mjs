import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {emptyWorkspace, compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {blendOf, blendSeconds, editBlend, animId} from '../src/graph/blends.ts';
import {addFlat, connectFlat, deleteFlat, dropBinding, hkxId} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {newCard} from '../src/cards.ts';

// Blends (XML format 6): an HKX card's start and end blends are its items (<Action enter>, <Exit blend>); a
// transition straight to an HKX may hold its own (<Transition blend>).
const roundtrip = w => parseWorkspace(JSON.stringify(captureGraph(w)));

test('an HKX card`s start and end blends are items whose seconds the XML carries', () => {
  let w = s4sample();
  const a = w.actions.find(x => !x.pair),
    enter = animId(a.uid, 'blendIn'),
    exit = animId(a.uid, 'blendOut');
  assert.deepEqual(blendOf(w, enter), {action: a.uid, kind: 'enter'});
  assert.deepEqual(blendOf(w, exit), {action: a.uid, kind: 'exit'});
  assert.equal(blendOf(w, animId('missing', 'blendIn')), undefined);
  w = editBlend(w, enter, {seconds: 0.7});
  w = editBlend(w, exit, {seconds: 9});
  assert.equal(blendSeconds(w, enter), 0.7);
  assert.equal(blendSeconds(w, exit), 5, 'at most 5 s');
  const xml = compileWorkspace(roundtrip(w));
  assert.match(xml, new RegExp(`<Action id="${a.config.actionId}" clip="[^"]+"[^>]* enter="0.7"`));
  assert.match(xml, /<Exit blend="5"\/>/);
  // Deleting the item leaves the engine's own blend.
  const off = deleteFlat(w, exit);
  assert.equal(off.actions.find(x => x.uid === a.uid).exitBlendEnabled, false);
});

test('a transition straight to an HKX holds its own blend; one through a condition card does not', () => {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
    w.actions[i].config.steps[0].clip = `Animations/Test${i}.hkx`;
    w.actions[i].config.actionId = `Test${i}`;
  }
  w = connectFlat(w, hkxId(w, 'a1'), hkxId(w, 'a2'));
  // Switched to an event on its card: its key binding goes.
  w = {...w, links: [{...w.links[0], mode: 'event', input: '', event: 'Next', window: false}]};
  w = dropBinding(w, 'a1', 'binding1');
  assert.deepEqual(w.actions[0].config.inputs, []);
  const l = w.links[0];
  l.blend = 0.25;
  assert.match(compileWorkspace(roundtrip(w)), /<Transition to="Test1" event="Next" blend="0.25"\/>/);
  // Through a card: the card chooses the action, which plays with its own start blend.
  const card = {...newCard(w, {x: 0, y: 0}), true: {action: 'a2'}};
  w.cards.push(card);
  l.card = card.uid;
  l.to = '';
  assert.ok(validateWorkspace(w).some(i => i.level === 'error' && /블렌드/.test(i.message)));
  delete l.blend;
  assert.doesNotMatch(compileWorkspace(w), /blend="0.25"/);
});
