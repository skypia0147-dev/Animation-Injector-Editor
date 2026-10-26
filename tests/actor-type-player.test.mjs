import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {definition} from '../src/graph/conditionExtensions.ts';

// "대상 분류 · 플레이어" (runtime 0.12.267): true only for the player character, so a branch can keep an action to
// the player while NPCs take the other route.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="PlayerOnly">
  <Start id="Pick" key="G">
    <Check kind="actorType" option="player"/>
    <True to="PlayerMove"/>
    <False to="NpcMove"/>
  </Start>
  <Action id="PlayerMove" clip="Animations\\PlayerOnly\\Player.hkx"/>
  <Action id="NpcMove" clip="Animations\\PlayerOnly\\Npc.hkx"/>
</AnimationSet>`;
test('the actor type offers the player and its XML round-trips', () => {
  assert.equal(definition('actorType').choices[0][0], 'player');
  const xml = compileWorkspace(importWorkspaceXml(XML));
  assert.match(xml, /<Check kind="actorType" option="player"\/>/);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.throws(() => importWorkspaceXml(XML.replace('option="player"', 'option="pc"')));
});
