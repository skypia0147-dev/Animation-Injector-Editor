import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editableCopy, clone} from '../src/model.ts';

// edit() hands the edit function a copy whose top-level fields are copied when first touched; fields it never
// touches stay the document's own, so the history neither copies nor compares them (editor performance,
// 2026-09-30).
const source = () => ({name: 'A', actions: [{uid: 'a1', steps: [{id: 's'}]}], qtes: [{id: 'q', speed: 1}], layout: {}});

test('untouched fields stay the source, touched ones are copies', () => {
  const w = source();
  const {copy, finish} = editableCopy(w);
  copy.actions[0].steps[0].id = 'changed';
  const next = finish(copy);
  assert.equal(next, copy);
  assert.equal(next.qtes, w.qtes, 'never read: shared');
  assert.equal(next.layout, w.layout);
  assert.notEqual(next.actions, w.actions, 'read: copied');
  assert.equal(w.actions[0].steps[0].id, 's', 'the source is not changed');
  assert.equal(next.actions[0].steps[0].id, 'changed');
  // Plain data afterwards, keys in the source's order.
  assert.deepEqual(Object.keys(next), Object.keys(w));
  for (const key of Object.keys(next)) assert.equal(Object.getOwnPropertyDescriptor(next, key).get, undefined);
});

test('set, delete, spread and a different result', () => {
  const w = source();
  let {copy, finish} = editableCopy(w);
  copy.qtes = [];
  delete copy.layout;
  let next = finish(copy);
  assert.deepEqual(next.qtes, []);
  assert.ok(!('layout' in next));
  assert.equal(next.actions, w.actions);
  assert.deepEqual(w.qtes, source().qtes);
  // A spread reads every field: all are copies, as with clone.
  ({copy, finish} = editableCopy(w));
  next = finish({...copy, name: 'B'});
  assert.equal(next.name, 'B');
  assert.notEqual(next.qtes, w.qtes);
  assert.deepEqual(next.qtes, w.qtes);
  // A result that is not the copy is returned as it is.
  ({copy, finish} = editableCopy(w));
  const other = clone(w);
  assert.equal(finish(other), other);
  // Frozen sources (the rendered document in development builds) are read, never changed.
  const frozen = Object.freeze(source());
  ({copy, finish} = editableCopy(frozen));
  copy.actions.push({uid: 'a2', steps: []});
  next = finish(copy);
  assert.equal(next.actions.length, 2);
  assert.equal(frozen.actions.length, 1);
});

test('putAction: the other actions stay the source records unless shared rules or earlier changes need copies', async () => {
  const {putAction, emptyWorkspace, addAction} = await import('../src/workspace.ts');
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  w.actions.push(addAction(w, 'single'));
  const [first, second] = w.actions;
  const renamed = {...first, config: {...first.config, name: 'Renamed'}};
  // An edit's copy: the other action is the source's own record, the edited one is the given one.
  let {copy, finish} = editableCopy(w);
  let next = finish(putAction(copy, renamed));
  assert.equal(next.actions[0], renamed);
  assert.equal(next.actions[1], second, 'not copied');
  assert.equal(w.actions[0].config.name, first.config.name, 'the source keeps its array');
  // Shared rules may copy settings into other members in place: copies.
  const ruled = {...w, sharedRules: [{kind: 'state', members: [first.uid, second.uid]}]};
  ({copy, finish} = editableCopy(ruled));
  next = finish(putAction(copy, renamed));
  assert.notEqual(next.actions[1], second);
  assert.deepEqual(next.actions[1], second);
  // An edit that already changed the actions keeps its change.
  ({copy, finish} = editableCopy(w));
  copy.actions[1].config.name = 'Earlier';
  next = finish(putAction(copy, renamed));
  assert.equal(next.actions[1].config.name, 'Earlier');
  // Outside an edit's copy it replaces in the given document.
  const plain = structuredClone(w);
  assert.equal(putAction(plain, renamed).actions[0], renamed);
});

test('graphAction follows changes to the actions array', async () => {
  const {graphAction} = await import('../src/graph/projection.ts');
  const {emptyWorkspace, addAction} = await import('../src/workspace.ts');
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  w.actions.push(addAction(w, 'single'));
  const [a, b] = w.actions;
  assert.equal(graphAction(w, {kind: 'start', action: b.uid}), b);
  const c = addAction(w, 'single');
  w.actions.push(c);
  assert.equal(graphAction(w, {kind: 'start', action: c.uid}), c, 'pushed');
  const b2 = {...b};
  w.actions[1] = b2;
  assert.equal(graphAction(w, {kind: 'anim', action: b.uid}), b2, 'replaced');
  w.actions.reverse();
  assert.equal(graphAction(w, {kind: 'start', action: a.uid}), a, 'reordered');
  w.actions.splice(w.actions.indexOf(a), 1);
  assert.equal(graphAction(w, {kind: 'start', action: a.uid}), undefined, 'removed');
  assert.equal(graphAction(w, {kind: 'link', link: 'none'}), undefined);
});
