import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {setLinkMode, setLinkPress} from '../src/graph/cardEdits.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {checker, needsChecker} from './local.mjs';

// A key transition told apart by how its key is pressed (runtime 1.0.8): one per kind on a key, as a start's.
const DODGE = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Dodge">
  <Start key="LAlt" press="double" to="Roll"/>
  <Start key="LAlt" press="hold" to="Step"/>
  <Action id="Roll" clip="Animations\\Dodge\\Roll.hkx">
    <Transition to="Roll2" key="LAlt" press="double" from="0.3"/>
    <Transition to="Step" key="LAlt" press="tap" from="0.3"/>
    <Transition to="Step" key="LAlt" press="hold" from="0.3"/>
    <Transition to="Step" key="G" from="0.3"/>
  </Action>
  <Action id="Roll2" clip="Animations\\Dodge\\Roll2.hkx"/>
  <Action id="Step" clip="Animations\\Dodge\\Step.hkx"/>
</AnimationSet>
`;
const errors = w => [...validateWorkspace(w), ...cardIssues(w)].filter(i => i.level === 'error');
const keyOf = (w, l) => w.actions.find(a => a.uid === l.from).config.inputs.find(i => i.id === l.input).key;

test('press kinds on transitions read in, write back unchanged and are what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(DODGE);
  assert.deepEqual(errors(w), []);
  assert.deepEqual(
    w.links.map(l => [keyOf(w, l), l.press]),
    [
      ['LAlt', 'double'],
      ['LAlt', 'tap'],
      ['LAlt', 'hold'],
      ['G', undefined],
    ]
  );
  // The moment a key goes down is the absence of a kind: nothing is stored or written for it.
  assert.ok(!('press' in w.links[3]));
  const xml = compileWorkspace(w);
  for (const line of [
    '<Transition to="Roll2" key="LAlt" press="double" from="0.3"/>',
    '<Transition to="Step" key="LAlt" press="tap" from="0.3"/>',
    '<Transition to="Step" key="LAlt" press="hold" from="0.3"/>',
    '<Transition to="Step" key="G" from="0.3"/>',
  ])
    assert.ok(xml.includes(line), line + '\n' + xml);
  assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml);
  // The canvas names the kind beside the key.
  const summaries = flatGraph(w)
    .nodes.filter(n => n.kind === 'transition')
    .map(n => n.summary);
  assert.ok(summaries.some(s => s.startsWith('LAlt · 두 번')));
  assert.ok(summaries.some(s => s.startsWith('LAlt · 짧게')));
  assert.ok(summaries.some(s => s.startsWith('LAlt · 길게')));
  assert.ok(summaries.some(s => s.startsWith('G') && !s.includes('누를 때')));
  mkdirSync('tests/generated/press', {recursive: true});
  writeFileSync('tests/generated/press/Dodge.xml', xml);
  execFileSync(checker, ['tests/generated/press/Dodge.xml']);
});

test('one transition of each kind per key, and the moment a key goes down stands alone', () => {
  const w = importWorkspaceXml(DODGE);
  const [double, tap, hold, plain] = w.links;
  // Two of one kind on one key.
  const twice = setLinkPress(w, hold.id, 'tap');
  assert.ok(errors(twice).some(e => /같은 입력·같은 누름 방식의 전환이 둘/.test(e.message)));
  // On press beside another kind, whichever comes first in the file.
  const mixed = setLinkPress(w, hold.id, 'down');
  assert.ok(!('press' in mixed.links.find(l => l.id === hold.id)));
  assert.ok(errors(mixed).some(e => /누를 때 전환과 다른 누름 방식을 함께 쓸 수 없습니다/.test(e.message)));
  const mixedFirst = setLinkPress(w, double.id, 'down');
  assert.ok(errors(mixedFirst).some(e => /누를 때 전환과 다른 누름 방식을 함께 쓸 수 없습니다/.test(e.message)));
  // A key of its own takes any one kind.
  assert.deepEqual(errors(setLinkPress(w, plain.id, 'hold')), []);
  // Two plain transitions on one key are still one too many.
  const same = structuredClone(w);
  for (const id of [double.id, tap.id]) delete same.links.find(l => l.id === id).press;
  same.links = same.links.filter(l => l.id !== hold.id);
  assert.ok(errors(same).some(e => /같은 입력·같은 누름 방식의 전환이 둘/.test(e.message)));
});

test("the kind is a key transition's alone", () => {
  const w = importWorkspaceXml(DODGE);
  const tap = w.links[1];
  // Switched to an event, the kind goes; the others keep theirs.
  const event = setLinkMode(w, tap.id, 'event');
  assert.ok(!('press' in event.links.find(l => l.id === tap.id)));
  assert.equal(event.links[0].press, 'double');
  assert.equal(event.links[2].press, 'hold');
  // A kind left on another trigger is an error, not written out silently.
  const stray = structuredClone(w);
  Object.assign(
    stray.links.find(l => l.id === tap.id),
    {mode: 'end', input: '', window: false}
  );
  assert.ok(errors(stray).some(e => /누름 방식은 키를 누르는 전환에만/.test(e.message)));
  // The file's own mistakes are refused with their reason.
  assert.throws(
    () => importWorkspaceXml(DODGE.replace('key="LAlt" press="tap" from="0.3"', 'event="Hit" press="tap"')),
    /press는 키를 누르는 전환에만/
  );
  assert.throws(
    () => importWorkspaceXml(DODGE.replace('key="LAlt" press="tap" from="0.3"', 'on="release" key="LAlt" press="tap"')),
    /press는 키를 누르는 전환에만/
  );
  assert.throws(() => importWorkspaceXml(DODGE.replace('press="tap" from', 'press="long" from')));
});
