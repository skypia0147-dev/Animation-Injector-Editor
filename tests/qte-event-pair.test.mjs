import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, wrap, compileWorkspace, defaultPair} from '../src/workspace.ts';
import {createProject} from '../src/model.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {flatGraph, addFlat, connectFlat} from '../src/graph/flat.ts';
import {pairEventSenders} from '../src/graph/qteGraph.ts';
import {presentCard} from '../src/graph/cardPresentation.ts';
import {qteErrors} from '../src/qte.ts';

// a1 is a pair (GrapplePounding-like), a2/a3 ordinary results; QTE1 an event's QTE like Grapple's QTE4
// (docs/mockup-qte-redesign/event-qte-pair-aware, runtime 0.12.264).
function grapple() {
  let w = emptyWorkspace();
  for (let i = 1; i <= 3; i++) {
    const p = createProject('single');
    p.actionId = ['GrapplePounding', 'Stage10Attacker', 'Stage10Target'][i - 1];
    p.name = p.actionId;
    p.steps[0].clip = 'Animations\\Test' + i + '.hkx';
    p.start.mode = 'none';
    const a = wrap(p, 'a' + i);
    if (i === 1) {
      a.pair = defaultPair();
      a.config.graph = ['RootBehaviorGraph'];
      a.config.cost.enabled = false;
      a.config.recovery.enabled = false;
      Object.values(a.config.slots).forEach(s => (s.enabled = false));
    }
    w.actions.push(a);
  }
  const qte = addFlat(w, '', 'qte', {x: 420, y: 160});
  w = qte.workspace;
  const draft = addFlat(w, '', 'markerReceive', {x: 40, y: 40});
  w = draft.workspace;
  w.drafts.find(d => d.id === draft.id).value.config.start.event = 'Grapple_Stage_Start_10';
  w = connectFlat(w, draft.id, qte.id, 'trigger');
  return {w, qte: qte.id};
}
// The victim's clip of a1 sends Start_10 ("2_Grapple_Stage_Start_10").
const sends = clip => (clip === 'Animations\\Test1.hkx' ? new Set(['partner']) : undefined);

test('the pairs whose HKX sends an event, and which role sends it', () => {
  const {w} = grapple();
  assert.deepEqual(pairEventSenders(w, sends), [{action: 'a1', step: w.actions[0].config.entry, role: 'partner'}]);
  assert.deepEqual(
    pairEventSenders(w, () => new Set(['self', 'partner'])).map(s => s.role),
    ['self', 'partner']
  );
  // Ordinary actions and clips that cannot be read send nothing.
  assert.deepEqual(
    pairEventSenders(w, () => undefined),
    []
  );
});

test("an event's QTE takes the player's and the partner's actions: card rows, pins, XML", () => {
  let {w, qte} = grapple();
  assert.equal(w.qtes[0].eventStart, 'Grapple_Stage_Start_10');
  const g = flatGraph(w),
    card = id => g.nodes.find(n => n.kind === 'hkxPlay' && n.action === id).id;
  w = connectFlat(w, qte, card('a2'), 'pass');
  // A transition has the partner's pin, empty or not.
  assert.ok(
    flatGraph(w)
      .nodes.find(n => n.id === qte)
      .outputs.includes('choice:success:partner')
  );
  w = connectFlat(w, qte, card('a3'), 'choice:success:partner');
  const q = w.qtes[0];
  assert.deepEqual([q.results.success.to, q.results.success.partnerTo], ['a2', 'a3']);
  assert.deepEqual(qteErrors(w), []);
  const face = presentCard(
    w,
    flatGraph(w).nodes.find(n => n.id === qte)
  ).qte;
  assert.ok(face.results.find(r => r.k === 'success').player);
  const xml = compileWorkspace(w);
  assert.match(
    xml,
    /<Event name="Grapple_Stage_Start_10">\s*<QTE id="QTE1"[^>]*>\s*<Success to="Stage10Attacker" partnerTo="Stage10Target"\/>/
  );
  assert.equal(importWorkspaceXml(xml).qtes[0].results.success.partnerTo, 'a3');
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  // The partner goes to an ordinary action too.
  assert.throws(() => connectFlat(w, qte, card('a1'), 'choice:success:partner'), /일반 동작으로만/);
});

test('drawing an event card to a QTE keeps its partner result', () => {
  const w = emptyWorkspace();
  for (const [i, id] of ['A', 'B'].entries()) {
    const p = createProject('single');
    p.actionId = id;
    p.name = id;
    p.steps[0].clip = 'Animations\\' + id + '.hkx';
    p.start.mode = 'none';
    w.actions.push(wrap(p, 'b' + i));
  }
  const added = addFlat(w, '', 'qte', {x: 420, y: 160});
  let n = added.workspace;
  n.qtes[0].results.success = {mode: 'transition', event: '', recipient: 'self', to: 'b0', partnerTo: 'b1'};
  const draft = addFlat(n, '', 'markerReceive', {x: 40, y: 40});
  n = draft.workspace;
  n.drafts.find(d => d.id === draft.id).value.config.start.event = 'Hit';
  n = connectFlat(n, draft.id, added.id, 'trigger');
  assert.equal(n.qtes[0].eventStart, 'Hit');
  assert.equal(n.qtes[0].results.success.partnerTo, 'b1');
});
