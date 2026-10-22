import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {shareRules, synchronizeRules, compactGraph} from '../src/graph/sharing.ts';
import {flatGraph, connectFlat, deleteFlat, addFlat} from '../src/graph/flat.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {blendNodes, blendBinding, animId} from '../src/graph/blends.ts';
import {actionFlow} from '../src/graph/navigation.ts';
test('identical active state conditions share edits, retain XML and detach on deletion', () => {
  const base = s4sample();
  for (const a of base.actions) Object.assign(a.config, {air: 'allow', cooldown: 0.5});
  const w = shareRules(base),
    g = w.sharedRules.find(g => g.kind === 'state');
  assert.equal(g.members.length, base.actions.length);
  assert.equal(compileWorkspace(w), compileWorkspace(base));
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).sharedRules, w.sharedRules);
  assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.kind === 'stateCondition').length, 1);
  const next = structuredClone(w);
  next.actions[0].config.cooldown = 0.9;
  synchronizeRules(w, next);
  assert.ok(next.actions.every(a => a.config.cooldown === 0.9));
  const removed = deleteFlat(w, 'start:' + g.members[0] + '|stateCondition');
  synchronizeRules(w, removed);
  assert.equal(removed.actions[0].config.cooldown, 0);
  assert.ok(removed.actions.slice(1).every(a => a.config.cooldown === 0.5));
});
test('different state conditions remain separate and disabled defaults do not join', () => {
  const w = s4sample();
  for (const a of w.actions) Object.assign(a.config, {air: 'deny', cooldown: 0});
  w.actions[0].config.air = 'allow';
  w.actions[1].config.cooldown = 1;
  assert.ok(!shareRules(w).sharedRules.some(g => g.kind === 'state'));
});
test('common output preserves separate blends and reconnects to the source actor terminal', () => {
  const base = s4sample(),
    w = shareRules(base),
    g = compactGraph(w, flatGraph(w));
  assert.equal(g.nodes.filter(n => n.kind === 'outputPose').length, 1);
  assert.equal(g.nodes.find(n => n.kind === 'outputPose').id, 'shared:outputPose');
  assert.deepEqual(blendNodes(w), blendNodes(base));
  const a = w.actions[0],
    play = flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay');
  const draft = addFlat(w, a.uid, 'blend', {x: 0, y: 0}),
    left = connectFlat(draft.workspace, play.id, draft.id),
    connected = connectFlat(left, draft.id, 'shared:outputPose');
  const b = blendNodes(connected).find(b => b.id === draft.id);
  assert.equal(b.target, animId(a.uid, 'outputPose'));
  assert.equal(blendBinding(connected, b).action, a.uid);
  assert.equal(deleteFlat(w, 'shared:outputPose').sharedOutputPose, false);
  assert.equal(parseWorkspace(JSON.stringify(captureGraph(w))).sharedOutputPose, true);
});
test('shared output and shared state do not pull sibling actions into focused flow', () => {
  const node = (id, action, kind) => ({id, action, kind, inputs: [], outputs: []}),
    edge = (source, target) => ({id: source + target, source, target, pin: 'trigger'});
  const g = {
    nodes: [
      node('a', 'a', 'hkxPlay'),
      node('b', 'b', 'hkxPlay'),
      node('s', 'a', 'stateCondition'),
      node('out', undefined, 'outputPose'),
    ],
    edges: [edge('s', 'a'), edge('s', 'b'), edge('a', 'out'), edge('b', 'out')],
  };
  assert.deepEqual(new Set(actionFlow(g, 'a').nodes.map(n => n.id)), new Set(['a', 's', 'out']));
});
