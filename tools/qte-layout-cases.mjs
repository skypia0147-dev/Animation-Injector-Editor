// One QTE of every face and type, in the order of the runtime's tests/QteLayout.cpp Cases().
// A mouse button is a keycap named LMB (43 wide) since runtime 0.12.258.
import {qteBoundsOf} from '../src/qteLayout.ts';
import {qteFaceMode} from '../src/qteFace.ts';
const rows = [
  ['circle', {type: 'splitArc'}, 30],
  ['circle wide key', {type: 'splitArc'}, 187],
  ['converge', {type: 'splitArc', design: 'converge'}, 30],
  ['converge LMB', {type: 'splitArc', design: 'converge'}, 43],
  ['converge wide key', {type: 'splitArc', design: 'converge'}, 250],
  ['single', {type: 'rapidPress', pressCount: 1}, 30],
  ['single Space', {type: 'rapidPress', pressCount: 1}, 61],
  ['single LMB', {type: 'rapidPress', pressCount: 1}, 43],
  ['timingBar', {type: 'timingBar'}, 30],
  ['rotatingNeedle', {type: 'rotatingNeedle'}, 30],
  ['holdRelease', {type: 'holdRelease'}, 30],
  ['rapidPress', {type: 'rapidPress', pressCount: 10}, 30],
  ['keySequence 3', {type: 'keySequence', sequence: 3}, 30],
  ['keySequence 8', {type: 'keySequence', sequence: 8}, 30],
];
export const qteCases = () =>
  rows.map(([name, q, keyWidth]) => ({
    name,
    bounds: qteBoundsOf(qteFaceMode(q), q.type, q.sequence ?? 0, keyWidth),
  }));
