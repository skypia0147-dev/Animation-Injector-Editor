import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph} from '../src/graph/flat.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {checklistModel, checklistProjection, copyChecklistNodes, deleteChecklistNode} from '../src/graph/checklist.ts';
import {pasteNodes} from '../src/graph/clipboard.ts';
import {captureGraph} from '../src/graph/document.ts';
import {timelineRows, patch as patchTime} from '../src/timeline/model.ts';
import {switchActionKind} from '../src/actionTypes.ts';

// An HKX card's items (graph/checklist.ts): its features, moments and blends, drawn inside the card. In XML format 6
// an item is its action's at once: adding one writes it, deleting it takes it off (there is no switched-off item).
const sample = () => {
  const r = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}),
    w = r.workspace,
    a = w.actions[0];
  a.config.steps[0].clip = 'animations\\test.hkx';
  a.config.actionId = 'test';
  return {w, a, id: r.id};
};
const itemOf = (w, id, find) => checklistModel(w).items.get(id).find(find);

test('an item is written as soon as it is added and goes when it is deleted, across save', () => {
  let {w, id} = sample();
  const plain = compileWorkspace(w);
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const item = itemOf(w, id, i => i.node.notify?.startsWith('recovery'));
  assert.ok(item);
  assert.equal(item.removable, true);
  const loaded = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.match(compileWorkspace(loaded), /<MoveCancel /);
  const gone = deleteChecklistNode(loaded, item.node.id);
  assert.equal(gone.actions[0].config.recovery.enabled, false);
  assert.equal(compileWorkspace(gone), plain);
});
test('an end blend item writes the exit blend; deleting it leaves the engine`s own', () => {
  let {w, id} = sample();
  w.actions[0].exitBlendEnabled = false;
  const plain = compileWorkspace(w);
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  const item = itemOf(w, id, i => i.node.kind === 'blend' && i.blend === 'exit');
  assert.ok(item);
  assert.match(compileWorkspace(w), /<Exit blend="[\d.]+"\/>/);
  // The end of the action is no card: the blend is an item of the HKX card.
  assert.ok(!checklistProjection(w).nodes.some(n => n.kind === 'outputPose'));
  const off = deleteChecklistNode(w, item.node.id);
  assert.equal(off.actions[0].exitBlendEnabled, false);
  assert.equal(compileWorkspace(off), plain);
});
test('copy carries the items, gives a unique action ID and never mutates the original', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const original = JSON.stringify(w),
    result = pasteNodes(w, copyChecklistNodes(w, [id]), {x: 800, y: 0}, w.actions[0].uid);
  assert.equal(JSON.stringify(w), original);
  const a = result.workspace.actions.at(-1),
    m = checklistModel(result.workspace);
  const play = m.raw.nodes.find(n => n.kind === 'hkxPlay' && n.action === a.uid);
  assert.ok(m.items.get(play.id).some(i => i.node.notify === 'recovery'));
  assert.ok(a.config.recovery.enabled);
  assert.notEqual(a.config.actionId, w.actions[0].config.actionId);
  assert.doesNotThrow(() => compileWorkspace(result.workspace));
});
test('deleting a card removes its action with its items', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const result = deleteChecklistNode(w, id);
  assert.equal(result.actions.length, 0);
  assert.equal(flatGraph(result).nodes.filter(n => n.action).length, 0);
});
test('a pair`s camera restore is an item of its card; deleting it switches it off', () => {
  let {w, id, a} = sample();
  w = switchActionKind(w, a.uid, 'pair');
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].config.actionId = 'test';
  w.actions[0].cameraEnabled = true;
  w.actions[0].camera = {reset: 'RestoreCamera', restore: 'event', timeout: 10};
  const item = itemOf(w, id, i => i.node.kind === 'cameraRestore');
  assert.ok(item);
  assert.match(compileWorkspace(w), /<Camera reset="RestoreCamera" restore="event"\/>/);
  const off = deleteChecklistNode(w, item.node.id);
  assert.equal(off.actions[0].cameraEnabled, false);
  assert.doesNotThrow(() => compileWorkspace(off));
});
test('a clip-time shot is edited through the same data by card and timeline (0.12.302)', () => {
  let {w, a, id} = sample();
  w = addConnected(w, id, {kind: 'notify:fireArrow', label: '활 발사'}, {x: 0, y: 0}).workspace;
  let row = timelineRows(w, w.actions[0]).find(r => r.kind === 'fireArrow');
  assert.ok(row);
  w = patchTime(w, a.uid, row.id, {from: {...row.from, seconds: 0.7}});
  assert.equal(w.actions[0].config.effects.find(e => e.values.op === 'fireArrow').values.at, '0.7');
  assert.equal(
    checklistModel(w)
      .items.get(id)
      .filter(i => /fireArrow/.test(i.node.title + i.node.notify) || i.node.title === '활 발사').length,
    1
  );
});
test('presentation neither mutates document nor runtime XML and retains real endpoints', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const before = JSON.stringify(w),
    xml = compileWorkspace(w),
    g = checklistProjection(w);
  assert.equal(JSON.stringify(w), before);
  assert.deepEqual(compileWorkspace(w), xml);
  // Items are drawn inside their card, not as cards.
  assert.ok(!g.nodes.some(n => n.kind === 'blend' || n.kind === 'notify'));
  assert.ok(g.edges.every(e => g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target)));
  const model = checklistModel(w),
    recovery = model.items.get(id).find(i => i.node.notify?.startsWith('recovery'));
  assert.ok(recovery.bindings.some(e => e.source === id));
  assert.deepEqual(model.owners.get(recovery.node.id), [id]);
});
test('a copied HKX keeps its detection window', () => {
  let {w, a} = sample();
  const first = a.config.steps[0];
  a.clipWindows = {
    [first.id]: {
      open: {basis: 'seconds', seconds: 0.23, event: '', fallback: false, fallbackBasis: 'seconds'},
      close: {basis: 'end', seconds: 0.1, event: '', fallback: false, fallbackBasis: 'seconds'},
      buffered: false,
    },
  };
  const ids = checklistModel(w)
    .raw.nodes.filter(n => n.kind === 'hkxPlay')
    .map(n => n.id);
  const copied = pasteNodes(w, copyChecklistNodes(w, ids), {x: 800, y: 0}, a.uid).workspace;
  assert.equal(copied.actions.length, 2);
  assert.equal(copied.actions[1].config.steps.length, 1);
  assert.equal(copied.actions[1].clipWindows[first.id].open.seconds, 0.23);
  assert.equal(copied.actions[1].clipWindows[first.id].buffered, false);
  assert.doesNotThrow(() => compileWorkspace(copied));
});
test('an imported project draws the same cards as one made in the editor', () => {
  const made = sample().w;
  made.starts.push({
    uid: 'start1',
    mode: 'input',
    key: 'G',
    gamepad: 0,
    event: '',
    actor: 'both',
    target: 'nearest',
    press: 'down',
    cooldown: 0,
    to: {action: 'a1'},
    position: {x: 0, y: 0},
  });
  const kinds = w =>
    checklistProjection(w)
      .nodes.map(n => n.kind)
      .sort();
  const imported = importWorkspaceXml(compileWorkspace(made));
  assert.deepEqual(kinds(imported), kinds(made));
  assert.ok(!checklistProjection(imported).nodes.some(n => n.kind === 'entry'));
});
test('a start added to a new HKX is a start card going to it; the action keeps no key for it', () => {
  const {w, id} = sample();
  const byEvent = addConnected(w, id, {label: '시작 이벤트 추가', kind: 'markerReceive', before: true}, {x: 0, y: 0});
  assert.match(byEvent.id, /^startCard:/);
  assert.deepEqual(
    byEvent.workspace.starts.map(s => [s.mode, s.to]),
    [['event', {action: 'a1'}]]
  );
  assert.deepEqual(byEvent.workspace.actions[0].config.inputs, []);
  const byKey = addConnected(w, id, {label: '시작 키 입력 추가', kind: 'keyInput', before: true}, {x: 0, y: 0});
  assert.deepEqual(
    byKey.workspace.starts.map(s => [s.mode, s.key, s.to]),
    [['input', 'Num0', {action: 'a1'}]]
  );
  assert.deepEqual(byKey.workspace.actions[0].config.inputs, []);
});
test('an ordinary action takes a camera restore (runtime 0.12.260): add, XML, reopen, delete', () => {
  let {w, id} = sample();
  w.globals.cameraReset = 'CameraBack';
  assert.ok(
    contextualAdds(w, id).some(o => o.kind === 'cameraRestore'),
    'offered on an ordinary HKX card'
  );
  w = addConnected(w, id, {kind: 'cameraRestore', label: '카메라 복구 추가'}, {x: 0, y: 0}).workspace;
  const a = w.actions[0];
  assert.equal(a.pair, null);
  assert.equal(a.cameraEnabled, true);
  assert.equal(a.camera.reset, 'CameraBack');
  assert.ok(!contextualAdds(w, id).some(o => o.kind === 'cameraRestore'), 'one per action');
  const xml = compileWorkspace(w);
  assert.match(xml, /<Action [^>]*>[\s\S]*<Camera reset="CameraBack"\/>[\s\S]*<\/Action>/);
  // The XML reads back as the same setting, and the project round-trips.
  const back = importWorkspaceXml(xml).actions[0];
  assert.equal(back.cameraEnabled, true);
  assert.equal(back.camera.reset, 'CameraBack');
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), JSON.parse(JSON.stringify(w)));
  const item = itemOf(w, id, i => i.node.kind === 'cameraRestore');
  assert.ok(item, 'a card item');
  const off = deleteChecklistNode(w, item.node.id);
  assert.equal(off.actions[0].cameraEnabled, false);
  assert.doesNotMatch(compileWorkspace(off), /<Camera/);
});
