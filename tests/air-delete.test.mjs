import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, compileWorkspace} from '../src/workspace.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {playbackState, resetAir} from '../src/graph/playbackSettings.ts';

// Where the HKX may start is a playback setting (11-01, from 「+ 설정」), not a 「+ 기능」 item: set when the air is
// allowed, back to the ground only (air left out of the XML) when reset.
test('the air rule is a playback setting; resetting it makes the action ground only', () => {
  const w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations\Test.hkx';
  a.config.air = 'allow';
  w.actions.push(a);
  assert.ok(![...checklistModel(w).items.values()].flat().some(i => i.node.kind === 'stateCondition'));
  assert.deepEqual(playbackState(w, a, a.config.entry).air, {applies: true, set: true});
  assert.match(compileWorkspace(w), /air="both"/);
  const next = resetAir(w, a.uid);
  assert.equal(next.actions[0].config.air, 'deny');
  assert.equal(playbackState(next, next.actions[0], a.config.entry).air.set, false);
  assert.doesNotMatch(compileWorkspace(next), /air="/);
});
