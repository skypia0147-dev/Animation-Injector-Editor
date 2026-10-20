import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {projectText} from '../tools/projectFile.mjs';
import {parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {disconnectEdge, settleQteCuts} from '../src/graph/disconnect.ts';
import {qteMembers, qteVisualId} from '../src/graph/qteGroups.ts';

// 10-15 report: every line into Grapple Carry QTE deleted but GrapplePounding's, and the QTE's detail still listed
// eleven actions ("적용 동작"): a deleted QTE line was a hidden cut the document never saw. The fixture is the user's
// Grapple.xml as saved then, with those ten hidden cuts.
const saved = parseWorkspace(
  projectText(fileURLToPath(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url)))
);
const fresh = () => {
  const w = structuredClone(saved);
  delete w.disconnections;
  return w;
};
const carry = w =>
  qteVisualId(
    w,
    w.qtes.find(q => q.group === 'Grapple Carry QTE')
  );
const actionNames = w =>
  new Map(
    w.qtes.filter(q => q.group === 'Grapple Carry QTE').map(q => [q.owner, (q.xmlId ?? q.id).replace(/_QCarry_A$/, '')])
  );
const linesIn = (w, card) => flatGraph(w).edges.filter(e => e.target === card && e.pin === 'trigger');
const pounding = (names, e) => names.get(e.source.split(':')[1]) === 'GrapplePounding';

test('deleting HKX lines into a shared QTE takes those actions out of its group (Grapple Carry QTE)', () => {
  const start = fresh(),
    card = carry(start),
    names = actionNames(start);
  assert.equal(linesIn(start, card).length, 11);
  let w = start;
  for (const e of linesIn(start, card)) if (!pounding(names, e)) w = disconnectEdge(w, e);
  assert.equal(w.disconnections, undefined, 'no hidden cut');
  const members = qteMembers(w, card);
  assert.deepEqual(
    members.map(q => names.get(q.owner)),
    ['GrapplePounding']
  );
  assert.equal(linesIn(w, card).length, 1);
  assert.ok(
    flatGraph(w).nodes.some(n => n.id === card),
    'the card stays'
  );
  // The XML is the one the hidden cuts gave: GrapplePounding's carry QTE alone.
  let old = structuredClone(start);
  old.disconnections = linesIn(start, card)
    .filter(e => !pounding(names, e))
    .map(e => ({
      source: e.source,
      target: e.target,
      pin: e.pin,
      bindings: [{source: e.source, target: e.target, pin: e.pin, targetPin: e.targetPin}],
    }));
  const xml = compileWorkspace(w);
  assert.equal((xml.match(/_QCarry_A"/g) ?? []).length, 1);
  assert.equal(xml, compileWorkspace(old));
  // A project saved with those hidden cuts (the user's own file) opens as the same document edit.
  assert.equal(saved.disconnections.length, 10);
  const settled = settleQteCuts(saved);
  assert.equal(settled.disconnections, undefined);
  assert.deepEqual(
    qteMembers(settled, card).map(q => names.get(q.owner)),
    ['GrapplePounding']
  );
  assert.equal(compileWorkspace(settled), xml);
});

test('the last action leaving a QTE keeps its rule, detached, and out of the XML', () => {
  let w = fresh();
  const card = carry(w);
  for (const e of linesIn(w, card)) w = disconnectEdge(w, e);
  const members = qteMembers(w, card);
  assert.equal(members.length, 1);
  assert.equal(members[0].owner, '');
  assert.ok(flatGraph(w).nodes.some(n => n.id === card));
  assert.doesNotMatch(compileWorkspace(w), /_QCarry_A"/);
});

test('settling keeps cuts that are not QTE lines, and an event start line stays a hidden cut', () => {
  const w = fresh();
  const other = flatGraph(w).edges.find(e => !e.source.startsWith('qte') && !e.target.startsWith('qte'));
  const cut = {
    source: other.source,
    target: other.target,
    pin: other.pin,
    bindings: [{source: other.source, target: other.target, pin: other.pin}],
  };
  const event = {
    source: 'qte-event:X',
    target: 'qte:X',
    pin: 'trigger',
    bindings: [{source: 'qte-event:X', target: 'qte:X', pin: 'trigger'}],
  };
  const settled = settleQteCuts({...w, disconnections: [cut, event]});
  assert.deepEqual(settled.disconnections, [cut, event]);
  assert.equal(settleQteCuts(w), w);
});
