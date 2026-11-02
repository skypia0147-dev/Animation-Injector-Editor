import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {setLinkMode, setReleaseKey} from '../src/graph/cardEdits.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {costToEvent} from '../src/graph/hkxMoments.ts';
import {checker, needsChecker} from './local.mjs';

// Charge (runtime 10-30): a held start, a clip that ends into a loop, the key's release choosing by held time.
const CHARGE = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Charge">
  <Start control="rightAttack" press="hold" to="ChargeStart"/>
  <Action id="ChargeStart" clip="Animations\\Charge\\Start.hkx">
    <Transition to="ChargeLoop" on="end" blend="0.1"/>
    <Transition condition="ChargeLevel" on="release" from="0.2"/>
  </Action>
  <Action id="ChargeLoop" clip="Animations\\Charge\\Loop.hkx" loop="true" maxHold="2.5">
    <HyperArmor/>
    <Transition condition="ChargeLevel" on="release"/>
    <Transition to="Weak" on="release" key="G"/>
  </Action>
  <Condition id="ChargeLevel">
    <Row to="Strong"><Check kind="heldTime" compare="ge" value="1.5"/></Row>
    <False to="Weak"/>
  </Condition>
  <Action id="Strong" clip="Animations\\Charge\\Strong.hkx"/>
  <Action id="Weak" clip="Animations\\Charge\\Weak.hkx"/>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');

test('a charge reads in, writes back unchanged and is what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(CHARGE);
  assert.deepEqual(errors(w), []);
  const loop = w.actions.find(a => a.config.actionId === 'ChargeLoop');
  assert.deepEqual(loop.config.loop, {maxHold: 2.5});
  assert.deepEqual(
    w.links.map(l => l.mode),
    ['end', 'release', 'release', 'release']
  );
  const xml = compileWorkspace(w);
  for (const line of [
    '<Transition to="ChargeLoop" on="end" blend="0.1"/>',
    '<Transition condition="ChargeLevel" on="release" from="0.2"/>',
    '<Transition to="Weak" on="release" key="G"/>',
    'loop="true" maxHold="2.5"',
    '<Check kind="heldTime" compare="ge" value="1.5"/>',
  ])
    assert.ok(xml.includes(line), line);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  // The canvas: the loop is an item of its HKX card, the transitions are named by what moves them on.
  const g = flatGraph(w);
  assert.ok(g.nodes.some(n => n.kind === 'loopRule' && n.summary === '최대 2.5초'));
  assert.ok(g.nodes.some(n => n.kind === 'transition' && n.title === '전환 · 끝나면'));
  mkdirSync('tests/generated/charge', {recursive: true});
  writeFileSync('tests/generated/charge/Charge.xml', xml);
  execFileSync(checker, ['tests/generated/charge/Charge.xml']);
});

test('the editor keeps a charge within what the runtime takes', () => {
  const w = importWorkspaceXml(CHARGE);
  const loop = w.actions.find(a => a.config.actionId === 'ChargeLoop');
  const start = w.actions.find(a => a.config.actionId === 'ChargeStart');
  const release = w.links.find(l => l.from === loop.uid && l.mode === 'release' && !l.input);
  // A loop has no end: no end transition, no exit time, no end-… window.
  const ending = setLinkMode(w, release.id, 'end');
  assert.ok(errors(ending).some(e => /끝나면 전환을 쓸 수 없습니다/.test(e.message)));
  const exitTime = structuredClone(w);
  exitTime.actions.find(a => a.uid === loop.uid).config.exit.seconds = 0.2;
  assert.ok(errors(exitTime).some(e => /종료 시각을 정할 수 없습니다/.test(e.message)));
  // One end per HKX.
  const twoEnds = setLinkMode(w, w.links.find(l => l.from === start.uid && l.mode === 'release').id, 'end');
  assert.ok(errors(twoEnds).some(e => /HKX마다 하나/.test(e.message)));
  // A release's key: the one that started the action, or one of its own (a binding of the source HKX).
  const own = setReleaseKey(w, release.id, true);
  const ownLink = own.links.find(l => l.id === release.id);
  assert.ok(ownLink.input && own.actions.find(a => a.uid === loop.uid).config.inputs.some(i => i.id === ownLink.input));
  const back = setReleaseKey(own, release.id, false);
  assert.equal(back.links.find(l => l.id === release.id).input, '');
  // The add menu: an end once and not from a loop; the loop item once.
  const graph = flatGraph(w);
  const card = id => graph.nodes.find(n => n.kind === 'hkxPlay' && n.action === id).id;
  const kinds = id => contextualAdds(w, card(id), graph).map(o => o.kind);
  assert.ok(!kinds(loop.uid).includes('transitionEnd') && !kinds(loop.uid).includes('loopRule'));
  assert.ok(!kinds(start.uid).includes('transitionEnd') && kinds(start.uid).includes('loopRule'));
  // A charge end and a move transition only in a charge (runtime 10-31): the held start's HKX and its loop, not the
  // attack after the charge ended.
  for (const a of [start, loop])
    assert.ok(kinds(a.uid).includes('transitionRelease') && kinds(a.uid).includes('transitionMove'));
  const strong = w.actions.find(a => a.config.actionId === 'Strong');
  assert.ok(kinds(strong.uid).includes('transitionEnd'));
  assert.ok(!kinds(strong.uid).includes('transitionRelease') && !kinds(strong.uid).includes('transitionMove'));
  const added = addConnected(w, card(strong.uid), {label: '', kind: 'transitionEnd'}, {x: 0, y: 0});
  assert.equal(added.workspace.links.at(-1).mode, 'end');
});

// A moving charge (10-30): directional dash loops that change by the movement direction, sharing one move and one
// release transition, drawn as marks.
const MOVING = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Moving">
  <Start control="jump" press="hold" to="ChargeStart"/>
  <Action id="ChargeStart" clip="Animations\\Charge\\Start.hkx">
    <Transition condition="ChargeDir" on="end"/>
  </Action>
  <Condition id="ChargeDir">
    <Row to="DashF"><Check kind="movementDirection" option="forward"/></Row>
    <Row to="DashL"><Check kind="movementDirection" option="left"/></Row>
    <False to="Stance"/>
  </Condition>
  <Condition id="ChargeHeld">
    <Row to="Strong"><Check kind="heldTime" compare="ge" value="1.5"/></Row>
    <False to="Weak"/>
  </Condition>
  <Action id="Stance" clip="Animations\\Charge\\Stance.hkx" loop="true" maxHold="10">
    <Transition condition="ChargeDir" on="move"/>
    <Transition condition="ChargeHeld" on="release"/>
  </Action>
  <Action id="DashF" clip="Animations\\Charge\\DashF.hkx" enter="0.15" loop="true" maxHold="10">
    <Transition condition="ChargeDir" on="move"/>
    <Transition condition="ChargeHeld" on="release"/>
  </Action>
  <Action id="DashL" clip="Animations\\Charge\\DashL.hkx" enter="0.15" loop="true" maxHold="10">
    <Transition condition="ChargeDir" on="move"/>
    <Transition condition="ChargeHeld" on="release"/>
  </Action>
  <Action id="Strong" clip="Animations\\Charge\\Strong.hkx"/>
  <Action id="Weak" clip="Animations\\Charge\\Weak.hkx"/>
</AnimationSet>
`;

test('a moving charge reads in, writes back, and its loops share one move and one release card', needsChecker, () => {
  const w = importWorkspaceXml(MOVING);
  assert.deepEqual(errors(w), []);
  const xml = compileWorkspace(w);
  assert.equal((xml.match(/<Transition condition="ChargeDir" on="move"\/>/g) ?? []).length, 3);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  // The import joins the equal move and release transitions of the three loops (graph/sharing.ts).
  const groups = (w.sharedRules ?? []).map(g => g.members.map(m => w.links.find(l => l.id === m).mode));
  assert.deepEqual(groups.map(g => [g[0], g.length]).sort(), [
    ['move', 3],
    ['release', 3],
  ]);
  const g = flatGraph(w);
  assert.ok(g.nodes.some(n => n.kind === 'transition' && n.title === '전환 · 이동 전환'));
  mkdirSync('tests/generated/charge', {recursive: true});
  writeFileSync('tests/generated/charge/Moving.xml', xml);
  execFileSync(checker, ['tests/generated/charge/Moving.xml']);
});

// A movement key's press (10-31): directional one-shot dashes chained by on="move" (buffered by default, here not),
// each choosing among them again, itself included.
const DASH = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Dash">
  <Start control="sprint" condition="DashDir"/>
  <Condition id="DashDir">
    <Row to="DashL"><Check kind="movementDirection" option="left"/></Row>
    <False to="DashF"/>
  </Condition>
  <Action id="DashF" clip="Animations\\Dash\\F.hkx">
    <Transition condition="DashDir" on="move" from="0.5"/>
  </Action>
  <Action id="DashL" clip="Animations\\Dash\\L.hkx">
    <Transition condition="DashDir" on="move" from="0.5" buffer="false"/>
  </Action>
</AnimationSet>
`;

test('on="move" keeps its buffer setting through the editor', needsChecker, () => {
  const w = importWorkspaceXml(DASH);
  assert.deepEqual(errors(w), []);
  // A pressed start is no charge: its HKX offers no move transition or charge end.
  const graph = flatGraph(w);
  const dash = w.actions.find(a => a.config.actionId === 'DashF');
  const offered = contextualAdds(w, graph.nodes.find(n => n.kind === 'hkxPlay' && n.action === dash.uid).id, graph);
  assert.ok(!offered.some(o => o.kind === 'transitionMove' || o.kind === 'transitionRelease'));
  const xml = compileWorkspace(w);
  assert.match(xml, /<Transition condition="DashDir" on="move" from="0\.5" buffer="false"\/>/);
  assert.equal((xml.match(/on="move"/g) ?? []).length, 2);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  mkdirSync('tests/generated/charge', {recursive: true});
  writeFileSync('tests/generated/charge/Dash.xml', xml);
  execFileSync(checker, ['tests/generated/charge/Dash.xml']);
});

// A resource cost (10-31): health beside stamina and magicka, through the editor and the runtime checker.
test('a cost of stamina, magicka and health reads in and writes back', needsChecker, () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Cost">
  <Start key="G" to="Pay"/>
  <Action id="Pay" clip="Animations/Cost/Pay.hkx">
    <Cost stamina="10" magicka="5" health="15"/>
  </Action>
</AnimationSet>
`;
  const w = importWorkspaceXml(xml);
  assert.deepEqual(errors(w), []);
  assert.equal(w.actions[0].config.cost.health, 15);
  const out = compileWorkspace(w);
  assert.match(out, /<Cost stamina="10" magicka="5" health="15"\/>/);
  mkdirSync('tests/generated/charge', {recursive: true});
  writeFileSync('tests/generated/charge/Cost.xml', out);
  execFileSync(checker, ['tests/generated/charge/Cost.xml']);
});

// A cost in percent of each maximum (10-31): the action's Cost and a registered cost, through the runtime checker.
test('a percent cost reads in and writes back, on the clip and in the registry', needsChecker, () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Percent">
  <Start key="G" to="Pay"/>
  <Action id="Pay" clip="Animations/Cost/Pay.hkx">
    <Cost stamina="25" health="10" measure="percent"/>
  </Action>
</AnimationSet>
`;
  const w = importWorkspaceXml(xml);
  assert.deepEqual(errors(w), []);
  assert.equal(w.actions[0].config.cost.percent, true);
  const out = compileWorkspace(w);
  assert.match(out, /<Cost stamina="25" health="10" measure="percent"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(out)), out);
  writeFileSync('tests/generated/charge/Percent.xml', out);
  execFileSync(checker, ['tests/generated/charge/Percent.xml']);
  // Moved to an event, the unit goes to the registry and the amounts stay this action's numbers.
  const moved = costToEvent(w, w.actions[0].uid, 'PayNow');
  const fn = moved.eventRegistry.find(r => r.name === 'PayNow').functions[0];
  assert.deepEqual(fn.values, {op: 'cost', measure: 'percent'});
  const movedXml = compileWorkspace(moved);
  assert.match(movedXml, /<Do op="cost" measure="percent"\/>/);
  writeFileSync('tests/generated/charge/PercentEvent.xml', movedXml);
  execFileSync(checker, ['tests/generated/charge/PercentEvent.xml']);
  // Above 100 percent is refused; the same amount as a value is not.
  const over = structuredClone(w);
  over.actions[0].config.cost.stamina = 150;
  assert.ok(errors(over).length > 0);
  over.actions[0].config.cost.percent = false;
  assert.deepEqual(errors(over), []);
});
