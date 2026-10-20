import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace, compileWorkspace, addAction} from '../src/workspace.ts';
import {addFlat, deleteFlat, flatGraph, connectFlat} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {shareRules} from '../src/graph/sharing.ts';
import {rows} from '../src/timeline/model.ts';
import {lowerBlends} from '../src/graph/blends.ts';

function sample() {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
    const a = w.actions.at(-1);
    a.config.steps[0].clip = `animations\\Test${i}.hkx`;
    a.config.start.mode = 'event';
    a.config.start.event = `Test${i}`;
  }
  return w;
}
const play = a => `anim:${a.uid}:|clip_${a.config.entry}`;
const roundtrip = w => parseWorkspace(JSON.stringify(captureGraph(w)));

test('single, combo, directional and paired owners all retire after their final playback is deleted', () => {
  for (const kind of ['single', 'combo', 'directional', 'pair']) {
    let w = emptyWorkspace();
    w.actions.push(addAction(w, kind));
    w.actions[0].nodeAuthored = true;
    const total = w.actions[0].config.steps.length;
    for (let i = 0; i < total; i++) {
      w = deleteFlat(w, flatGraph(w).nodes.find(n => n.kind === 'hkxPlay').id);
      assert.equal(w.actions.length, i === total - 1 ? 0 : 1, kind);
    }
    assert.equal(roundtrip(w).actions.length, 0, kind);
  }
});

test('last HKX deletes its runtime owner and preserves reconnectable event and recovery settings', () => {
  const w = sample(),
    [a, b] = w.actions;
  a.config.recovery.enabled = true;
  a.config.recovery.blend = 0.4;
  a.config.start.onKeyUp = true;
  const before = JSON.stringify(w),
    saved = structuredClone(b);
  let next = deleteFlat(w, play(a));
  assert.equal(JSON.stringify(w), before);
  assert.deepEqual(next.actions, [saved]);
  assert.ok(!compileWorkspace(next).includes(a.config.actionId + '"'));
  assert.equal(next.drafts.find(d => d.kind === 'markerReceive').value.config.start.onKeyUp, true);
  next = roundtrip(next);
  const draft = next.drafts.find(d => d.kind === 'notify:recovery');
  next = connectFlat(next, play(b), draft.id);
  assert.equal(next.actions[0].config.recovery.blend, 0.4);
});

test('shared settings retain remaining playback and do not become duplicate independent nodes', () => {
  let w = sample();
  for (const a of w.actions) {
    a.config.rotationLocked = true;
    a.config.recovery.enabled = true;
  }
  w = shareRules(w);
  const [a, b] = w.actions,
    expected = structuredClone(b);
  const next = roundtrip(deleteFlat(w, play(a)));
  assert.deepEqual(next.actions, [expected]);
  assert.ok(!next.drafts.some(d => d.kind === 'notify:rotate' || d.kind === 'notify:recovery'));
  assert.ok(compileWorkspace(next));
});

test('loading old empty owner repairs it once without discarding other actions or draft snapshots', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.steps = [];
  a.config.entry = '';
  const n = roundtrip(w);
  assert.equal(n.actions.length, 1);
  assert.equal(n.drafts.length, 1);
  assert.equal(n.drafts[0].kind, 'markerReceive');
  assert.deepEqual(roundtrip(n), JSON.parse(JSON.stringify(n)));
  assert.ok(compileWorkspace(n));
});

test('branch target deletion clears only that destination and keeps other branch settings', () => {
  const w = sample(),
    [a, b] = w.actions;
  a.flow = {
    entry: 'C',
    tests: [{id: 'C', kind: 'female', subject: 'self', minimum: 0, pass: {action: b.uid}, fail: {action: a.uid}}],
  };
  const n = deleteFlat(w, play(b));
  assert.equal(n.actions[0].flow.tests[0].pass, undefined);
  assert.deepEqual(n.actions[0].flow.tests[0].fail, {action: a.uid});
  assert.ok(compileWorkspace(roundtrip(n)));
});

test('deleting flow owner retains its condition definition as an editable detached group', () => {
  const w = sample(),
    [a, b] = w.actions;
  a.flow = {
    entry: 'C',
    tests: [{id: 'C', kind: 'female', subject: 'self', minimum: 0, pass: {action: b.uid}, fail: {action: a.uid}}],
  };
  const n = roundtrip(deleteFlat(w, play(a))),
    d = n.drafts.find(d => d.kind === 'conditionTable');
  assert.ok(d);
  assert.equal(d.value.flow.tests[0].kind, 'female');
  assert.deepEqual(d.value.flow.tests[0].pass, {action: b.uid});
  assert.equal(d.value.flow.tests[0].fail, undefined);
  const attached = connectFlat(n, d.id, play(b), 'choice:C:fail');
  assert.deepEqual(attached.actions[0].flow.tests[0].fail, {action: b.uid});
});

test('detached blend/input can be reused after deleting last playback without ghost IDs', () => {
  let w = sample(),
    a = w.actions[0];
  w.blends = [{id: `anim:${a.uid}:|blendIn`, source: `start:${a.uid}|markerReceive`, target: play(a), seconds: 0.37}];
  w = deleteFlat(w, play(a));
  const blend = w.blends[0],
    input = w.drafts.find(d => d.kind === 'markerReceive');
  assert.equal(blend.source, input.id);
  assert.equal(blend.target, '');
  const r = addFlat(w, '', 'playNode', {x: 0, y: 0});
  w = r.workspace;
  w.actions.at(-1).config.steps[0].clip = 'animations\\New.hkx';
  w = connectFlat(w, blend.id, r.id);
  assert.equal(w.actions.at(-1).config.start.event, 'Test0');
  assert.equal(lowerBlends(w).actions.at(-1).config.enterBlend, 0.37);
  assert.ok(compileWorkspace(roundtrip(w)));
});

test('retired pair features reconnect individually without duplicating other pair effects', () => {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) w.actions.push(addAction(w, 'pair'));
  const [a, b] = w.actions;
  a.nodeAuthored = true;
  b.nodeAuthored = true;
  a.pair.effectsEnabled = true;
  a.pair.timeline.iframe.enabled = true;
  a.pair.timeline.iframe.from.seconds = 0.25;
  a.pair.effects = [{id: 'E', values: {op: 'hide', at: '0.4', target: 'receiver'}}];
  b.pair.effects = [];
  b.pair.effectsEnabled = false;
  let n = roundtrip(deleteFlat(w, play(a)));
  const iframe = n.drafts.find(d => d.kind === 'notify:iframe');
  assert.ok(iframe);
  assert.equal(iframe.value.pair.effects.length, 0);
  n = connectFlat(n, play(b), iframe.id);
  assert.equal(n.actions[0].pair.timeline.iframe.enabled, true);
  assert.equal(n.actions[0].pair.effects.length, 0);
  const hide = n.drafts.find(d => d.kind === 'notify:hide');
  assert.ok(hide);
  n = connectFlat(n, play(b), hide.id);
  assert.equal(n.actions[0].pair.effects.filter(e => e.values.op === 'hide' && e.values.at === '0.4').length, 1);
  assert.equal(rows(n, n.actions[0]).filter(r => r.kind === 'iframe').length, 1);
});

test('full rotation lock survives retiring and reconnecting its independent node', () => {
  const w = sample(),
    [a, b] = w.actions;
  a.config.rotationLocked = true;
  const n = deleteFlat(w, play(a)),
    d = n.drafts.find(d => d.kind === 'notify:rotate');
  assert.ok(d);
  const attached = connectFlat(roundtrip(n), play(b), d.id);
  assert.equal(attached.actions[0].config.rotationLocked, true);
});

test('incoming and outgoing combo links detach inputs without invalid action references', () => {
  const w = sample(),
    [a, b] = w.actions;
  const template = {
    partnerTo: '',
    mode: 'event',
    input: '',
    event: 'Next',
    window: false,
    open: {basis: 'seconds', seconds: 0, event: '', fallback: false},
    close: {basis: 'end', seconds: 0, event: '', fallback: false},
    buffered: true,
    position: {x: 0, y: 0},
  };
  // Use valid timing objects from an existing slot rather than introducing a test-only format.
  template.open = structuredClone(a.config.recovery.at);
  template.close = structuredClone(a.config.recovery.at);
  w.links = [
    {...template, id: 'L1', from: a.uid, to: b.uid},
    {...template, id: 'L2', from: b.uid, to: a.uid, event: 'Return'},
  ];
  const n = roundtrip(deleteFlat(w, play(a)));
  assert.equal(n.links.length, 0);
  assert.deepEqual(
    n.drafts
      .filter(d => d.kind === 'markerReceive')
      .map(d => d.value.config.start.event)
      .sort(),
    ['Next', 'Return', 'Test0']
  );
  assert.ok(compileWorkspace(n));
});

test('deleting a shared representative keeps disconnections belonging to surviving members', () => {
  let w = sample();
  for (const a of w.actions) a.config.recovery.enabled = true;
  w = shareRules(w);
  const [a, b] = w.actions;
  const left = {source: play(a), target: `notify:${a.uid}|recovery`, pin: 'trigger'};
  const right = {source: play(b), target: `notify:${b.uid}|recovery`, pin: 'trigger'};
  w.disconnections = [{...left, bindings: [left, right]}];
  const n = deleteFlat(w, play(a));
  assert.equal(n.disconnections.length, 1);
  assert.deepEqual(n.disconnections[0].bindings, [right]);
  assert.equal(n.disconnections[0].source, right.source);
});
