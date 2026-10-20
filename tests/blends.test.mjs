import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {emptyWorkspace, compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {blendNodes, blendBinding, editBlend, lowerBlends, animId} from '../src/graph/blends.ts';
import {flatGraph, addFlat, connectFlat, deleteFlat} from '../src/graph/flat.ts';
import {moveNodes} from '../src/graph/projection.ts';

test('legacy blend values lower without XML changes; start result is omitted', () => {
  const w = s4sample();
  assert.equal(compileWorkspace({...w, blends: blendNodes(w)}), compileWorkspace(w));
  const g = flatGraph(w);
  assert.ok(!g.nodes.some(n => n.scope.kind === 'start' && n.original === 'result'));
  assert.ok(!g.nodes.some(n => ['blendIn', 'blendOut'].includes(n.kind)));
  assert.ok(g.nodes.some(n => n.kind === 'blend'));
});
test('same blend changes from entry to exit by endpoints, survives save and deletes cleanly', () => {
  let w = s4sample();
  const a = w.actions[0];
  w.blends = [];
  const r = addFlat(w, a.uid, 'blend', {x: 1, y: 2});
  w = r.workspace;
  assert.throws(() => compileWorkspace(w), /양쪽/);
  w = connectFlat(w, `start:${a.uid}|keyInput`, r.id);
  w = connectFlat(w, r.id, a.uid);
  w = editBlend(w, r.id, {seconds: 0.7});
  let lower = lowerBlends(w);
  assert.equal(lower.actions[0].config.enterBlend, 0.7);
  assert.equal(lower.actions[0].exitBlendEnabled, false);
  w = editBlend(w, r.id, {source: a.uid, target: animId(a.uid, 'outputPose')});
  w = parseWorkspace(JSON.stringify(w));
  lower = lowerBlends(w);
  assert.equal(lower.actions[0].enterBlendEnabled, false);
  assert.equal(lower.actions[0].config.exitBlend, 0.7);
  assert.match(compileWorkspace(w), /<Exit[^>]*blend="0.7"/);
  assert.equal(lowerBlends(deleteFlat(w, r.id)).actions[0].exitBlendEnabled, false);
});
test('cross-action blend uses target entry; conflicting entry routes cannot silently override', () => {
  let w = s4sample();
  const l = w.links[0];
  w.blends = [{id: 'test', source: l.from, target: l.to, seconds: 0.85}];
  assert.equal(lowerBlends(w).actions.find(a => a.uid === l.to).config.enterBlend, 0.85);
  w.blends.push({id: 'conflict', source: 'entry', target: l.to, seconds: 0.2});
  assert.throws(() => compileWorkspace(w), /충돌/);
});
test('invalid or dangling blends are rejected; coordinates never change executable XML', () => {
  let w = s4sample();
  w.blends = blendNodes(w);
  const xml = compileWorkspace(w);
  w = moveNodes(w, {kind: 'root'}, {[w.blends[0].id]: {x: 9000, y: -2000}});
  assert.equal(compileWorkspace(w), xml);
  w.blends[0].target = 'missing';
  assert.ok(validateWorkspace(w).some(i => i.level === 'error'));
  w.blends[0].seconds = NaN;
  assert.throws(() => parseWorkspace(JSON.stringify(w)));
});

test('standalone HKX accepts entry and optional terminal blends without hidden state endpoints', () => {
  let w = emptyWorkspace();
  w.blends = [];
  let added = addFlat(w, '', 'playNode', {x: 0, y: 0});
  w = added.workspace;
  const a = w.actions[0],
    hkx = added.id;
  a.config.start.mode = 'input';
  const start = `start:${a.uid}|keyInput`;
  const b = addFlat(w, a.uid, 'blend', {x: 10, y: 0});
  w = connectFlat(b.workspace, start, b.id);
  w = connectFlat(w, b.id, hkx);
  assert.equal(blendBinding(w, w.blends[0]).kind, 'enter');
  let g = flatGraph(w);
  assert.ok(g.edges.some(e => e.source === start && e.target === b.id));
  assert.ok(g.edges.some(e => e.source === b.id && e.target === hkx));
  assert.ok(!g.edges.some(e => e.source === start && e.target === hkx));
  assert.ok(!g.nodes.some(n => n.kind === 'result' || n.kind === 'outputPose'));
  w = editBlend(w, b.id, {target: '', source: hkx});
  w = connectFlat(w, b.id, animId(a.uid, 'outputPose'));
  g = flatGraph(w);
  assert.ok(g.nodes.some(n => n.title === '재생 종료'));
  assert.equal(lowerBlends(w).actions[0].exitBlendEnabled, true);
  assert.ok(!flatGraph(deleteFlat(w, b.id)).nodes.some(n => n.kind === 'outputPose'));
});

test('result removal preserves ordinary, paired partner and blended routes without bypasses', () => {
  let w = s4sample();
  const l = w.links.find(l => l.partnerTo) ?? w.links[0];
  w.blends = [
    {
      id: 'edgeBlend',
      source: `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
      target: l.to,
      seconds: 0.4,
    },
  ];
  const g = flatGraph(w),
    input = w.blends[0].source;
  assert.ok(!g.nodes.some(n => n.kind === 'result'));
  assert.ok(g.edges.some(e => e.source === input && e.target === 'edgeBlend'));
  assert.ok(g.edges.some(e => e.source === 'edgeBlend' && e.target === l.to));
  assert.ok(!g.edges.some(e => e.source === input && e.target === l.to));
  if (l.partnerTo) assert.ok(g.edges.some(e => e.source === input && e.target === l.partnerTo && e.pin === 'partner'));
  assert.equal(lowerBlends(w).actions.find(a => a.uid === l.to).config.enterBlend, 0.4);
  const restored = parseWorkspace(JSON.stringify(w));
  assert.equal(compileWorkspace(w), compileWorkspace(restored));
});

test('input-node deletion removes its blend and retargeting updates the blend destination', () => {
  const w = s4sample(),
    l = w.links[0];
  const key = `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`;
  w.blends = [{id: 'routeBlend', source: key, target: l.to, seconds: 0.35}];
  const destination = w.actions.find(a => a.uid !== l.from && a.uid !== l.to);
  assert.ok(destination);
  const next = connectFlat(w, key, destination.uid);
  assert.equal(next.links[0].to, destination.uid);
  assert.equal(next.blends[0].target, destination.uid);
  const deleted = deleteFlat(next, key);
  assert.ok(!deleted.links.some(x => x.id === l.id));
  assert.ok(!deleted.blends.some(x => x.id === 'routeBlend'));
  assert.equal(w.links[0].to, l.to);
});

test("a transition's added blend runs to the destination it already has and becomes the Connect's blend", async () => {
  const {playbackLink} = await import('../src/graph/playback.ts');
  const {addConnected} = await import('../src/graph/contextAdd.ts');
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    w = addFlat(w, '', 'playNode', {x: i * 400, y: 0}).workspace;
    w.actions[i].config.steps[0].clip = `Animations\Test\${i}.hkx`;
    w.actions[i].config.actionId = 'Act' + i;
  }
  const r = playbackLink(w, w.actions[0].uid, w.actions[1].uid, {id: 'k', label: 'G', key: 'G', gamepad: 0});
  w = r.workspace;
  const added = addConnected(w, r.id, {kind: 'blend', label: '블렌드 추가'}, {x: 200, y: 100});
  w = editBlend(added.workspace, added.id, {seconds: 0.25});
  const b = w.blends.find(b => b.id === added.id);
  assert.deepEqual([b.source, b.target], [r.id, animId(w.actions[1].uid, 'clip_' + w.actions[1].config.entry)]);
  assert.equal(lowerBlends(w).links[0].blend, 0.25);
  assert.match(compileWorkspace(w), /<Connect to="Act1" blend="0.25" key="G">/);
  // Asked again, the same blend is given back.
  assert.equal(addConnected(w, r.id, {kind: 'blend', label: '블렌드 추가'}, {x: 0, y: 0}).id, added.id);
});

test("an HKX's start and end blends added from its features start at 0.3 s (10-20)", async () => {
  const {addConnected} = await import('../src/graph/contextAdd.ts');
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 0, y: 0}).workspace;
  w.actions[0].config.steps[0].clip = 'Animations\Test\A.hkx';
  w.actions[0].config.actionId = 'Act0';
  w.actions[0].enterBlendEnabled = w.actions[0].exitBlendEnabled = false;
  const play = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay');
  for (const before of [true, false])
    w = addConnected(w, play.id, {kind: 'blend', label: '블렌드', before}, {x: 0, y: 0}).workspace;
  assert.deepEqual(
    w.blends.map(b => b.seconds),
    [0.3, 0.3]
  );
  assert.deepEqual(compileWorkspace(w).match(/<(Enter|Exit) blend="[^"]*"/g), [
    '<Enter blend="0.3"',
    '<Exit blend="0.3"',
  ]);
});

test('a new pair ends with a 0.6 s blend when its partner is lost (10-20)', async () => {
  const {defaultPair} = await import('../src/workspace.ts');
  const {importWorkspaceXml} = await import('../src/importXml.ts');
  assert.deepEqual([defaultPair().lossEnabled, defaultPair().lossBlend], [true, 0.6]);
  // A pair read without it starts at 0.6 s when it is switched on.
  const w = importWorkspaceXml(
    '<?xml version="1.0" encoding="utf-8"?><AnimationSet version="4" id="M"><Pair id="P" clip="Animations\P.hkx"/></AnimationSet>'
  );
  assert.deepEqual([w.actions[0].pair.lossEnabled, w.actions[0].pair.lossBlend], [false, 0.6]);
  w.actions[0].pair.lossEnabled = true;
  assert.match(compileWorkspace(w), /<OnPartnerLost blend="0.6"\/>/);
});
