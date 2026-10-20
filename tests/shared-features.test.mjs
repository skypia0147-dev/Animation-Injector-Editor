import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {shareRules, synchronizeRules, compactGraph, ruleNode} from '../src/graph/sharing.ts';
import {flatGraph, deleteFlat} from '../src/graph/flat.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
function sample() {
  const w = s4sample(),
    a = w.actions.find(a => !a.pair),
    b = structuredClone(a);
  b.uid = 'duplicate';
  b.config.actionId = 'Duplicate';
  w.actions.push(b);
  for (const x of [a, b]) {
    x.config.rotationLocked = true;
    x.config.slots.armor.enabled = true;
  }
  return {w, a, b};
}
test('locked rotation and armor share without changing XML; edits and deletion respect membership', () => {
  const {w: base, a, b} = sample(),
    w = shareRules(base);
  assert.equal(compileWorkspace(w), compileWorkspace(base));
  for (const key of ['rotate', 'armor'])
    assert.ok(
      w.sharedRules.some(
        g => g.kind === 'feature' && g.members.includes(a.uid + '|' + key) && g.members.includes(b.uid + '|' + key)
      )
    );
  const edited = structuredClone(w);
  edited.actions.find(x => x.uid === a.uid).config.slots.armor.until.seconds = 2;
  synchronizeRules(w, edited);
  assert.equal(edited.actions.find(x => x.uid === b.uid).config.slots.armor.until.seconds, 2);
  const removed = deleteFlat(w, 'notify:' + a.uid + '|armor');
  synchronizeRules(w, removed);
  assert.equal(removed.actions.find(x => x.uid === b.uid).config.slots.armor.enabled, true);
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).sharedRules, w.sharedRules);
});
test('different events and fallback timings cannot merge', () => {
  const {w, a, b} = sample();
  a.config.slots.armor.from.basis = 'event';
  b.config.slots.armor.from.basis = 'event';
  a.config.slots.armor.from.event = 'A';
  b.config.slots.armor.from.event = 'B';
  const g = shareRules(w).sharedRules;
  b.config.slots.armor.from.event = 'A';
  b.config.slots.armor.from.seconds = a.config.slots.armor.from.seconds + 1;
  assert.ok(
    !shareRules(w).sharedRules.some(
      g => g.kind === 'feature' && g.members.includes(a.uid + '|armor') && g.members.includes(b.uid + '|armor')
    )
  );
  assert.ok(
    !g.some(g => g.kind === 'feature' && g.members.includes(a.uid + '|armor') && g.members.includes(b.uid + '|armor'))
  );
});
test('paired timelines preserve roles and camera sharing resolves real graph nodes', () => {
  const w = s4sample(),
    a = w.actions[0],
    b = w.actions[1];
  for (const x of [a, b]) {
    x.pair.effectsEnabled = true;
    x.pair.timeline.armor.enabled = true;
    x.cameraEnabled = true;
    x.camera ??= {reset: '', restore: 'end', timeout: 10};
  }
  b.camera = structuredClone(a.camera);
  let n = shareRules(w),
    g = n.sharedRules.find(g => g.kind === 'camera' && g.members.includes(a.uid) && g.members.includes(b.uid));
  assert.ok(g);
  const raw = flatGraph(n);
  assert.ok(raw.nodes.some(n => n.id === ruleNode('camera', a.uid, w)));
  const graph = compactGraph(n, raw);
  assert.ok(
    graph.nodes.filter(n => n.kind === 'cameraRestore').length <
      raw.nodes.filter(n => n.kind === 'cameraRestore').length
  );
  b.pair.timeline.armor.role = 'target';
  a.pair.timeline.armor.role = 'initiator';
  n = shareRules(w);
  assert.ok(
    !n.sharedRules.some(
      g =>
        g.kind === 'feature' && g.members.includes(a.uid + '|pair:armor') && g.members.includes(b.uid + '|pair:armor')
    )
  );
});
