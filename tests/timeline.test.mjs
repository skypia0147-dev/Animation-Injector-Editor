import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {
  rows,
  add,
  remove,
  patch,
  duplicate,
  tracks,
  addTrack,
  assignTrack,
  trackOf,
  timeOf,
  extent,
  retime,
} from '../src/timeline/model.ts';
import {mark} from '../src/model.ts';
const setup = (kind = 'single') => {
  const w = emptyWorkspace(),
    a = addAction(w, kind);
  w.actions.push(a);
  return {w, a};
};
test('notify presence follows enabled flags; deleting keeps hidden values', () => {
  const {w, a} = setup();
  a.config.cost.enabled = false;
  a.config.cost.stamina = 27;
  assert.ok(!rows(w, a).some(r => r.kind === 'cost'));
  const n = add(w, a.uid, 'cost', 0.2).workspace;
  assert.equal(n.actions[0].config.cost.stamina, 27);
  const d = remove(n, a.uid, 'cost');
  assert.equal(d.actions[0].config.cost.stamina, 27);
  assert.equal(d.actions[0].config.cost.enabled, false);
});
test('singletons reject duplicates while pair role effects copy independently', () => {
  const {w, a} = setup('pair');
  const first = add(w, a.uid, 'iframe', 0.1);
  const normal = setup();
  const one = add(normal.w, normal.a.uid, 'iframe', 0.1);
  assert.throws(() => add(one.workspace, normal.a.uid, 'iframe', 0.2));
  const e = add(first.workspace, a.uid, 'hide', 0.4);
  const c = duplicate(e.workspace, a.uid, e.id, 1);
  assert.equal(c.workspace.actions[0].pair.effects.length, 2);
  assert.notEqual(c.id, e.id);
  assert.throws(() => duplicate(one.workspace, normal.a.uid, one.id, 1));
});
test('paired range duplication keeps two runtime events grouped through edit and reopen', () => {
  const {w, a} = setup('pair');
  const first = add(w, a.uid, 'rotate', 0.1);
  const next = duplicate(first.workspace, a.uid, first.id, 1);
  const r = rows(next.workspace, next.workspace.actions[0]).find(r => r.id === next.id);
  assert.equal(r.from.seconds, 1);
  assert.equal(r.until.seconds, 1.5);
  assert.equal(next.workspace.actions[0].pair.effects.length, 2);
  const changed = patch(next.workspace, a.uid, next.id, {until: mark(1.8)});
  const restored = parseWorkspace(JSON.stringify(changed));
  assert.equal(rows(restored, restored.actions[0]).find(r => r.id === next.id).until.seconds, 1.8);
  assert.match(compileWorkspace(restored), /rotateOn/);
  assert.match(compileWorkspace(restored), /rotateOff/);
  const removed = remove(restored, a.uid, next.id);
  assert.equal(removed.actions[0].pair.effects.length, 0);
  assert.equal(removed.actions[0].pair.timeline.rotate.enabled, true);
});
test('pair ranges and ordinary ranges edit through the same marks without changing roles', () => {
  const {w, a} = setup('pair');
  const n = add(w, a.uid, 'iframe', 0.2);
  n.workspace.actions[0].pair.timeline.iframe.role = 'receiver';
  const next = patch(n.workspace, a.uid, n.id, {until: mark(1.2)});
  assert.equal(next.actions[0].pair.timeline.iframe.until.seconds, 1.2);
  assert.equal(next.actions[0].pair.timeline.iframe.role, 'receiver');
  assert.equal(next.actions[0].pair.effectsEnabled, true);
});
test('event position uses actual annotations including time zero, never the saved fallback', () => {
  const event = {...mark(99), basis: 'event', event: 'Open', fallback: true};
  const m = {duration: 2, tracks: 1, annotations: [{time: 0, text: 'Open', track: 'NPC'}]};
  assert.equal(timeOf(event, 2, m), 0);
  assert.equal(timeOf({...event, event: 'Missing'}, 2, m), undefined);
  assert.equal(timeOf(event, 2), undefined);
  assert.equal(extent([], m), 2);
  assert.equal(timeOf(mark(0.3, 'end'), 2, m), 1.7);
});
test('multiple annotation occurrences remain available; first occurrence positions one-shot slots', () => {
  const m = {
    duration: 3,
    tracks: 2,
    annotations: [
      {text: 'Hit', time: 0.8, track: 'A1'},
      {text: 'Hit', time: 1.5, track: 'A2'},
    ],
  };
  assert.equal(timeOf({...mark(), basis: 'event', event: 'Hit'}, 3, m), 0.8);
  assert.equal(m.annotations.length, 2);
});
test('moving end-relative marks preserves their basis', () => {
  const n = retime(mark(0.2, 'end'), 1.4, 2);
  assert.equal(n.basis, 'end');
  assert.equal(n.seconds, 0.6);
});
test('track assignments roundtrip without changing executable XML', () => {
  const {w, a} = setup();
  const n = add(w, a.uid, 'rotate', 0.1).workspace,
    xml = compileWorkspace(n);
  const moved = assignTrack(addTrack(n, a.uid), a.uid, 'rotate', 2);
  assert.deepEqual(tracks(moved, a.uid), [1, 2]);
  const restored = parseWorkspace(JSON.stringify(moved));
  assert.equal(trackOf(restored, a.uid, 'rotate'), 2);
  assert.equal(compileWorkspace(restored), xml);
});
test('combo transition timeline filters by the active source clip', () => {
  const {w, a} = setup('combo');
  assert.ok(
    rows(w, a, 'A2')
      .filter(r => r.transition)
      .every(r => a.config.transitions.find(tr => 'window:' + tr.id === r.id).from === 'A2')
  );
});
