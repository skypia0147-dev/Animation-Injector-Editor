import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checklistProjection} from '../src/graph/checklist.ts';
import {listenMerges} from '../src/graph/qteListen.ts';
import {arrangeLayout} from '../src/graph/arrange.ts';
import {cardWidth} from '../src/graph/cardPresentation.ts';

test('a QTE whose results lead on sits in the route: HKX, then the QTE, then the transitions it feeds', () => {
  const w = importWorkspaceXml(readFileSync(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url), 'utf8'));
  const g = checklistProjection(w),
    nodes = new Map(g.nodes.map(n => [n.id, n]));
  const {hidden} = listenMerges(g.edges, nodes, () => false);
  const {positions} = arrangeLayout(g, {summary: true, hidden});
  const drawn = g.edges.filter(e => !hidden.has(e.id));
  // Every line out of a QTE goes right, to a card past the QTE's own right edge.
  for (const e of drawn.filter(e => nodes.get(e.source).kind === 'qte'))
    assert.ok(positions[e.target].x >= positions[e.source].x + cardWidth(nodes.get(e.source)), e.id);
  // And every QTE is right of the HKX cards it comes from.
  for (const e of drawn.filter(e => nodes.get(e.target).kind === 'qte'))
    assert.ok(positions[e.target].x > positions[e.source].x, e.id);
  // The waits the canvas does not draw do not place anything: the arrange is the same as with them removed.
  const without = arrangeLayout({...g, edges: drawn}, {summary: true}).positions;
  assert.deepEqual(positions, without);
});
