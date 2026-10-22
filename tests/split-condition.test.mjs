import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {compileWorkspace, selectsOnly} from '../src/workspace.ts';
import {addFlat, connectFlat, flatGraph} from '../src/graph/flat.ts';
import {addEntrySetting, makeDraft} from '../src/graph/drafts.ts';
import {checklistModel, checklistProjection, deleteChecklistNode} from '../src/graph/checklist.ts';

// A second hotkey's flow (10-21): a condition card added while another action was chosen belongs to that action;
// a key input linked to it makes it an action of its own instead of a second start on that action.
const scene = () => {
  let w = s4sample();
  const a = w.actions.find(x => x.config.start.mode !== 'none');
  w = addFlat(w, a.uid, 'conditionBranch', {x: 0, y: 0}).workspace;
  const loose = addFlat(w, a.uid, 'conditionBranch', {x: 40, y: 900});
  const key = makeDraft(loose.workspace, a.uid, 'keyInput', {x: -300, y: 900});
  return {w: key.workspace, owner: a.uid, loose: loose.id, key: key.id};
};

test('a key linked to a loose condition of a started action makes it an action of its own', () => {
  const {w, owner, loose, key} = scene(),
    before = w.actions.find(a => a.uid === owner);
  const next = connectFlat(w, key, loose, 'trigger');
  const made = next.actions.at(-1),
    kept = next.actions.find(a => a.uid === owner);
  assert.notEqual(made.uid, owner);
  assert.equal(made.config.start.mode, 'input');
  assert.deepEqual(made.flow, {
    entry: 'Condition2',
    selects: true,
    tests: [{id: 'Condition2', kind: 'air', subject: 'self', minimum: 0}],
  });
  assert.ok(selectsOnly(made), 'no HKX of its own: it only selects');
  assert.deepEqual(kept.config.start, before.config.start, 'the first key stays');
  assert.deepEqual(
    kept.flow.tests.map(t => t.id),
    ['Condition1']
  );
  const g = flatGraph(next);
  assert.ok(g.edges.some(e => e.source === `start:${made.uid}|keyInput` && e.target === `flow:${made.uid}:Condition2`));
  assert.deepEqual(
    g.nodes.find(n => n.id === `flow:${made.uid}:Condition2`).position,
    {x: 40, y: 900},
    'the card stays'
  );
  assert.deepEqual(
    g.nodes.find(n => n.id === `start:${made.uid}|keyInput`).position,
    flatGraph(w).nodes.find(n => n.id === key).position,
    'the key card stays where it was drawn'
  );
  // One more start in the file, the new action with no clip (runtime 0.12.244 selecting action).
  const starts = x => (x.match(/<Start /g) ?? []).length,
    xml = compileWorkspace(next);
  assert.equal(starts(xml), starts(compileWorkspace(w)) + 1);
  assert.match(xml, new RegExp(`<(Action|Pair) id="${made.config.actionId}">`));
});

test('a key onto the start flow stays refused; a loose condition another one leads into is not split', () => {
  const {w, owner, key} = scene();
  assert.throws(() => connectFlat(w, key, `flow:${owner}:Condition1`, 'trigger'), /이미 시작 입력/);
  const fed = structuredClone(w);
  fed.actions
    .find(a => a.uid === owner)
    .flow.tests.push({id: 'Feeder', kind: 'air', subject: 'self', minimum: 0, pass: {node: 'Condition2'}});
  assert.throws(() => connectFlat(fed, key, `flow:${owner}:Condition2`, 'trigger'), /다른 조건이 이 조건으로/);
});

test('a split action is named after its start and takes entry settings on its first condition', () => {
  const {w, loose, key} = scene();
  let next = connectFlat(w, key, loose, 'trigger');
  const made = next.actions.at(-1),
    entry = `flow:${made.uid}:Condition2`;
  assert.equal(made.config.name, 'Num0 시작');
  // Its HKX card is not drawn: the settings are added on the action and shown on the first condition card.
  next = addEntrySetting(next, made.uid, 'stateCondition');
  next = addEntrySetting(next, made.uid, 'suppress');
  assert.deepEqual(
    (checklistModel(next).items.get(entry) ?? []).map(i => i.node.kind),
    ['stateCondition', 'suppress']
  );
  next.actions.at(-1).config.suppress.events = ['blockStart'];
  const xml = compileWorkspace(next),
    own = xml.slice(xml.indexOf(`id="${made.config.actionId}"`)).split(/<\/(Action|Pair)>/)[0];
  assert.match(own, /<Require [^>]*cooldown="0.2"/);
  assert.match(own, /<Suppress events="blockStart"\/>/);
  assert.doesNotMatch(own, /clip=/, 'still a selecting action');
});

test('deleting the last condition of a split action removes the action and leaves its key as a loose card', () => {
  const {w, loose, key} = scene();
  let next = connectFlat(w, key, loose, 'trigger');
  next = addEntrySetting(next, next.actions.at(-1).uid, 'suppress');
  const made = next.actions.at(-1);
  next = deleteChecklistNode(next, `flow:${made.uid}:Condition2`);
  assert.ok(!next.actions.some(a => a.uid === made.uid), 'the action goes with its last condition');
  assert.ok(
    next.drafts?.some(d => d.kind === 'keyInput'),
    'its key stays as a loose card'
  );
  assert.doesNotThrow(() => compileWorkspace(next), 'no empty HKX or empty blocked event left behind');
  // Key first, then the condition: the same.
  let other = addEntrySetting(connectFlat(w, key, loose, 'trigger'), made.uid, 'suppress');
  other = deleteChecklistNode(other, `start:${made.uid}|keyInput`);
  assert.ok(
    other.actions.some(a => a.uid === made.uid),
    'its conditions are still there'
  );
  other = deleteChecklistNode(other, `flow:${made.uid}:Condition2`);
  assert.ok(!other.actions.some(a => a.uid === made.uid));
});

test('a new HKX card whose condition is emptied keeps its card and is not removed with the condition', () => {
  const added = addFlat(s4sample(), '', 'playNode', {x: 0, y: 0});
  const a = added.workspace.actions.at(-1);
  let w = addFlat(added.workspace, a.uid, 'conditionBranch', {x: -300, y: 0}).workspace;
  w.actions.find(x => x.uid === a.uid).flow.tests[0].pass = undefined;
  assert.ok(!selectsOnly(w.actions.find(x => x.uid === a.uid)));
  assert.ok(
    checklistProjection(w, checklistModel(w)).nodes.some(n => n.id === added.id),
    'its HKX card shows'
  );
  w = deleteChecklistNode(w, `flow:${a.uid}:Condition1`);
  assert.ok(w.actions.some(x => x.uid === a.uid));
});
