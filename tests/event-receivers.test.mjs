import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {addLink, compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {compactGraph, shareEventReceivers, synchronizeRules} from '../src/graph/sharing.ts';
import {tableProjection} from '../src/graph/conditionTables.ts';
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
    Object.assign(w.actions.find(a => a.uid === id).config.start, {mode: 'event', event: 'Shared_Start'});
  return importWorkspaceXml(compileWorkspace(w));
}
const receivers = w =>
  tableProjection(w, compactGraph(w, flatGraph(w)))
    .nodes.filter(n => n.kind === 'markerReceive')
    .map(n => n.id);
const route = (w, from) => w.links.find(l => l.from === from && l.event === 'Shared_Go');

test('an import draws one receiver per event and route, like reusing a receiver', () => {
  const w = imported(),
    same = [route(w, 'a3').id, route(w, 'a4').id].sort();
  assert.deepEqual(
    w.sharedRules.map(g => [g.kind, [...g.members].sort()]),
    [
      ['link', same],
      ['node', ['start:a4|markerReceive', 'start:a5|markerReceive']],
    ]
  );
  const shown = receivers(w);
  assert.equal(shown.filter(id => id.startsWith('start:')).length, 1, 'one start trigger for Shared_Start');
  assert.equal(shown.filter(id => id.startsWith('link:')).length, 2, 'the route to another destination stays apart');
  assert.ok(shown.includes(`link:${route(w, 'a1').id}|markerReceive`));
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
