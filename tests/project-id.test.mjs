import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SET_ID, emptyWorkspace, renameProject, setIdFromName, validateWorkspace} from '../src/workspace.ts';

// The runtime names every action after the AnimationSet id (<id>_<action>): each mod should have its own.
const defaultWarnings = w =>
  validateWorkspace(w).filter(i => i.node === 'project' && i.message.includes(DEFAULT_SET_ID));

test('a project name as an AnimationSet id', () => {
  assert.equal(setIdFromName('CleanUpOutfit'), 'CleanUpOutfit');
  assert.equal(setIdFromName('Clean up the physics outfit'), 'Clean_up_the_physics_outfit');
  assert.equal(setIdFromName('  2nd Dodge-Roll! '), 'nd_Dodge_Roll');
  assert.equal(setIdFromName('그래플 Grapple'), 'Grapple');
  assert.equal(setIdFromName('새 애니메이션 묶음'), undefined);
  assert.equal(setIdFromName('A'.repeat(80)).length, 64);
});

test('the id follows the name typed letter by letter, and stays once the author writes it', () => {
  const w = emptyWorkspace();
  assert.equal(w.id, DEFAULT_SET_ID);
  for (const name of ['C', 'Cl', 'Clean', 'Clean ', 'Clean u', 'Clean up']) renameProject(w, name);
  assert.equal(w.id, 'Clean_up');
  // A Korean name makes no id: the default again, and it follows the next English name.
  renameProject(w, '정리');
  assert.equal(w.id, DEFAULT_SET_ID);
  renameProject(w, 'Tidy');
  assert.equal(w.id, 'Tidy');
  // An id the author wrote is kept through a rename.
  w.id = 'MyOwnId';
  renameProject(w, 'Something else');
  assert.equal(w.id, 'MyOwnId');
  assert.equal(w.name, 'Something else');
});

test('the default id is a warning, never an error', () => {
  const w = emptyWorkspace();
  assert.equal(defaultWarnings(w).length, 1);
  assert.equal(defaultWarnings(w)[0].level, 'warning');
  renameProject(w, 'CleanUpOutfit');
  assert.equal(defaultWarnings(w).length, 0);
});

// An edit as the editor makes it: followFiles(before, after) runs on every edit (WorkspaceApp edit).
const editWith = async (w, fn) => {
  const {followFiles} = await import('../src/workspace.ts');
  return followFiles(w, fn(structuredClone(w)));
};
const card = async (w, clip) => {
  const {addFlat} = await import('../src/graph/flat.ts');
  const {placeStepFile} = await import('../src/view.ts');
  const made = await editWith(w, x => addFlat(x, '', 'playNode', {x: 0, y: 0}).workspace);
  const a = made.actions.at(-1);
  return clip === undefined ? made : editWith(made, x => placeStepFile(x, a.uid, a.config.steps[0].id, clip, ''));
};
const names = a => [a.config.name, a.config.steps[0].label, a.config.actionId];

test('no Action ID is made up: a card has none until its HKX file names it', async () => {
  const {addAction} = await import('../src/workspace.ts');
  const w = emptyWorkspace();
  // An action made in code is named after its file (the default Action.hkx); a card made in the editor has none.
  assert.equal(addAction(w).config.actionId, 'Action');
  const empty = (await card(w)).actions.at(-1);
  assert.equal(empty.config.actionId, '');
  // Picked from the card's file field (or dropped, or chosen in Details): one rule for every control.
  const named = await card(w, 'Animations\\Mod\\CleanUpOutfit_3.hkx');
  assert.deepEqual(names(named.actions.at(-1)), ['CleanUpOutfit_3', 'CleanUpOutfit_3', 'CleanUpOutfit_3']);
  // No letter an id can use: the name follows the file, the id stays empty and says what to do.
  const korean = await card(w, 'Animations\\Mod\\구르기.hkx');
  assert.deepEqual(names(korean.actions.at(-1)), ['구르기', '구르기', '']);
  const issues = validateWorkspace(korean).filter(
    i => i.level === 'error' && i.message.includes('Action ID가 없습니다')
  );
  assert.equal(issues.length, 1);
});

test('the names follow a changed file while they followed the old one; what the author wrote stays', async () => {
  const {placeStepFile} = await import('../src/view.ts');
  let w = await card(emptyWorkspace(), 'Animations\\Mod\\Roll.hkx');
  const a = w.actions.at(-1);
  const place = (w, clip) => editWith(w, x => placeStepFile(x, a.uid, a.config.steps[0].id, clip, ''));
  w = await place(w, 'Animations\\Mod\\Dodge.hkx');
  assert.deepEqual(names(w.actions.at(-1)), ['Dodge', 'Dodge', 'Dodge']);
  w = await editWith(w, x => {
    x.actions.at(-1).config.actionId = 'MyDodge';
    x.actions.at(-1).config.name = '회피';
    return x;
  });
  w = await place(w, 'Animations\\Mod\\Slide.hkx');
  assert.deepEqual(names(w.actions.at(-1)), ['회피', 'Slide', 'MyDodge']);
});

test('ids from files are unique the way the runtime compares them, also for cards made in one edit', async () => {
  const {addFlat} = await import('../src/graph/flat.ts');
  const {placeStepFile} = await import('../src/view.ts');
  let w = await card(emptyWorkspace(), 'Animations\\Mod\\CleanUpOutfit_3.hkx');
  w = await card(w, 'Animations\\Other\\cleanupoutfit_3.HKX');
  assert.equal(w.actions.at(-1).config.actionId, 'cleanupoutfit_3_2');
  // Two files dropped at once whose names give the same id.
  w = await editWith(w, x => {
    for (const clip of ['Animations\\Mod\\mt sprint.hkx', 'Animations\\Mod\\mt-sprint.hkx']) {
      x = addFlat(x, '', 'playNode', {x: 0, y: 0}).workspace;
      const a = x.actions.at(-1);
      x = placeStepFile(x, a.uid, a.config.steps[0].id, clip, '');
    }
    return x;
  });
  assert.deepEqual(
    w.actions.slice(-2).map(a => a.config.actionId),
    ['mt_sprint', 'mt_sprint_2']
  );
});

test('a duplicated card takes its file name with a number; an opened id that is not the file name stays', async () => {
  const {duplicateAction, followFiles} = await import('../src/workspace.ts');
  const {placeStepFile} = await import('../src/view.ts');
  let w = await card(emptyWorkspace(), 'Animations\\Mod\\Roll.hkx');
  w = await editWith(w, x => ({...x, actions: [...x.actions, duplicateAction(x, x.actions[0], 'Roll 2')]}));
  assert.deepEqual(names(w.actions[1]), ['Roll 2', 'Roll', 'Roll_2']);
  // An action opened from XML whose id was written by hand: a new file does not rename it.
  w.actions[0].config.actionId = 'SprintStop_SheathedTorch';
  const a = w.actions[0];
  const next = followFiles(
    w,
    placeStepFile(structuredClone(w), a.uid, a.config.steps[0].id, 'Animations\\Mod\\Run.hkx', '')
  );
  assert.equal(next.actions[0].config.actionId, 'SprintStop_SheathedTorch');
});
