import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureGraph, lowerGraph, authorReducer} from '../src/graph/document.ts';
import {emptyWorkspace, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {addFlat, connectFlat, flatNode} from '../src/graph/flat.ts';

// Three actions; the first goes on to the second by a key transition (format 4).
const CHAIN = `<AnimationSet version="4" id="Chain">
  <Action id="A1" clip="Animations\\Test\\A1.hkx"><Start key="G"/><Connect to="A2" key="G"><Window from="0.45"/></Connect></Action>
  <Action id="A2" clip="Animations\\Test\\A2.hkx"/>
  <Action id="A3" clip="Animations\\Test\\A3.hkx"/>
</AnimationSet>`;

test('graph source roundtrips all workspace fields and generates the same XML', () => {
  let w = importWorkspaceXml(CHAIN);
  w = addFlat(w, 'a1', 'keyInput', {x: 20, y: 30}).workspace;
  const g = captureGraph(w);
  assert.equal(g.schema, 8);
  assert.equal(g.actions, undefined);
  assert.ok(g.nodes.some(n => n.kind === 'play'));
  assert.ok(!g.nodes.some(n => n.kind === 'rule'));
  assert.ok(g.edges.some(e => e.role === 'flow'));
  assert.deepEqual(lowerGraph(g), w);
  assert.deepEqual(parseWorkspace(JSON.stringify(g)), w);
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(g))), compileWorkspace(w));
  const invalid = structuredClone(g);
  invalid.edges[0].target = 'missing';
  assert.throws(() => parseWorkspace(JSON.stringify(invalid)), /연결 대상/);
});

test('editing the source edge changes XML and history stores graphs, not runtime actions', () => {
  const w = importWorkspaceXml(CHAIN),
    g = captureGraph(w);
  const link = g.nodes.find(n => n.kind === 'link');
  g.edges.find(e => e.source === link.id && e.role === 'flow').target = 'action:a3';
  assert.equal(lowerGraph(g).links[0].to, 'a3');
  assert.match(compileWorkspace(parseWorkspace(JSON.stringify(g))), /<Connect to="A3"/);
  let h = {present: captureGraph(w), past: [], future: []};
  h = authorReducer(h, {type: 'edit', next: lowerGraph(g)});
  assert.equal(h.present.schema, 8);
  h = authorReducer(h, {type: 'undo'});
  assert.deepEqual(lowerGraph(h.present), w);
  h = authorReducer(h, {type: 'redo'});
  assert.equal(lowerGraph(h.present).links[0].to, 'a3');
});

function play(w) {
  const r = addFlat(w, '', 'playNode', {x: 300, y: 200});
  const n = flatNode(r.workspace, r.id);
  r.workspace.actions.find(a => a.uid === n.action).config.steps[0].clip = 'Animations/Test.hkx';
  return r;
}
function key(w, k) {
  const r = addFlat(w, '', 'keyInput', {x: 100, y: 100});
  const d = r.workspace.drafts.find(d => d.id === r.id);
  d.value.config.inputs.find(i => i.id === d.value.config.start.input).key = k;
  return r;
}

test('independent HKX starts directly from a key and goes on to another HKX by a key transition', () => {
  const first = play(emptyWorkspace()),
    second = play(first.workspace);
  let w = second.workspace;
  let r = key(w, 'G');
  w = connectFlat(r.workspace, r.id, first.id);
  assert.equal(w.actions[0].config.start.mode, 'input');
  r = key(w, 'H');
  w = connectFlat(r.workspace, first.id, r.id);
  w = connectFlat(w, r.id, second.id);
  assert.equal(w.actions.length, 2);
  assert.equal(w.actions[0].config.steps.length, 1);
  assert.equal(w.links.length, 1);
  const p = w.actions[0].config;
  assert.equal(p.inputs.find(i => i.id === w.links[0].input).key, 'H');
  assert.doesNotThrow(() => compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))));
});

test("a target's start key becomes the transition's key when an HKX is connected into it", () => {
  const first = play(emptyWorkspace()),
    second = play(first.workspace);
  let r = key(second.workspace, 'H');
  let w = connectFlat(r.workspace, r.id, second.id);
  const target = flatNode(w, second.id);
  w = connectFlat(w, first.id, `start:${target.action}|keyInput`);
  assert.equal(w.actions.length, 2);
  assert.equal(w.links.length, 1);
  assert.equal(w.actions.find(a => a.uid === target.action).config.start.mode, 'none');
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(captureGraph(w))));
});

test('HKX to HKX makes a key transition whose key the details set (no combo)', () => {
  const first = play(emptyWorkspace()),
    second = play(first.workspace);
  const w = connectFlat(second.workspace, first.id, second.id);
  assert.equal(w.actions.length, 2);
  assert.ok(w.actions.every(a => a.config.steps.length === 1));
  assert.deepEqual(
    w.links.map(l => [l.from, l.to, l.mode]),
    [[flatNode(w, first.id).action, flatNode(w, second.id).action, 'input']]
  );
  // The key is still to be chosen: the project says so until it is.
  const input = w.actions[0].config.inputs.find(i => i.id === w.links[0].input);
  assert.equal(input.key, '');
  assert.throws(() => compileWorkspace(w));
  input.key = 'G';
  assert.match(compileWorkspace(w), /<Connect to="[^"]+" key="G">/);
});
