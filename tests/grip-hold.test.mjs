import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {doAttrs, functionErrors, functionParts, functionSummary, unchosen} from '../src/eventRegistry.ts';
import {parseCommand, commandSummary} from '../src/annotationCommands.ts';
import {checker, needsChecker} from './local.mjs';

// Grip hold (runtime 1.0.9 gripHold / gripRelease, docs/mockup-grip-hold): an action's clip-time functions and
// registered events, a hand always written, a view only when not third person, no blend (the release is at once).
const GRIP = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Grip">
  <EventRegistry>
    <Event name="Grip_Reverse">
      <Do op="gripHold" hand="left" view="both"/>
    </Event>
    <Event name="Grip_Normal">
      <Do op="gripRelease" hand="left" view="both"/>
    </Event>
  </EventRegistry>
  <Start key="H" to="Reverse"/>
  <Start key="J" to="Normal"/>
  <Action id="Reverse" clip="Animations\\Grip\\Reverse.hkx">
    <Do at="0.6" op="gripHold" hand="both"/>
  </Action>
  <Action id="Normal" clip="Animations\\Grip\\Normal.hkx">
    <Do at="0" op="gripRelease" hand="right" view="first"/>
  </Action>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');

test('grip hold and release read in, write back unchanged and are what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(GRIP);
  assert.deepEqual(errors(w), []);
  const xml = compileWorkspace(w);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  assert.match(xml, /<Do at="0\.6" op="gripHold" hand="both"\/>/);
  assert.match(xml, /<Do at="0" op="gripRelease" hand="right" view="first"\/>/);
  assert.match(xml, /<Do op="gripHold" hand="left" view="both"\/>/);
  assert.doesNotMatch(xml, /blend=|view="third"/);
  mkdirSync('tests/generated/grip', {recursive: true});
  writeFileSync('tests/generated/grip/Grip.xml', xml);
  execFileSync(checker, ['tests/generated/grip/Grip.xml']);
});

test('a grip needs a hand; third person is the default view; no delay', () => {
  assert.deepEqual(unchosen('gripHold'), {hand: ''});
  assert.ok(functionErrors({op: 'gripHold', hand: ''}).length);
  assert.ok(functionErrors({op: 'gripRelease'}).length);
  assert.deepEqual(functionErrors({op: 'gripHold', hand: 'both'}), []);
  assert.ok(functionErrors({op: 'gripHold', hand: 'middle'}).length);
  assert.ok(functionErrors({op: 'gripHold', hand: 'right', view: 'side'}).length);
  assert.ok(functionErrors({op: 'hide', view: 'first'}).length);
  assert.deepEqual(doAttrs({op: 'gripHold', hand: 'right', view: 'third', delay: '0.2'}), {
    op: 'gripHold',
    hand: 'right',
  });
  // The row summary (mockup C, D, E): the hands, the view only when it is not third person.
  assert.deepEqual(functionParts({op: 'gripHold', hand: 'both'}), ['양손']);
  assert.deepEqual(functionParts({op: 'gripRelease', hand: 'left', view: 'both'}), ['왼손', '둘 다']);
  assert.equal(functionSummary({op: 'gripHold', hand: 'right', view: 'first'}), '잡기 유지 · 오른손 · 1인칭');
});

test('AI.GripHold and AI.GripRelease take a hand and a view', () => {
  assert.deepEqual(parseCommand('GripHold|right|both'), {op: 'gripHold', hand: 'right', view: 'both'});
  assert.deepEqual(parseCommand('griprelease|left|third'), {op: 'gripRelease', hand: 'left', view: 'third'});
  for (const bad of ['GripHold', 'GripHold|right', 'GripHold|up|third', 'GripRelease|right|third|0'])
    assert.equal(parseCommand(bad), undefined, bad);
  assert.equal(commandSummary('GripHold|both|first'), '잡기 유지 · 양손 · 1인칭');
});
