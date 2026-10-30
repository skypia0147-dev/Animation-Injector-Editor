import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawnLine, STUB_SOURCES, stubLines} from '../src/graph/sharedTransitionLines.ts';

// Lines into a transition card three or more HKX share are drawn only while one of their cards or the line is
// chosen (docs/mockup-arrange-branches B, 10-30); each HKX shows the card's number.
const graph = sources => ({
  nodes: [
    ...sources.map(id => ({id, kind: 'hkxPlay'})),
    {id: 'transition:a', kind: 'transition'},
    {id: 'transition:b', kind: 'transition'},
    {id: 'conditionCard:c', kind: 'conditionCard'},
  ],
  edges: [
    ...sources.map(id => ({id: `${id}>a`, source: id, target: 'transition:a', pin: 'trigger'})),
    // One HKX into another card: always drawn.
    {id: 'h1>b', source: 'h1', target: 'transition:b', pin: 'trigger'},
    {id: 'a>c', source: 'transition:a', target: 'conditionCard:c', pin: 'trigger'},
  ],
});

test('three HKX into one transition: its lines are marks, numbered, the card counts them', () => {
  assert.equal(STUB_SOURCES, 3);
  const {nodes, edges} = graph(['h1', 'h2', 'h3']);
  const s = stubLines(nodes, edges);
  assert.deepEqual([...s.lines.keys()], ['h1>a', 'h2>a', 'h3>a']);
  assert.deepEqual(s.cards.get('transition:a'), {mark: '①', count: 3});
  assert.equal(s.cards.has('transition:b'), false);
  assert.deepEqual(s.marks.get('h2'), [{edge: 'h2>a', mark: '①'}]);
  // The transition's own line out, and the single line into b, are drawn.
  assert.equal(
    drawnLine(
      s,
      edges.find(e => e.id === 'a>c'),
      new Set(),
      ''
    ),
    true
  );
  assert.equal(
    drawnLine(
      s,
      edges.find(e => e.id === 'h1>b'),
      new Set(),
      ''
    ),
    true
  );
});

test('two HKX: lines as before', () => {
  const {nodes, edges} = graph(['h1', 'h2']);
  const s = stubLines(nodes, edges);
  assert.equal(s.lines.size, 0);
  assert.equal(s.marks.size, 0);
  for (const e of edges) assert.equal(drawnLine(s, e, new Set(), ''), true);
});

test('a hidden line shows while its HKX, the transition card or the line itself is chosen', () => {
  const {nodes, edges} = graph(['h1', 'h2', 'h3']);
  const s = stubLines(nodes, edges),
    line = edges.find(e => e.id === 'h2>a');
  assert.equal(drawnLine(s, line, new Set(), ''), false);
  assert.equal(drawnLine(s, line, new Set(['h1']), ''), false);
  assert.equal(drawnLine(s, line, new Set(['h2']), ''), true);
  assert.equal(drawnLine(s, line, new Set(['transition:a']), ''), true);
  // Chosen by its mark or after a click on it: the HKX is no longer chosen, the line still shows to be cut.
  assert.equal(drawnLine(s, line, new Set(), 'h2>a'), true);
});
