import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction} from '../src/workspace.ts';
import {localChanges, advanceGate, gateState} from '../src/graph/cardGate.ts';

// When canvas cards draw again (docs/수정-성능-2026-09-30.md): an edit confined to one action's own
// settings redraws that action's cards; anything other cards show redraws all of them.
const sample = () => {
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  w.actions.push(addAction(w, 'single'));
  return w;
};
const withAction = (w, i, change) => {
  const a = structuredClone(w.actions[i]);
  change(a);
  return {...w, actions: w.actions.map((x, j) => (j === i ? a : x))};
};

test('card gate: local edits name their action, the rest is a change for every card', () => {
  const w = sample();
  const uid = w.actions[1].uid;
  assert.deepEqual(localChanges(w, {...w}), []);
  assert.deepEqual(
    localChanges(
      w,
      withAction(w, 1, a => (a.config.steps[0].clip = 'x.hkx'))
    ),
    [uid]
  );
  // Other cards show an action's name and id; project settings and links reach every card.
  assert.equal(
    localChanges(
      w,
      withAction(w, 1, a => (a.config.name = 'Other'))
    ),
    null
  );
  assert.equal(
    localChanges(
      w,
      withAction(w, 1, a => (a.config.actionId = 'Other'))
    ),
    null
  );
  assert.equal(localChanges(w, {...w, links: []}), null);
  assert.equal(localChanges(w, {...w, actions: w.actions.slice(1)}), null);
});

test('card gate: versions for local edits, the epoch for the rest', () => {
  const w = sample(),
    registry = [],
    library = [],
    shared = ['ko', registry, library],
    english = ['en', registry, library];
  const state = gateState();
  const first = advanceGate(state, w, shared);
  assert.deepEqual(advanceGate(state, w, shared), first, 'the same document and inputs change nothing');
  const edited = withAction(w, 0, a => (a.config.steps[0].clip = 'x.hkx'));
  const local = advanceGate(state, edited, shared);
  assert.equal(local.epoch, first.epoch);
  assert.equal(local.versions.get(w.actions[0].uid), 1);
  assert.equal(local.versions.get(w.actions[1].uid), undefined);
  // Another language (or registry or library view) redraws every card.
  const language = advanceGate(state, edited, english);
  assert.equal(language.epoch, first.epoch + 1);
  const renamed = advanceGate(
    state,
    withAction(edited, 1, a => (a.config.name = 'Other')),
    english
  );
  assert.equal(renamed.epoch, first.epoch + 2);
  assert.deepEqual(advanceGate(state, state.document, english), renamed);
});
