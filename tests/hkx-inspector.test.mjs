import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {animId, editBlend} from '../src/graph/blends.ts';
import {
  actionBlends,
  detachInspectorNode,
  exitSummary,
  playbackNode,
  setSingleAttack,
} from '../src/ui/details/inspectorModel.ts';

function sample() {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) w = addFlat(w, '', 'playNode', {x: i * 300, y: 0}).workspace;
  for (const [i, a] of w.actions.entries()) {
    a.config.steps[0].clip = 'animations\\test.hkx';
    a.config.actionId = i ? 'test_' + (i + 1) : 'test';
  }
  return w;
}
test('Inspector navigation and summaries do not alter exported settings', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.exit = {...a.config.exit, basis: 'event', event: 'EndTest', fallback: true};
  const xml = compileWorkspace(w),
    roundtrip = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(playbackNode(flatGraph(w).nodes, a)?.step, a.config.entry);
  assert.ok(exitSummary(a).includes('EndTest'));
  actionBlends(w, a.uid);
  assert.equal(compileWorkspace(roundtrip), xml);
});
test('Single clip attack selector clears both default and override only on explicit edit', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.attack = 'attackStart';
  a.config.steps[0].attack = 'AttackStart';
  assert.ok(compileWorkspace(w).includes('attack="AttackStart"'));
  const next = setSingleAttack(a, '');
  assert.equal(a.config.attack, 'attackStart');
  assert.equal(next.config.attack, '');
  assert.equal(next.config.steps[0].attack, '');
  w.actions[0] = next;
  assert.ok(!compileWorkspace(w).includes('<Attack '));
});
