import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checklistProjection} from '../src/graph/checklist.ts';
import {listenMerges, cutQteListen, connectQteToEvent} from '../src/graph/qteListen.ts';
import {compileWorkspace, emptyWorkspace, wrap} from '../src/workspace.ts';
import {createProject} from '../src/model.ts';
import {flatGraph, addFlat, connectFlat} from '../src/graph/flat.ts';
import {playbackLink} from '../src/graph/playback.ts';

const grapple = () =>
  importWorkspaceXml(readFileSync(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url), 'utf8'));
const connects = (xml, event) => (xml.match(new RegExp(`<Transition [^>]*event="${event}"`, 'g')) ?? []).length;

test('a QTE event its own action waits for is one line: the wait is not drawn', () => {
  const w = grapple(),
    g = checklistProjection(w),
    nodes = new Map(g.nodes.map(n => [n.id, n]));
  const {hidden, merged} = listenMerges(g.edges, nodes, () => false);
  assert.ok(merged.size > 0);
  for (const [line, waits] of merged) {
    const v = g.edges.find(e => e.id === line);
    for (const wait of waits) {
      assert.ok(hidden.has(wait.id));
      // The wait comes from an action whose own QTE rule sends the event to itself.
      assert.ok(v.viaFrom.includes(nodes.get(wait.source).action));
      assert.equal(wait.target, v.target);
    }
  }
  // An action whose HKX sends the event itself keeps its wait.
  assert.equal(listenMerges(g.edges, nodes, () => true).hidden.size, 0);
});

test('cutting the merged line sets those results to continue and removes only their actions waits', () => {
  const w = grapple(),
    g = checklistProjection(w),
    nodes = new Map(g.nodes.map(n => [n.id, n]));
  const {merged} = listenMerges(g.edges, nodes, () => false);
  const [lineId, waits] = [...merged].find(([id]) => g.edges.find(e => e.id === id).via === 'Grapple_QTE_Stage01');
  const line = g.edges.find(e => e.id === lineId);
  const owners = new Set(waits.map(e => nodes.get(e.source).action));
  const before = compileWorkspace(w),
    next = cutQteListen(w, line, waits, id => nodes.get(id)?.action),
    after = compileWorkspace(next);
  // The waits of the cut actions go; any other action waiting for the event keeps its wait.
  assert.equal(connects(after, 'Grapple_QTE_Stage01'), connects(before, 'Grapple_QTE_Stage01') - owners.size);
  for (const q of next.qtes.filter(q => owners.has(q.owner)))
    assert.notEqual(q.results.failure.event, 'Grapple_QTE_Stage01');
});

test('drawing a QTE result onto an event transition sends that event and makes the QTE action wait for it', () => {
  let w = emptyWorkspace();
  for (let i = 1; i <= 3; i++) {
    const p = createProject('single');
    p.actionId = 'Action' + i;
    p.name = 'Action' + i;
    p.steps[0].clip = 'Animations\\Test' + i + '.hkx';
    w.actions.push(wrap(p, 'a' + i));
  }
  // Action2 waits for Hit and goes to Action3.
  w = playbackLink(w, 'a2', 'a3', {event: 'Hit'}).workspace;
  const added = addFlat(w, 'a1', 'qte', {x: 420, y: 160});
  w = added.workspace;
  const play = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === 'a1');
  w = connectFlat(w, play.id, added.id, 'trigger');
  const link = w.links.find(l => l.event === 'Hit');
  const next = connectQteToEvent(w, added.id, 'pass', `transition:${link.id}`);
  assert.equal(next.qtes[0].results.success.mode, 'event');
  assert.equal(next.qtes[0].results.success.event, 'Hit');
  const xml = compileWorkspace(next);
  // Action1 now waits for Hit too, to the same destination.
  assert.match(xml, /<Action id="Action1"[\s\S]*?<Transition to="Action3"[^>]*event="Hit"/);
  assert.equal(connects(xml, 'Hit'), 2);
  // Not a QTE result onto an event transition: left to the ordinary connection.
  assert.equal(connectQteToEvent(w, added.id, 'trigger', `transition:${link.id}`), undefined);
});
