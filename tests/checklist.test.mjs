import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph} from '../src/graph/flat.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {
  checklistModel,
  checklistProjection,
  setChecklistEnabled,
  copyChecklistNodes,
  deleteChecklistNode,
} from '../src/graph/checklist.ts';
import {pasteNodes} from '../src/graph/clipboard.ts';
import {captureGraph} from '../src/graph/document.ts';
import {lowerDisconnected} from '../src/graph/disconnect.ts';
import {lowerBlends} from '../src/graph/blends.ts';
import {timelineRows, patch as patchTime} from '../src/timeline/model.ts';
import {switchActionKind} from '../src/actionTypes.ts';
const sample = () => {
  const r = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}),
    w = r.workspace,
    a = w.actions[0];
  a.config.steps[0].clip = 'animations\\test.hkx';
  return {w, a, id: r.id};
};
test('checklist editing excludes a recovery while preserving its settings across save and restores it', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  let item = checklistModel(w)
    .items.get(id)
    .find(i => i.node.notify?.startsWith('recovery'));
  assert.ok(item);
  assert.ok(item.enabled);
  w = setChecklistEnabled(w, item, false);
  let loaded = parseWorkspace(JSON.stringify(captureGraph(w)));
  item = checklistModel(loaded)
    .items.get(id)
    .find(i => i.node.id === item.node.id);
  assert.equal(item.enabled, false);
  assert.equal(lowerDisconnected(loaded).actions[0].config.recovery.enabled, false);
  loaded = setChecklistEnabled(loaded, item, true);
  assert.equal(
    checklistModel(loaded)
      .items.get(id)
      .find(i => i.node.id === item.node.id).enabled,
    true
  );
});
test('disabling an exit override keeps its item to switch on again and restores the saved time', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  const item = checklistModel(w)
    .items.get(id)
    .find(i => i.node.kind === 'blend');
  const original = compileWorkspace(w);
  w = setChecklistEnabled(w, item, false);
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(lowerBlends(lowerDisconnected(w)).actions[0].exitBlendEnabled, false);
  // The end of the action is no card: the switched-off exit blend stays an item of the HKX card.
  const after = checklistModel(w)
    .items.get(id)
    .find(i => i.node.id === item.node.id);
  assert.equal(after.enabled, false);
  assert.ok(after.toggleable);
  assert.ok(!checklistProjection(w).nodes.some(n => n.kind === 'outputPose'));
  assert.doesNotThrow(() => compileWorkspace(w));
  assert.equal(compileWorkspace(setChecklistEnabled(w, item, true)), original);
});
test('copy preserves disabled settings, unique action IDs and never mutates original blends', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const item = checklistModel(w)
    .items.get(id)
    .find(i => i.node.notify === 'recovery');
  w = setChecklistEnabled(w, item, false);
  const original = JSON.stringify(w),
    result = pasteNodes(w, copyChecklistNodes(w, [id]), {x: 800, y: 0}, w.actions[0].uid);
  assert.equal(JSON.stringify(w), original);
  const a = result.workspace.actions.at(-1),
    m = checklistModel(result.workspace);
  const play = m.raw.nodes.find(n => n.kind === 'hkxPlay' && n.action === a.uid);
  assert.equal(m.items.get(play.id).find(i => i.node.notify === 'recovery').enabled, false);
  assert.notEqual(a.config.actionId, w.actions[0].config.actionId);
  assert.deepEqual(
    result.workspace.blends.filter(b => w.blends.some(old => old.id === b.id)),
    w.blends
  );
  assert.equal(result.workspace.drafts?.length ?? 0, 0);
  assert.doesNotThrow(() => compileWorkspace(result.workspace));
});
test('deleting a card removes owned features and blends without resurrecting drafts', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const result = deleteChecklistNode(w, id);
  assert.equal(result.actions.length, 0);
  assert.equal(result.blends.length, 0);
  assert.equal(result.drafts?.length ?? 0, 0);
});
test('camera checkbox does not break a pair terminal route', () => {
  let {w, id, a} = sample();
  w = switchActionKind(w, a.uid, 'pair');
  w.actions[0].config.steps[0].clip = 'animations\\test.hkx';
  w.actions[0].cameraEnabled = true;
  w.actions[0].camera = {reset: 'RestoreCamera', restore: 'event', timeout: 10};
  const item = checklistModel(w)
    .items.get(id)
    .find(i => i.node.kind === 'cameraRestore');
  assert.ok(item);
  w = setChecklistEnabled(w, item, false);
  assert.equal(lowerDisconnected(w).actions[0].cameraEnabled, false);
  assert.doesNotThrow(() => compileWorkspace(w));
});
test('fire timing is edited through the same data by card and timeline', () => {
  let {w, a} = sample();
  a.config.fireArrow = {at: {basis: 'seconds', seconds: 0.3, event: '', fallback: false, fallbackBasis: 'seconds'}};
  let row = timelineRows(w, a).find(r => r.id === 'runtime:fireArrow');
  assert.equal(row.from.seconds, 0.3);
  w = patchTime(w, a.uid, row.id, {from: {...row.from, seconds: 0.7}});
  assert.equal(w.actions[0].config.fireArrow.at.seconds, 0.7);
  assert.equal(checklistModel(w).raw.nodes.filter(n => n.kind === 'fireArrow').length, 1);
});
test('presentation neither mutates document nor runtime XML and retains real endpoints', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'blend', label: 'exit'}, {x: 0, y: 0}).workspace;
  const before = JSON.stringify(w),
    xml = compileWorkspace(w),
    g = checklistProjection(w);
  assert.equal(JSON.stringify(w), before);
  assert.deepEqual(compileWorkspace(w), xml);
  assert.equal(
    g.nodes.some(n => n.kind === 'blend'),
    false
  );
  assert.ok(g.edges.every(e => g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target)));
  // The exit blend's real endpoints (HKX → blend → end of the action) stay with its item on the HKX card.
  assert.ok(!g.nodes.some(n => n.kind === 'outputPose'));
  const exit = checklistModel(w)
    .items.get(id)
    .find(i => i.node.kind === 'blend');
  assert.ok(exit.bindings.some(e => e.source === id));
  assert.ok(exit.bindings.some(e => e.target.endsWith('|outputPose')));
  // A check located at the end of the action (an output pose) shows the HKX card.
  const model = checklistModel(w),
    end = model.raw.nodes.find(n => n.kind === 'outputPose');
  assert.deepEqual(model.owners.get(end.id), [id]);
});
test('copying a B card carries attached recovery rather than only its HKX', () => {
  let {w, id} = sample();
  w = addConnected(w, id, {kind: 'notify:recovery', label: 'recovery'}, {x: 0, y: 0}).workspace;
  const clip = copyChecklistNodes(w, [id]),
    result = pasteNodes(w, clip, {x: 800, y: 0}, w.actions[0].uid);
  const copy = result.workspace.actions.at(-1);
  assert.notEqual(copy.uid, w.actions[0].uid);
  assert.ok(copy.config.recovery.enabled || copy.config.steps.some(s => s.recovery?.enabled));
});

test('a copied HKX keeps its detection window', () => {
  let {w, a, id} = sample();
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

test('unassigned feature data remains editable and can be assigned without a canvas helper', () => {
  let {w, id, a} = sample();
  const r = addFlat(w, a.uid, 'notify:recovery', {x: 400, y: 0});
  w = r.workspace;
  const model = checklistModel(w);
  assert.ok(model.unassigned.some(n => n.id === r.id));
  assert.equal(
    checklistProjection(w).nodes.some(n => n.id === r.id),
    false
  );
  assert.ok(parseWorkspace(JSON.stringify(captureGraph(w))).drafts.some(d => d.id === r.id));
});

test('copy includes a projected condition table rather than silently copying only hidden attachments', () => {
  const {w, a} = sample();
  a.flow = {entry: 'check', tests: [{id: 'check', kind: 'alive', subject: 'self', minimum: 0}]};
  w.conditionTables = [a.uid];
  const id = 'conditionTable:' + a.uid,
    clip = copyChecklistNodes(w, [id]);
  assert.ok(clip.graph.nodes.some(n => n.id === id));
  const result = pasteNodes(w, clip, {x: 800, y: 0}, a.uid).workspace;
  assert.ok(result.drafts.some(d => d.kind === 'conditionTable' && d.value.flow.tests[0].kind === 'alive'));
});
test('an imported project draws no entry card, as one made in the editor', () => {
  const made = sample().w;
  assert.ok(!checklistProjection(made).nodes.some(n => n.kind === 'entry'));
  const imported = importWorkspaceXml(compileWorkspace(made));
  assert.ok(imported.actions.every(a => !a.nodeAuthored));
  assert.ok(flatGraph(imported).nodes.some(n => n.kind === 'entry'));
  const g = checklistProjection(imported);
  assert.ok(!g.nodes.some(n => n.kind === 'entry'));
  assert.ok(g.edges.every(e => e.source !== 'entry' && e.target !== 'entry'));
});
test('a start added to a new HKX brings only the input it reads', () => {
  const {w, id} = sample();
  const byEvent = addConnected(w, id, {label: '시작 이벤트 추가', kind: 'markerReceive', before: true}, {x: 0, y: 0})
    .workspace.actions[0];
  assert.equal(byEvent.config.start.mode, 'event');
  assert.deepEqual(byEvent.config.inputs, []);
  const byKey = addConnected(w, id, {label: '시작 키 입력 추가', kind: 'keyInput', before: true}, {x: 0, y: 0})
    .workspace.actions[0];
  assert.equal(byKey.config.start.mode, 'input');
  assert.equal(byKey.config.inputs.length, 1);
  assert.equal(byKey.config.inputs[0].id, byKey.config.start.input);
});
test('an ordinary action takes a camera restore (runtime 0.12.260): add, XML, reopen, switch off', () => {
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
  assert.match(xml, /<Action [^>]*>[\s\S]*<Effects>\s*<Camera reset="CameraBack"\/>\s*<\/Effects>[\s\S]*<\/Action>/);
  // The XML reads back as the same setting, and the project round-trips.
  const back = importWorkspaceXml(xml).actions[0];
  assert.equal(back.cameraEnabled, true);
  assert.equal(back.camera.reset, 'CameraBack');
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), JSON.parse(JSON.stringify(w)));
  const item = checklistModel(w)
    .items.get(id)
    .find(i => i.node.kind === 'cameraRestore');
  assert.ok(item, 'a card item');
  const off = lowerDisconnected(setChecklistEnabled(w, item, false));
  assert.equal(off.actions[0].cameraEnabled, false);
  assert.doesNotMatch(compileWorkspace(off), /<Effects>/);
});
test('a project saved with the camera on the pair opens with it on the action', () => {
  const {w} = sample();
  const old = JSON.parse(JSON.stringify(switchActionKind(w, w.actions[0].uid, 'pair')));
  Object.assign(old.actions[0].pair, {cameraEnabled: true, camera: {reset: 'R', restore: 'event', timeout: 4}});
  const opened = parseWorkspace(JSON.stringify(old)).actions[0];
  assert.equal(opened.cameraEnabled, true);
  assert.deepEqual(opened.camera, {reset: 'R', restore: 'event', timeout: 4});
  assert.ok(!('camera' in opened.pair) && !('cameraEnabled' in opened.pair));
});
