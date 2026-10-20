import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {rows, add, remove, patch} from '../src/timeline/model.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {contextualAdds, addConnected} from '../src/graph/contextAdd.ts';
import {featureValue, applyFeature} from '../src/graph/sharedFeatures.ts';

const xml = at => `<AnimationSet version="4" id="PairRecovery"><Inputs><Input id="use" key="G"/></Inputs>
<Pair id="Lift" clip="Animations/Lift.hkx"><Start input="use"/><Target rig="chicken"/>
<Carry bone="NPC L Hand [LHnd]" targetRoot="NPC Root [Root]" putdown="Lower" input="use"/>
${at}<Exit at="end-0.05" blend="0.2"/></Pair>
<Action id="Lower" clip="Animations/Lower.hkx"><CarryRelease at="0.8"/><Exit at="end-0.05"/></Action></AnimationSet>`;

for (const at of ['at="0.25"', 'at="event:CarryReady"', 'at="event:CarryReady" fallback="1.5"'])
  test(`pair recovery survives graph/project/XML roundtrip: ${at}`, () => {
    const w = importWorkspaceXml(xml(`<Recovery ${at} blend="0.35"/>`));
    const saved = parseWorkspace(JSON.stringify(w));
    assert.equal(rows(saved, saved.actions[0]).filter(r => r.id === 'recovery').length, 1);
    const g = flatGraph(saved);
    const recovery = g.nodes.find(n => n.notify === 'recovery' || n.id.endsWith(':recovery'));
    assert.ok(recovery, JSON.stringify(g.nodes.map(n => ({id: n.id, notify: n.notify}))));
    assert.ok(g.edges.some(e => e.target === recovery.id));
    const exported = compileWorkspace(saved);
    assert.match(exported, /<Recovery /);
    const restored = importWorkspaceXml(exported);
    assert.deepEqual(restored.actions[0].config.recovery, saved.actions[0].config.recovery);
    assert.equal(restored.actions[0].pair.carry.bone, 'NPC L Hand [LHnd]');
  });

test('pair context menu adds, edits and deletes recovery without removing carry', () => {
  let w = importWorkspaceXml(xml(''));
  const a = w.actions[0],
    hkx = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === a.uid);
  const option = contextualAdds(w, hkx.id).find(o => o.kind === 'notify:recovery');
  assert.ok(option);
  w = addConnected(w, hkx.id, option, {x: 300, y: 200}).workspace;
  assert.equal(w.actions[0].config.recovery.enabled, true);
  assert.throws(() => add(w, a.uid, 'recovery', 1));
  w = patch(w, a.uid, 'recovery', {from: {...w.actions[0].config.recovery.at, seconds: 0.4}});
  assert.match(compileWorkspace(w), /<Recovery at="0.4"/);
  w = remove(w, a.uid, 'recovery');
  assert.doesNotMatch(compileWorkspace(w), /<Recovery /);
  assert.ok(w.actions[0].pair.carry);
});

test('shared recovery propagates pair timing and blend without changing either playback path', () => {
  const w = importWorkspaceXml(xml('<Recovery at="event:Ready" blend="0.3"/>'));
  const value = featureValue(w, w.actions[0].uid + '|recovery');
  assert.equal(value.type, 'recovery');
  applyFeature(w, w.actions[1].uid + '|recovery', value);
  assert.deepEqual(w.actions[1].config.recovery, w.actions[0].config.recovery);
  assert.equal(w.actions[1].config.steps[0].clip, 'Animations/Lower.hkx');
  assert.equal(w.actions[0].pair.carry.putdownAction, w.actions[1].uid);
  assert.equal((compileWorkspace(w).match(/<Recovery /g) || []).length, 2);
});
