import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checklistModel, checklistProjection} from '../src/graph/checklist.ts';
import {cardFlow, flowCount} from '../src/graph/flow.ts';

// A card's flow for the Details panel (11-12): what the canvas draws as lines, as lists.
const w = importWorkspaceXml(readFileSync(new URL('./fixtures/GrappleQte.xml', import.meta.url), 'utf8'));
const view = checklistProjection(w, checklistModel(w));
const hkx = name =>
  view.nodes.find(n => n.kind === 'hkxPlay' && w.actions.find(a => a.uid === n.action)?.config.name === name);
const names = ends => ends.map(e => e.title.split(' · ').at(-1));

test('an HKX with QTEs goes through each QTE to the HKX its results start', () => {
  const flow = cardFlow(w, view, hkx('GrapplePounding').id);
  // Reached from its condition card's True, which a start leads to.
  assert.equal(flow.incoming.length, 1);
  assert.equal(flow.incoming[0].kind, 'conditionCard');
  assert.equal(flow.incoming[0].pin, 'True');
  assert.equal(flow.incoming[0].before.length, 1);
  assert.match(flow.incoming[0].before[0], /Sprint_ContactFront/);
  // Every line out is through a QTE: no direct destination.
  assert.ok(flow.outgoing.every(g => g.via?.kind === 'qte'));
  assert.deepEqual(flow.outgoing.flatMap(g => names(g.ends)).sort(), [
    'GrappleCarryLift',
    'GrappleStage01Attacker',
    'GrappleStage01Target',
    'GrappleStage02Attacker',
    'GrappleStage02Target',
  ]);
  assert.equal(flowCount(flow.outgoing), 5);
  // A QTE's line says which result takes it.
  assert.ok(flow.outgoing.flatMap(g => g.ends).every(e => e.pin));
});

test('a start has nothing before it and names no pin of its own', () => {
  const start = view.nodes.find(n => n.kind === 'startCard' && n.title.includes('Sprint_ContactFront'));
  const flow = cardFlow(w, view, start.id);
  assert.deepEqual(flow.incoming, []);
  assert.equal(flow.outgoing.length, 1);
  assert.equal(flow.outgoing[0].via, undefined);
  assert.equal(flow.outgoing[0].ends[0].kind, 'conditionCard');
  assert.equal(flow.outgoing[0].ends[0].pin, '');
});

test('a condition card names the result each line leaves by', () => {
  const card = view.nodes.find(
    n => n.kind === 'conditionCard' && view.edges.some(e => e.source === n.id && e.target === hkx('GrapplePounding').id)
  );
  const flow = cardFlow(w, view, card.id);
  assert.ok(flow.incoming.length >= 1);
  const pins = flow.outgoing.flatMap(g => g.ends).map(e => e.pin);
  assert.ok(pins.includes('True'));
  assert.ok(pins.every(Boolean));
});

test('a card unknown to the view, and one with no lines, give empty lists', () => {
  assert.deepEqual(cardFlow(w, view, 'nope'), {incoming: [], outgoing: []});
  assert.deepEqual(cardFlow(w, view, 'eventRegistry'), {incoming: [], outgoing: []});
});

test('a carry names the HKX it puts down with', () => {
  const out = cardFlow(w, view, hkx('GrappleCarryLift').id).outgoing;
  assert.deepEqual(names(out.flatMap(g => g.ends)), ['GrappleCarryLower']);
  assert.equal(out[0].ends[0].pin, '내려놓기');
  assert.equal(cardFlow(w, view, hkx('GrappleCarryLower').id).incoming[0].pin, '내려놓기');
});

// Transitions and a condition's rows (the same shapes as tests/pin-targets.test.mjs).
const SOURCE = `<AnimationSet version="6" id="Flow">
  <Start event="Go">
    <Row to="Attacker"><Check kind="air" option="any"/></Row>
    <Row to="Victim"><Check kind="actorStatus" option="combat"/></Row>
  </Start>
  <Action id="Attacker" clip="Animations\Test\Attacker.hkx">
    <Transition to="Victim" key="E"/>
  </Action>
  <Action id="Victim" clip="Animations\Test\Victim.hkx"/>
</AnimationSet>`;

test('an HKX goes through its transition; a row is named by its number', () => {
  const w2 = importWorkspaceXml(SOURCE);
  const v2 = checklistProjection(w2, checklistModel(w2));
  const play = name =>
    v2.nodes.find(n => n.kind === 'hkxPlay' && w2.actions.find(a => a.uid === n.action)?.config.name === name);
  const out = cardFlow(w2, v2, play('Attacker').id).outgoing;
  assert.equal(out.length, 1);
  assert.equal(out[0].via.kind, 'transition');
  assert.deepEqual(names(out[0].ends), ['Victim']);
  // The victim is reached from the card's second row and from the attacker's transition.
  const into = cardFlow(w2, v2, play('Victim').id).incoming;
  assert.deepEqual(into.map(e => e.kind).sort(), ['conditionCard', 'transition']);
  assert.equal(into.find(e => e.kind === 'conditionCard').pin, '2번 행');
  assert.deepEqual(
    into.find(e => e.kind === 'transition').before.map(t => t.split(' · ').at(-1)),
    ['Attacker']
  );
});
