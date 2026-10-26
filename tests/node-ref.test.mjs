import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {parseWorkspace} from '../src/workspace.ts';
import {flatGraph, flatId} from '../src/graph/flat.ts';
import {nodeId, parseNodeId} from '../src/graph/nodeRef.ts';
import {animId} from '../src/graph/blends.ts';
import {startCardId, conditionCardId, transitionId} from '../src/graph/flat.ts';
import {qteId} from '../src/graph/qteGraph.ts';
import {savedProject} from '../src/editorBlock.ts';
import {importWorkspaceXml} from '../src/importXml.ts';

// E-3: one codec for node IDs. Every ID a real project's flat graph produces must decode to a
// typed reference and encode back to the same text. The projects are a saved editor block (editorBlock.ts) and the
// current runtime XML fixtures as File > Open reads them (condition cards among them).
const block = 'tests/fixtures/grapple-carry-qte-cuts.xml';
const projects = [
  [block, () => parseWorkspace(savedProject(readFileSync(block, 'utf8')).project)],
  ...readdirSync('tests/fixtures/current-xml')
    .filter(f => f.endsWith('.xml'))
    .map(f => 'tests/fixtures/current-xml/' + f)
    .map(file => [file, () => importWorkspaceXml(readFileSync(file, 'utf8'))]),
];

test('every flat graph node ID round-trips through the codec', () => {
  let count = 0;
  const kinds = new Set();
  for (const [file, read] of projects) {
    const w = read();
    const g = flatGraph(w);
    for (const id of [...g.nodes.map(n => n.id), ...g.edges.flatMap(e => [e.source, e.target])]) {
      const ref = parseNodeId(id);
      kinds.add(ref.kind);
      assert.equal(nodeId(ref), id, `${file}: ${id}`);
      count++;
    }
    // The codec agrees with the typed view flatGraph already has.
    for (const n of g.nodes) {
      const ref = parseNodeId(n.id);
      if (['startCard', 'conditionCard', 'transition'].includes(n.kind)) assert.equal(ref.kind, n.kind, n.id);
      if (
        n.scope.kind !== 'root' &&
        !n.id.startsWith('notify:') &&
        !n.id.startsWith('transition:') &&
        !n.id.startsWith('qte:')
      ) {
        assert.equal(ref.kind, 'scoped', n.id);
        assert.deepEqual(ref.scope, n.scope, n.id);
        assert.equal(ref.local, n.original, n.id);
      }
    }
  }
  assert.ok(count > 500, 'enough IDs checked: ' + count);
  for (const kind of ['startCard', 'conditionCard', 'transition', 'scoped', 'notify', 'plain'])
    assert.ok(kinds.has(kind), kind);
});

test('the codec agrees with the existing encoders and keeps separators inside locals', () => {
  assert.deepEqual(parseNodeId(startCardId('start1')), {kind: 'startCard', uid: 'start1'});
  assert.deepEqual(parseNodeId(conditionCardId('card2')), {kind: 'conditionCard', uid: 'card2'});
  assert.deepEqual(parseNodeId(transitionId('link3')), {kind: 'transition', link: 'link3'});
  assert.deepEqual(parseNodeId(animId('a2', 'clip_s1')), {
    kind: 'scoped',
    scope: {kind: 'anim', action: 'a2'},
    local: 'clip_s1',
  });
  assert.deepEqual(parseNodeId(flatId({kind: 'anim', action: 'a2', step: 's3'}, 'blendIn')), {
    kind: 'scoped',
    scope: {kind: 'anim', action: 'a2', step: 's3'},
    local: 'blendIn',
  });
  assert.deepEqual(parseNodeId(flatId({kind: 'link', link: 'l4'}, 'keyInput')), {
    kind: 'scoped',
    scope: {kind: 'link', link: 'l4'},
    local: 'keyInput',
  });
  assert.deepEqual(parseNodeId(qteId('GrappleFront_Q1_A')), {kind: 'qte', id: 'GrappleFront_Q1_A'});
  assert.deepEqual(parseNodeId('notify:a1|pair:cost'), {kind: 'notify', owner: 'a1', local: 'pair:cost'});
  assert.deepEqual(parseNodeId('shared:outputPose'), {kind: 'shared', name: 'outputPose'});
  // Blend IDs and malformed prefixes stay opaque root IDs.
  for (const id of [
    'entry',
    'a1',
    'blend:link:l1',
    'blend:a1:T1',
    'sharedBlend2',
    'flow:',
    'flow:a1',
    'notify:a1',
    'unknown:x|y',
    'anim:a1|x',
  ])
    assert.equal(parseNodeId(id).kind, 'plain', id);
});
