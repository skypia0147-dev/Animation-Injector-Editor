import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, compileWorkspace} from '../src/workspace.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {deleteFlat} from '../src/graph/flat.ts';

// The 「공중」 item (an action's air rule, air="both") is deleted from its card: the action is then ground only
// (user report 10-26 on DynamicSprintStop.xml: the item could not be deleted).
test('deleting the air item makes the action ground only', () => {
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations\\Test.hkx';
  a.config.air = 'allow';
  w.actions.push(a);
  const airItems = w2 => [...checklistModel(w2).items.values()].flat().filter(i => i.node.kind === 'stateCondition');
  const [item] = airItems(w);
  assert.ok(item?.removable);
  assert.match(compileWorkspace(w), /air="both"/);
  const next = deleteFlat(w, item.node.id);
  assert.equal(next.actions[0].config.air, 'deny');
  assert.equal(airItems(next).length, 0);
  assert.doesNotMatch(compileWorkspace(next), /air="/);
  assert.equal(w.actions[0].config.air, 'allow');
});
