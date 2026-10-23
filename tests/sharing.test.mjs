import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {shareRules, synchronizeRules, compactGraph, ruleValue} from '../src/graph/sharing.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {compileWorkspace, keptSharing, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';

function sample() {
  const w = s4sample(),
    a = w.actions.find(a => a.pair);
  assert.ok(a);
  a.pair.effectsEnabled = true;
  a.pair.effects = [{id: 'hide', values: {op: 'hide', at: '0.2', target: 'both'}}];
  const b = structuredClone(a);
  b.uid = 'a99';
  b.config.actionId = 'SharedCopy';
  b.config.name = 'SharedCopy';
  w.actions.push(b);
  return w;
}
test('shared effects preserve XML, persist membership, edit all members and detach independently', () => {
  const base = sample(),
    w = shareRules(base);
  assert.ok(w.sharedRules.length);
  assert.equal(compileWorkspace(w), compileWorkspace(base));
  assert.deepEqual(
    parseWorkspace(JSON.stringify(captureGraph(w))).sharedRules ?? [],
    keptSharing(
      w.sharedRules,
      (w.blends ?? []).map(b => b.id)
    )
  );
  const group = w.sharedRules.find(g => g.kind === 'effect');
  assert.ok(group);
  const [owner, id] = group.members[0].split('|'),
    next = structuredClone(w);
  next.actions.find(a => a.uid === owner).pair.effects.find(e => e.id === id).values.at = '0.45';
  synchronizeRules(w, next);
  for (const member of group.members) assert.equal(ruleValue(next, 'effect', member).at, '0.45');
  const detached = structuredClone(w);
  detached.sharedRules = [];
  detached.actions.find(a => a.uid === owner).pair.effects.find(e => e.id === id).values.at = '0.7';
  synchronizeRules(w, detached);
  assert.notEqual(ruleValue(detached, 'effect', group.members[1]).at, '0.7');
});
test('compact graph merges playback wrappers and every surviving edge has valid pins', () => {
  const w = shareRules(sample()),
    raw = flatGraph(w),
    g = compactGraph(w, raw);
  assert.ok(g.nodes.length < raw.nodes.length);
  assert.equal(g.nodes.filter(n => ['state', 'pairedPlay', 'findPartner'].includes(n.kind)).length, 0);
  for (const e of g.edges) {
    assert.ok(g.nodes.find(n => n.id === e.source)?.outputs.includes(e.pin));
    assert.ok(g.nodes.find(n => n.id === e.target)?.inputs.includes(e.targetPin ?? e.pin));
  }
});
test('QTE sharing preserves both destinations, ignores layout, and edits all sources', () => {
  const base = s4sample();
  for (const l of base.links) {
    l.mode = 'event';
    l.event = 'QTE';
    l.input = '';
  }
  const w = shareRules(base),
    group = w.sharedRules.find(g => g.kind === 'node' && g.members[0].startsWith('link:'));
  assert.ok(group);
  const ids = group.members.map(m => m.split('|')[0].slice(5));
  const next = structuredClone(w);
  next.links.find(l => l.id === ids[0]).event = 'QTE2';
  synchronizeRules(w, next);
  for (const id of ids) {
    const l = next.links.find(l => l.id === id),
      old = w.links.find(l => l.id === id);
    assert.equal(l.event, 'QTE2');
    assert.equal(l.from, old.from);
    assert.equal(l.to, old.to);
    assert.equal(l.partnerTo, old.partnerTo);
    assert.deepEqual(l.position, old.position);
  }
});
test('removing a shared member leaves other effects unchanged', () => {
  const w = shareRules(sample()),
    group = w.sharedRules.find(g => g.kind === 'effect'),
    next = structuredClone(w);
  const [owner, id] = group.members[0].split('|');
  next.actions.find(a => a.uid === owner).pair.effects = [];
  const retained = ruleValue(w, 'effect', group.members[1]);
  synchronizeRules(w, next);
  assert.deepEqual(ruleValue(next, 'effect', group.members[1]), retained);
});
test('a dispatch-only action keeps event-to-condition routing; it has no HKX card until a route comes back to it', () => {
  const w = s4sample(),
    a = w.actions[0],
    dest = w.actions[1];
  a.config.start.mode = 'event';
  a.config.start.event = 'Contact';
  a.flow = {entry: 'Check', tests: [{id: 'Check', kind: 'air', subject: 'self', minimum: 0, pass: {action: dest.uid}}]};
  const xml = compileWorkspace(w),
    g = compactGraph(w, flatGraph(w));
  // Its own HKX never plays: no card, and none of its playback tails.
  assert.ok(!g.nodes.some(n => n.action === a.uid && ['hkxPlay', 'outputPose'].includes(n.kind)));
  const reachable = new Set([`start:${a.uid}|markerReceive`]);
  for (let i = 0; i < g.nodes.length; i++)
    for (const e of g.edges) if (reachable.has(e.source)) reachable.add(e.target);
  assert.ok(reachable.has(`flow:${a.uid}:Check`));
  assert.ok(g.nodes.some(n => n.action === dest.uid && n.kind === 'hkxPlay'));
  assert.equal(compileWorkspace(w), xml);
  a.flow.tests[0].fail = {action: a.uid};
  const back = compactGraph(w, flatGraph(w)).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay');
  assert.ok(back, 'a route back to it: it plays, so its card is drawn');
});
