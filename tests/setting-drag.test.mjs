import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flatGraph} from '../src/graph/flat.ts';
import {transferItem} from '../src/graph/checklist.ts';
import {s4sample} from './fixtures/s4sample.ts';

// An HKX card's blend chips drag onto another HKX card as its feature rows do (11-02): copied with Ctrl, moved
// without; the other blend of the target stays as it was.
test('a blend setting copies or moves to another HKX card with its seconds', () => {
  const w = s4sample();
  const [a, b] = w.actions.filter(x => !x.pair);
  Object.assign(a, {enterBlendEnabled: true, exitBlendEnabled: true});
  Object.assign(a.config, {enterBlend: 0.2, exitBlend: 0.3});
  Object.assign(b, {enterBlendEnabled: false, exitBlendEnabled: false});
  const node = role => flatGraph(w).nodes.find(n => n.kind === 'blend' && n.action === a.uid && n.id.endsWith(role)).id;
  const copied = transferItem(w, node('blendIn'), b.uid, true);
  const [ca, cb] = [a.uid, b.uid].map(uid => copied.actions.find(x => x.uid === uid));
  assert.equal(cb.enterBlendEnabled, true);
  assert.equal(cb.config.enterBlend, 0.2);
  assert.equal(cb.exitBlendEnabled, false);
  assert.equal(ca.enterBlendEnabled, true);
  const moved = transferItem(w, node('blendOut'), b.uid, false);
  const [ma, mb] = [a.uid, b.uid].map(uid => moved.actions.find(x => x.uid === uid));
  assert.equal(mb.exitBlendEnabled, true);
  assert.equal(mb.config.exitBlend, 0.3);
  assert.equal(ma.exitBlendEnabled, false);
});
