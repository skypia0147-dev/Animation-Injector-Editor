import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph, connectFlat} from '../src/graph/flat.ts';
import {compactGraph, shareRules, synchronizeRules} from '../src/graph/sharing.ts';
import {editExpression, readExpression, activeConditionFlow} from '../src/graph/conditionExpression.ts';
import {copyNodes, pasteNodes} from '../src/graph/clipboard.ts';
import {beginFocus, retainFocus} from '../src/graph/focusSession.ts';
import {disconnectEdge, visibleEdges} from '../src/graph/disconnect.ts';
import {captureGraph} from '../src/graph/document.ts';
import {tableProjection} from '../src/graph/conditionTables.ts';
import {addComment, editComment} from '../src/graph/projection.ts';
import {s4sample} from '../src/s4sample.ts';
function sample() {
  let w = addFlat(emptyWorkspace(), '', 'playNode', {x: 40, y: 100}).workspace;
  const a = w.actions[0];
  a.config.steps[0].clip = 'animations\\attack.hkx';
  a.flow = {
    entry: 'Root',
    tests: [{id: 'Root', kind: 'air', subject: 'self', minimum: 0, negate: true, pass: {action: a.uid}}],
  };
  return w;
}
test('expression edits build nested groups, retain routing, disable children, persist, and reject empty groups', () => {
  let w = sample(),
    a = w.actions[0];
  a.flow.tests[0].label = 'Ground branch';
  w = editExpression(w, a.uid, {type: 'wrap', id: 'Root', mode: 'all'});
  assert.equal(w.actions[0].flow.tests[0].label, 'Ground branch');
  w = editExpression(w, a.uid, {
    type: 'add',
    parent: 'Root',
    expression: {
      settings: {kind: 'any', subject: 'self', minimum: 0},
      children: [
        {settings: {kind: 'female', subject: 'self', minimum: 0}, children: []},
        {settings: {kind: 'combat', subject: 'self', minimum: 0, negate: true}, children: []},
      ],
    },
  });
  let f = w.actions[0].flow;
  assert.equal(f.tests.find(t => t.id === 'Root').pass.action, a.uid);
  assert.equal(readExpression(f, 'Root').children.length, 2);
  assert.match(compileWorkspace(w), /<Any/);
  assert.match(compileWorkspace(w), /<Not/);
  const graph = compactGraph(w, flatGraph(w));
  assert.equal(graph.nodes.filter(n => n.kind === 'conditionBranch').length, 1);
  const child = f.tests.find(t => t.kind === 'female');
  child.enabled = false;
  assert.doesNotMatch(compileWorkspace(w), /kind="female"/);
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), compileWorkspace(w));
  f.tests.find(t => t.kind === 'combat').enabled = false;
  assert.throws(() => compileWorkspace(w), /조건 그룹/);
});
test('condition move prevents cycles and removing a child does not delete a separately referenced predicate', () => {
  let w = sample(),
    a = w.actions[0];
  w = editExpression(w, a.uid, {type: 'wrap', id: 'Root', mode: 'all'});
  w = editExpression(w, a.uid, {type: 'add', parent: 'Root', group: true});
  let f = w.actions[0].flow,
    root = f.tests.find(t => t.id === 'Root'),
    group = root.operands[1],
    leaf = root.operands[0];
  assert.throws(() => editExpression(w, a.uid, {type: 'move', parent: 'Root', id: group, to: group, index: 0}), /자기/);
  f.tests.push({id: 'Other', kind: 'all', subject: 'self', minimum: 0, operands: [leaf]});
  w = editExpression(w, a.uid, {type: 'remove', parent: 'Root', id: leaf});
  assert.ok(w.actions[0].flow.tests.some(t => t.id === leaf));
});
test('focus keeps disconnected nodes, editable pins, newly added nodes and positions until explicit refresh', () => {
  let w = sample();
  delete w.actions[0].flow;
  w.actions[0].config.recovery.enabled = true;
  const g = compactGraph(w, flatGraph(w)),
    play = g.nodes.find(n => n.kind === 'hkxPlay'),
    recovery = g.nodes.find(n => n.notify === 'recovery');
  const session = beginFocus(g, play.action, play.id),
    cut = disconnectEdge(
      w,
      g.edges.find(e => e.target === recovery.id)
    );
  const changed = {...g, edges: visibleEdges(cut, g.edges)},
    kept = retainFocus(changed, session);
  assert.ok(kept.graph.nodes.some(n => n.id === recovery.id));
  assert.ok(kept.graph.nodes.find(n => n.id === play.id).outputs.length);
  assert.equal(
    kept.graph.edges.some(e => e.target === recovery.id),
    false
  );
  assert.equal(beginFocus(changed, play.action, play.id).members.includes(recovery.id), false);
  const added = addFlat(cut, play.action, 'blend', {x: 800, y: 200});
  const expanded = retainFocus(compactGraph(added.workspace, flatGraph(added.workspace)), kept.session);
  assert.ok(expanded.session.members.includes(added.id));
  assert.deepEqual(
    expanded.graph.nodes.find(n => n.id === play.id).position,
    kept.graph.nodes.find(n => n.id === play.id).position
  );
});
test('single playback copy excludes external settings and creates independent IDs at the paste position', () => {
  const w = sample(),
    g = compactGraph(w, flatGraph(w)),
    play = g.nodes.find(n => n.kind === 'hkxPlay');
  w.actions[0].config.recovery.enabled = true;
  const pasted = pasteNodes(w, copyNodes(w, g, [play.id]), {x: 900, y: 300}, w.actions[0].uid),
    a = pasted.workspace.actions.at(-1);
  assert.notEqual(a.uid, w.actions[0].uid);
  assert.notEqual(a.config.actionId, w.actions[0].config.actionId);
  assert.equal(a.flow, undefined);
  assert.equal(a.config.recovery.enabled, false);
  assert.equal(a.config.steps[0].clip, w.actions[0].config.steps[0].clip);
  assert.deepEqual(flatGraph(pasted.workspace).nodes.find(n => n.id === pasted.ids[0]).position, {x: 900, y: 300});
});
test('copying playback, recovery and blend preserves only internal wires and values', () => {
  let w = sample();
  delete w.actions[0].flow;
  const a = w.actions[0],
    p = `anim:${a.uid}:|clip_A1`;
  a.config.recovery.enabled = true;
  a.config.recovery.at.seconds = 0.5;
  w.blends = [{id: 'Blend', source: p, target: `anim:${a.uid}:|outputPose`, seconds: 0.2}];
  const g = compactGraph(w, flatGraph(w));
  const ids = g.nodes.filter(n => ['hkxPlay', 'blend', 'notify', 'outputPose'].includes(n.kind)).map(n => n.id);
  const pasted = pasteNodes(w, copyNodes(w, g, ids), {x: 900, y: 300}, a.uid),
    next = pasted.workspace.actions.at(-1);
  assert.equal(next.config.recovery.enabled, true);
  assert.equal(next.config.recovery.at.seconds, 0.5);
  assert.equal((compileWorkspace(pasted.workspace).match(/blend="0.2"/g) ?? []).length, 2);
});
test('copying a complete input-condition-playback flow rewrites predicates and preserves routing', () => {
  const w = sample(),
    a = w.actions[0];
  a.config.start.mode = 'event';
  a.config.start.event = 'Start';
  const g = compactGraph(w, flatGraph(w)),
    ids = g.nodes.filter(n => n.kind !== 'entry').map(n => n.id);
  const p = pasteNodes(w, copyNodes(w, g, ids), {x: 900, y: 400}, a.uid),
    next = p.workspace.actions.at(-1);
  assert.equal(next.config.start.event, 'Start');
  assert.notEqual(next.uid + ':' + next.flow.entry, a.uid + ':' + a.flow.entry);
  assert.equal(next.flow.tests.find(t => t.id === next.flow.entry).pass.action, next.uid);
  assert.doesNotThrow(() => compileWorkspace(p.workspace));
});
test('condition rule table copy retains internal rule paths and remaps only selected destinations', () => {
  const w = sample(),
    a = w.actions[0];
  a.flow.tests[0].fail = {node: 'Fallback'};
  a.flow.tests.push({id: 'Fallback', kind: 'alive', subject: 'self', minimum: 0, pass: {action: a.uid}});
  w.conditionTables = [a.uid];
  const g = tableProjection(w, compactGraph(w, flatGraph(w))),
    ids = g.nodes.filter(n => n.kind !== 'entry').map(n => n.id);
  const p = pasteNodes(w, copyNodes(w, g, ids), {x: 900, y: 400}, a.uid),
    next = p.workspace.actions.at(-1);
  assert.equal(next.flow.tests.length, 2);
  assert.ok(next.flow.tests.every(t => t.pass.action === next.uid));
  assert.doesNotThrow(() => compileWorkspace(p.workspace));
});
test('complete graph copy retains comments under independent IDs', () => {
  let w = sample();
  const comment = addComment(w, {kind: 'root'}, {x: 0, y: 600});
  w = editComment(comment.workspace, {kind: 'root'}, comment.id, '설계 메모');
  const g = compactGraph(w, flatGraph(w));
  const p = pasteNodes(
    w,
    copyNodes(
      w,
      g,
      g.nodes.map(n => n.id)
    ),
    {x: 1000, y: 200},
    w.actions[0].uid
  );
  const notes = flatGraph(p.workspace).nodes.filter(n => n.kind === 'comment');
  assert.equal(notes.length, 2);
  assert.equal(new Set(notes.map(n => n.id)).size, 2);
  assert.ok(notes.every(n => n.summary === '설계 메모'));
});
test('80-condition expression remains one editable branch and survives compile/reopen', () => {
  let w = sample();
  w = editExpression(w, w.actions[0].uid, {type: 'wrap', id: 'Root', mode: 'all'});
  for (let i = 1; i < 79; i++) w = editExpression(w, w.actions[0].uid, {type: 'add', parent: 'Root'});
  const start = performance.now(),
    xml = compileWorkspace(w);
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), xml);
  assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.kind === 'conditionBranch').length, 1);
  assert.ok(performance.now() - start < 3000, 'compile, reopen and project 80 conditions should not stall editing');
});

test('editing a shared condition expression updates settings while keeping both destinations local', () => {
  let w = sample();
  w = addFlat(w, '', 'playNode', {x: 400, y: 200}).workspace;
  const [a, b] = w.actions;
  b.config.steps[0].clip = a.config.steps[0].clip;
  b.flow = structuredClone(a.flow);
  b.flow.tests[0].pass = {action: b.uid};
  w = shareRules(w);
  let next = editExpression(w, a.uid, {type: 'wrap', id: 'Root', mode: 'all'});
  next = synchronizeRules(w, next);
  const add = editExpression(next, a.uid, {
    type: 'add',
    parent: 'Root',
    expression: {settings: {kind: 'female', subject: 'self', minimum: 0, negate: true, enabled: false}, children: []},
  });
  next = synchronizeRules(next, add);
  for (const actor of next.actions) {
    assert.equal(actor.flow.tests.find(t => t.id === 'Root').pass.action, actor.uid);
    const e = readExpression(actor.flow, 'Root');
    assert.equal(e.children.length, 2);
    assert.equal(e.children[1].settings.enabled, false);
    assert.equal(e.children[1].settings.negate, true);
  }
  assert.doesNotThrow(() => compileWorkspace(next));
});
