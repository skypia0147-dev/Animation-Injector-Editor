import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, selectsOnly} from '../src/workspace.ts';
import {parseXml} from '../src/xml.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {actionNode} from '../src/ui/details/inspectorModel.ts';

// A selecting pair (GrappleFront's shape): it picks A or B and never plays its own clip, yet carries
// playback settings, a camera restore and a transition of its own.
const xml = `<AnimationSet version="4" id="T">
  <EventRegistry><Event name="CamReset"/><Event name="Go"/></EventRegistry>
  <Pair id="Pick" clip="Animations\\T\\pick.hkx">
    <Start event="Contact" target="combatTarget"/>
    <Require weapon="drawn"/>
    <Exit at="end-0.2"/>
    <Advanced safety="40"/>
    <Flow entry="Sneak">
      <Test id="Sneak" kind="sneaking" subject="self" pass="ToA" fail="ToB"/>
      <Play id="ToA" action="A"/>
      <Play id="ToB" action="B"/>
    </Flow>
    <Target range="200" angle="180"/>
    <OnPartnerLost blend="0.6"/>
    <Effects><Camera reset="CamReset" restore="event"/></Effects>
    <Connect to="A" event="Go"/>
  </Pair>
  <Pair id="A" clip="Animations\\T\\a.hkx"><Target range="200" angle="180"/></Pair>
  <Pair id="B" clip="Animations\\T\\b.hkx"/>
</AnimationSet>`;

test('a selecting action is written with its start, conditions and flow only', () => {
  const w = importWorkspaceXml(xml);
  assert.deepEqual(
    w.actions.filter(selectsOnly).map(a => a.config.actionId),
    ['Pick']
  );
  const out = parseXml(compileWorkspace(w)),
    pick = out.children.find(n => n.attrs.id === 'Pick');
  assert.deepEqual(
    pick.children.map(n => n.name),
    ['Start', 'Require', 'Flow']
  );
  // Its clip never plays: it is not written (runtime 0.12.244).
  assert.equal(pick.attrs.clip, undefined);
  assert.deepEqual(pick.children[0].attrs, {event: 'Contact', target: 'combatTarget'});
  assert.deepEqual(pick.children[1].attrs, {weapon: 'drawn'});
  // The destinations keep their own playback settings.
  assert.deepEqual(
    out.children.find(n => n.attrs.id === 'A').children.map(n => n.name),
    ['Target']
  );
});

test("a selecting action's decision card lists its conditions; it has no HKX card", () => {
  const w = importWorkspaceXml(xml),
    pick = w.actions.find(a => a.config.actionId === 'Pick'),
    model = checklistModel(w);
  assert.deepEqual(
    model.items.get(`flow:${pick.uid}:${pick.flow.entry}`).map(i => i.node.kind),
    ['stateCondition']
  );
  const g = compactGraph(w, flatGraph(w));
  assert.ok(!g.nodes.some(n => n.action === pick.uid && ['hkxPlay', 'outputPose'].includes(n.kind)));
  assert.ok(g.nodes.some(n => n.id === `flow:${pick.uid}:${pick.flow.entry}`));
});

test('a selecting action without a clip reads back, writes the same and needs a clip once it plays itself', () => {
  const once = compileWorkspace(importWorkspaceXml(xml)),
    w = importWorkspaceXml(once),
    pick = w.actions.find(a => a.config.actionId === 'Pick');
  assert.equal(pick.config.steps[0].clip, '');
  assert.ok(selectsOnly(pick));
  assert.equal(compileWorkspace(w), once);
  pick.flow.tests[0].fail = {action: pick.uid};
  assert.throws(() => compileWorkspace(w), /HKX/);
});

test('the events a selecting action suppresses show with its conditions and are written', () => {
  const action = xml
    .replace('<Pair id="Pick"', '<Action id="Pick"')
    // An action picks actions.
    .replace(/<Pair id="A" (clip="[^"]+")><Target [^>]+><\/Pair>/, '<Action id="A" $1/>')
    .replace(/<Pair id="B" (clip="[^"]+")\/>/, '<Action id="B" $1/>')
    .replace('<Start event="Contact" target="combatTarget"/>', '<Start event="Contact"/>')
    .replace('<Require weapon="drawn"/>', '<Require weapon="drawn"/><Suppress events="blockStart"/>')
    .replace(
      /<Target range="200" angle="180"\/>\s*<OnPartnerLost blend="0.6"\/>\s*<Effects>.*<\/Effects>\s*<Connect to="A" event="Go"\/>\s*<\/Pair>/s,
      '</Action>'
    );
  const w = importWorkspaceXml(action),
    pick = w.actions.find(a => a.config.actionId === 'Pick');
  assert.ok(!pick.pair);
  assert.deepEqual(
    checklistModel(w)
      .items.get(`flow:${pick.uid}:${pick.flow.entry}`)
      .map(i => i.node.kind)
      .sort(),
    ['stateCondition', 'suppress']
  );
  assert.deepEqual(
    parseXml(compileWorkspace(w))
      .children.find(n => n.attrs.id === 'Pick')
      .children.map(n => n.name),
    ['Start', 'Require', 'Suppress', 'Flow']
  );
});

test('an action whose flow can play its own clip is not a selecting action', () => {
  const w = importWorkspaceXml(xml.replace('<Play id="ToB" action="B"/>', '<Play id="ToB" action="Pick"/>')),
    pick = w.actions.find(a => a.config.actionId === 'Pick');
  assert.equal(selectsOnly(pick), false);
  const out = parseXml(compileWorkspace(w)).children.find(n => n.attrs.id === 'Pick');
  for (const name of ['Exit', 'Advanced', 'Target', 'OnPartnerLost', 'Effects', 'Connect'])
    assert.ok(
      out.children.some(n => n.name === name),
      name
    );
});

test("the card that stands for an action: its HKX card, or a selecting action's decision card", () => {
  const w = importWorkspaceXml(xml),
    nodes = flatGraph(w).nodes,
    pick = w.actions.find(a => a.config.actionId === 'Pick'),
    a = w.actions.find(a => a.config.actionId === 'A');
  assert.equal(actionNode(w, nodes, pick), `flow:${pick.uid}:${pick.flow.entry}`);
  assert.equal(actionNode(w, nodes, a), nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay').id);
  // Shown as a condition table, the table card stands for it.
  assert.equal(actionNode({...w, conditionTables: [pick.uid]}, nodes, pick), `conditionTable:${pick.uid}`);
});
