import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace} from '../src/workspace.ts';
import {addConnected} from '../src/graph/contextAdd.ts';
import {checklistModel, checklistProjection} from '../src/graph/checklist.ts';
import {pinRows, connectPin, routable, routeDestination, portLabel} from '../src/graph/pinTargets.ts';
import {flatGraph} from '../src/graph/flat.ts';

// Connecting by choosing from a list (the card's ▾ and Details "연결"): the same connection as a drag. Starts,
// transitions and condition cards choose HKX cards and condition cards (XML format 6).
const SOURCE = `<AnimationSet version="6" id="Pins">
  <Start to="Grab" key="E"/>
  <Start event="Go">
    <Row to="Attacker"><Check kind="air"/></Row>
    <Row to="Victim"><Check kind="combat"/></Row>
  </Start>
  <Pair id="Grab" clip="Animations\\Test\\Grab.hkx"/>
  <Pair id="Carry" clip="Animations\\Test\\Carry.hkx"/>
  <Action id="Attacker" clip="Animations\\Test\\Attacker.hkx"/>
  <Action id="Victim" clip="Animations\\Test\\Victim.hkx"/>
</AnimationSet>`;
// a1 Grab (pair), a2 Carry (pair), a3 Attacker, a4 Victim; start2's card is card1
const view = w => checklistProjection(w, checklistModel(w));
const hkx = uid => `anim:${uid}:|clip_A1`;
const choose = (w, id, pin, target) => connectPin(w, view(w), id, pin, target);
const transitionEvent = (w, from) => {
  const added = addConnected(w, hkx(from), {kind: 'markerReceive', label: '전환 이벤트 추가'}, {x: 0, y: 0});
  const link = added.workspace.links.at(-1);
  link.event = 'Stage1';
  return {w: added.workspace, id: added.id, link};
};

test('a new transition lists HKX and condition card destinations and choosing one sets it', () => {
  let {w, id} = transitionEvent(importWorkspaceXml(SOURCE), 'a3');
  assert.match(id, /^transition:/);
  const [row] = pinRows(w, view(w), id);
  assert.equal(row.pin, 'trigger');
  assert.equal(row.current, '');
  assert.ok(row.targets.some(t => t.id === hkx('a4') && t.group === '일반 동작' && !t.disabled));
  assert.ok(row.targets.some(t => t.id === 'conditionCard:card1' && t.group === '조건 카드'));
  assert.match(row.targets.find(t => t.id === hkx('a3')).disabled, /출발/);
  w = choose(w, id, 'trigger', hkx('a4'));
  assert.deepEqual(
    w.links.map(l => [l.from, l.to, l.event]),
    [['a3', 'a4', 'Stage1']]
  );
  assert.equal(routeDestination(w, id, 'trigger'), 'Victim');
  // Through a condition card instead: two places now go to the card, so it is written once at the root.
  w = choose(w, id, 'trigger', 'conditionCard:card1');
  assert.equal(w.links[0].card, 'card1');
  assert.equal(w.links[0].to, '');
  const xml = compileWorkspace(w);
  assert.match(xml, /<Condition id="Choice1">\s*<Row to="Attacker">/);
  assert.match(xml, /<Start condition="Choice1" event="Go"\/>/);
  assert.match(xml, /<Transition condition="Choice1" event="Stage1"\/>/);
});

test('a pair transition lists its attacker and victim with the runtime rules, and the victim can be cleared', () => {
  let {w, id} = transitionEvent(importWorkspaceXml(SOURCE), 'a1');
  w = choose(w, id, 'trigger', hkx('a3'));
  assert.ok(routable(view(w).nodes.find(n => n.id === id)));
  let rows = pinRows(w, view(w), id);
  assert.deepEqual(
    rows.map(r => [r.pin, r.label, r.currentLabel]),
    [
      ['trigger', '가해자', 'Attacker'],
      ['partner', '피해자', ''],
    ]
  );
  const partner = rows[1].targets;
  assert.match(partner.find(t => t.id === hkx('a2')).disabled, /페어/);
  assert.match(partner.find(t => t.id === hkx('a3')).disabled, /가해자/);
  assert.equal(partner.find(t => t.id === hkx('a4')).disabled, undefined);
  w = choose(w, id, 'partner', hkx('a4'));
  assert.equal(w.links[0].partnerTo, 'a4');
  rows = pinRows(w, view(w), id);
  assert.equal(rows[1].currentLabel, 'Victim');
  assert.match(compileWorkspace(w), /<Transition to="Attacker" partnerTo="Victim" event="Stage1"\/>/);
  w = choose(w, id, 'partner', '');
  assert.equal(w.links[0].partnerTo, '');
});

test("a condition card's rows are numbered and choose HKX or other cards; a loop is refused", () => {
  let w = importWorkspaceXml(SOURCE);
  const card = 'conditionCard:card1';
  const node = view(w).nodes.find(n => n.id === card);
  const rows = pinRows(w, view(w), card);
  assert.deepEqual(
    rows.map(r => [portLabel(node, r.pin), r.currentLabel]),
    [
      ['1', 'Attacker'],
      ['2', 'Victim'],
      ['False', ''],
    ]
  );
  w = choose(w, card, 'false', hkx('a1'));
  assert.equal(w.cards[0].false.action, 'a1');
  assert.match(compileWorkspace(w), /<False to="Grab"\/>/);
  // A new card on False: it may not go back to the card that leads to it.
  const added = addConnected(w, card, {kind: 'conditionCard', label: '', port: 'false'}, {x: 0, y: 0});
  w = added.workspace;
  const second = 'conditionCard:' + w.cards.find(c => c.uid !== 'card1').uid;
  assert.equal(w.cards[0].false.card, second.slice('conditionCard:'.length));
  assert.match(
    pinRows(w, view(w), second)
      .find(r => r.pin === 'false')
      .targets.find(t => t.id === card).disabled,
    /순환/
  );
  assert.throws(() => choose(w, second, 'false', card), /순환/);
  // A start's destination is chosen the same way.
  w = choose(w, 'startCard:start1', 'trigger', hkx('a2'));
  assert.equal(w.starts[0].to.action, 'a2');
  assert.ok(flatGraph(w).edges.some(e => e.source === 'startCard:start1' && e.target === hkx('a2')));
});
