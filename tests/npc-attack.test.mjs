import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {checker, needsChecker} from './local.mjs';

// NPC attack chains (runtime 1.1.0): the MCO window handed to the vanilla AI (animEvent), an NPC's own transition
// (on="npc") with a cooldown, a combat start, a distance past the weapon's reach and a graph variable.
const NPC = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="MyMoveset">
  <EventRegistry>
    <Event name="MCO_WinOpen">
      <Do op="animEvent" name="AttackWinStart"/>
    </Event>
    <Event name="MCO_WinClose">
      <Do op="animEvent" name="AttackWinEnd"/>
    </Event>
  </EventRegistry>
  <Start event="attackStart" block="attackStart" to="Attack1"/>
  <Start combat="npc" every="1.5" to="Dash">
    <Check kind="distance" measure="reach" compare="range" value="-20" upper="300"/>
    <Check kind="chance" value="30"/>
  </Start>
  <Action id="Attack1" clip="Animations\\MCO_attack1.hkx" attack="attackStart">
    <Transition to="Attack2" event="attackStart" from="event:MCO_WinOpen" until="event:MCO_WinClose">
      <Check kind="graphVariable" variable="MCO_nextattack" type="int" compare="eq" value="2"/>
    </Transition>
    <Transition to="Power1" event="attackPowerStartInPlace" from="event:MCO_PowerWinOpen" until="event:MCO_PowerWinClose" bufferFrom="0.35"/>
    <Transition to="Power1" on="npc" from="event:MCO_WinOpen" until="event:MCO_WinClose" cooldown="3">
      <Check kind="distance" measure="reach" compare="le" value="40"/>
    </Transition>
  </Action>
  <Action id="Attack2" clip="Animations\\MCO_attack2.hkx" attack="attackStart"/>
  <Action id="Power1" clip="Animations\\MCO_powerattack1.hkx" attack="attackPowerStartInPlace"/>
  <Action id="Dash" clip="Animations\\MyMoveset\\Dash.hkx" attack="attackPowerStartForward"/>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');

test('NPC attack chains read in, write back unchanged and are what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(NPC);
  assert.deepEqual(errors(w), []);
  const combat = w.starts.find(s => s.mode === 'combat');
  assert.ok(combat, 'a combat start');
  assert.equal(combat.every, 1.5);
  const npc = w.links.find(l => l.mode === 'npc');
  assert.ok(npc, 'an NPC transition');
  assert.equal(npc.cooldown, 3);
  assert.equal(w.links.find(l => l.event === 'attackPowerStartInPlace')?.bufferFrom, 0.35, 'bufferFrom read');
  const tests = w.cards.flatMap(c => c.tests);
  assert.ok(tests.some(t => t.kind === 'distance' && t.measure === 'reach' && t.value === -20));
  assert.ok(tests.some(t => t.kind === 'graphVariable' && t.variable === 'MCO_nextattack' && t.variableType === 'int'));
  const open = (w.eventRegistry ?? []).find(e => e.name === 'MCO_WinOpen');
  assert.ok(open, 'the window event registered');
  const xml = compileWorkspace(w);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.match(xml, /<Start to="Dash" combat="npc" every="1.5">/);
  assert.match(xml, /on="npc"[^>]*cooldown="3"|cooldown="3"[^>]*on="npc"/);
  assert.match(xml, /op="animEvent" name="AttackWinStart"/);
  mkdirSync('tests/generated/npc-attack', {recursive: true});
  writeFileSync('tests/generated/npc-attack/MyMoveset.xml', xml);
  execFileSync(checker, ['tests/generated/npc-attack/MyMoveset.xml']);
});

test('what the runtime refuses about NPC choices and combat starts is refused on reading', () => {
  for (const bad of [
    NPC.replace('on="npc" from', 'on="npc" event="E" from'),
    NPC.replace('cooldown="3"', 'cooldown="601"'),
    NPC.replace('combat="npc" every="1.5"', 'combat="npc" every="0"'),
    NPC.replace('combat="npc" every="1.5"', 'combat="npc" event="E"'),
    NPC.replace('combat="npc" every="1.5"', 'combat="npc" actor="npc"'),
    NPC.replace('<Start event="attackStart"', '<Start event="attackStart" every="1"'),
    NPC.replace('type="int"', 'type="string"'),
    NPC.replace('measure="reach" compare="le"', 'measure="percent" compare="le"'),
  ])
    assert.throws(() => importWorkspaceXml(bad));
});
