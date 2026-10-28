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
