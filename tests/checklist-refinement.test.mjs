import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {playbackKind, switchPlaybackKind} from '../src/actionTypes.ts';
import {foldNotConditions} from '../src/graph/conditions.ts';
import {checklistModel, checklistProjection} from '../src/graph/checklist.ts';

test('duplicate right-unarmed condition becomes equippedType without losing NOT, enable or routes', () => {
  const w = emptyWorkspace(),
    a = addAction(w, 'single');
  w.actions.push(a);
  a.flow = {
    entry: 'unarmed',
    tests: [
      {
        id: 'unarmed',
        kind: 'unarmedRight',
        subject: 'partner',
        minimum: 0,
        negate: true,
        enabled: false,
        pass: {action: a.uid},
      },
    ],
  };
  foldNotConditions(w);
  assert.deepEqual(a.flow.tests[0], {
    id: 'unarmed',
    kind: 'equippedType',
    subject: 'partner',
    minimum: 0,
    negate: true,
    enabled: false,
    pass: {action: a.uid},
    hand: 'right',
    equipmentType: 'unarmed',
  });
  assert.deepEqual(foldNotConditions(w), w);
});
