import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {addLink, compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {compactGraph, shareEventReceivers, synchronizeRules} from '../src/graph/sharing.ts';
import {newStart} from '../src/cards.ts';
import {documentReducer} from '../src/graph/state.ts';
import {authorReducer, captureGraph} from '../src/graph/document.ts';

// a3 and a4 go to a5 on Shared_Go, a1 goes elsewhere on it; a4 and a5 start on Shared_Start.
function imported() {
  const w = s4sample();
  for (const [from, to] of [
    ['a4', 'a5'],
    ['a3', 'a5'],
    ['a1', 'a4'],
  ])
    w.links.push({...addLink(w, from, to), event: 'Shared_Go'});
  for (const id of ['a4', 'a5'])
    w.starts.push({...newStart(w, {x: 0, y: 0}, 'event'), event: 'Shared_Start', to: {action: id}});
  return importWorkspaceXml(compileWorkspace(w));
}
// The transition cards drawn for Shared_Go (equal ones are drawn once).
const receivers = w =>
  compactGraph(w, flatGraph(w))
    .nodes.filter(
      n => n.kind === 'transition' && w.links.find(l => 'transition:' + l.id === n.id)?.event === 'Shared_Go'
    )
    .map(n => n.id);
const route = (w, from) => w.links.find(l => l.from === from && l.event === 'Shared_Go');

test('an import draws one transition card per event and destination, like reusing a receiver', () => {
  const w = imported(),
    same = [route(w, 'a3').id, route(w, 'a4').id].sort();
  assert.deepEqual(
    w.sharedRules.map(g => [g.kind, [...g.members].sort()]),
    [['link', same]]
  );
  const shown = receivers(w);
  assert.equal(shown.length, 2, 'the route to another destination stays apart');
  assert.ok(shown.includes(`transition:${route(w, 'a1').id}`));
  // Start cards are cards of their own: one per start.
  assert.equal(w.starts.filter(s => s.event === 'Shared_Start').length, 2);
});

test('sharing changes the view only, never the exported XML', () => {
  const w = imported();
  assert.equal(compileWorkspace(w), compileWorkspace({...w, sharedRules: undefined}));
  assert.equal(compileWorkspace(importWorkspaceXml(compileWorkspace(w))), compileWorkspace(w));
});

test('renaming the shared event renames every route of that receiver', () => {
  const before = imported(),
    next = structuredClone(before);
  route(next, 'a3').event = 'Renamed_Go';
  const synced = synchronizeRules(before, next);
  assert.equal(route(synced, 'a4'), undefined);
  assert.equal(synced.links.find(l => l.from === 'a4' && l.to === 'a5').event, 'Renamed_Go');
  assert.equal(route(synced, 'a1')?.to, 'a4', 'other routes keep theirs');
});

test('existing sharing is kept and nothing is shared twice', () => {
  const w = imported();
  assert.equal(shareEventReceivers(w), w);
  const none = {...w, sharedRules: undefined};
  assert.deepEqual(shareEventReceivers(none).sharedRules, w.sharedRules);
});

test('the import layout replaces the document without a history step', () => {
  const [a, b, c] = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
  assert.deepEqual(documentReducer({present: b, past: [a], future: []}, {type: 'replace', next: c}), {
    present: c,
    past: [a],
    future: [],
  });
  // The reducer the app runs: an import then its layout leaves nothing to undo.
  const imported = s4sample(),
    arranged = {...structuredClone(imported), name: 'Arranged'};
  let s = authorReducer({present: captureGraph(imported), past: [], future: []}, {type: 'adopt', next: imported});
  s = authorReducer(s, {type: 'replace', next: arranged});
  assert.deepEqual(s.present, captureGraph(arranged));
  assert.equal(s.past.length, 0);
  assert.equal(authorReducer(s, {type: 'undo'}), s);
});

// 10-29: an HKX dropped on an event transition card takes the same transition and joins that one card.
test('an HKX joins an event transition card: its own route with the same settings, still one card', async () => {
  const {connectFlat, hkxId} = await import('../src/graph/flat.ts');
  let w = s4sample();
  w.links.push({...addLink(w, 'a3', 'a5'), event: 'Shared_Go', window: true});
  const card = 'transition:' + w.links.at(-1).id;
  w = connectFlat(w, hkxId(w, 'a4'), card);
  const joined = w.links.at(-1);
  assert.deepEqual(
    [joined.from, joined.to, joined.mode, joined.event, joined.window],
    ['a4', 'a5', 'event', 'Shared_Go', true]
  );
  assert.deepEqual(w.sharedRules, [{kind: 'link', members: [card.slice('transition:'.length), joined.id]}]);
  assert.equal(receivers(w).length, 1);
  // Each source writes its own transition; opening the XML draws them as the one card again.
  const xml = compileWorkspace(w);
  assert.equal(xml.match(/<Transition to="EditorS4TargetOut" event="Shared_Go"/g)?.length, 2);
  assert.equal(receivers(importWorkspaceXml(xml)).length, 1);
  // A third source joins the same group; an edit of the card reaches every route.
  w = connectFlat(w, hkxId(w, 'a1'), card);
  assert.equal(w.sharedRules.length, 1);
  assert.equal(w.sharedRules[0].members.length, 3);
  const next = structuredClone(w);
  next.links.find(l => l.from === 'a4' && l.event === 'Shared_Go').event = 'Renamed_Go';
  const synced = synchronizeRules(w, next);
  assert.deepEqual(
    synced.links.filter(l => l.to === 'a5').map(l => l.event),
    ['Renamed_Go', 'Renamed_Go', 'Renamed_Go']
  );
});

test('a key transition card, the same source twice, the destination itself or a taken event are refused', async () => {
  const {connectFlat, hkxId} = await import('../src/graph/flat.ts');
  let w = s4sample();
  w.links.push({...addLink(w, 'a3', 'a5'), event: 'Shared_Go'});
  const card = 'transition:' + w.links.at(-1).id;
  w = connectFlat(w, hkxId(w, 'a4'), card);
  assert.throws(() => connectFlat(w, hkxId(w, 'a4'), card), /이미 이 전환/);
  assert.throws(() => connectFlat(w, hkxId(w, 'a5'), card), /자신으로는/);
  const other = structuredClone(w);
  other.links.push({...addLink(other, 'a1', 'a3'), event: 'Shared_Go'});
  assert.throws(() => connectFlat(other, hkxId(other, 'a1'), card), /같은 이벤트의 전환/);
  const keyed = s4sample();
  keyed.links.push({...addLink(keyed, 'a3', 'a5'), mode: 'input', input: 'use', event: ''});
  assert.throws(() => connectFlat(keyed, hkxId(keyed, 'a4'), 'transition:' + keyed.links.at(-1).id), /키 전환/);
});

test('a group still naming a removed link: the join takes a fresh id, and a member named twice draws one card', async () => {
  const {connectFlat, hkxId} = await import('../src/graph/flat.ts');
  let w = s4sample();
  w.links.push({...addLink(w, 'a3', 'a5'), event: 'Shared_Go'});
  const kept = w.links.at(-1).id;
  // An edit left 'link9' in the group after its link went (the fuzz found link1 reused this way).
  w.sharedRules = [{kind: 'link', members: [kept, 'link9']}];
  w = connectFlat(w, hkxId(w, 'a4'), 'transition:' + kept);
  const joined = w.links.at(-1);
  assert.notEqual(joined.id, 'link9');
  assert.deepEqual(w.sharedRules, [{kind: 'link', members: [kept, joined.id]}]);
  w.sharedRules = [{kind: 'link', members: [kept, joined.id, kept]}];
  assert.equal(receivers(w).length, 1);
});
