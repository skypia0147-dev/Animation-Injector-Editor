import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, emptyWorkspace, addAction} from '../src/workspace.ts';
import {gamepadFromXml, gamepadXml, gamepadNames} from '../src/keys.ts';
import {newStart} from '../src/cards.ts';
import {checker, needsChecker} from './local.mjs';

// XML format 6 (runtime 0.12.291, docs/설계-형식6-에디터.md): the document is the file's starts, condition cards and
// HKX cards; the runtime's own parser checks what the editor writes.
const out = resolve('tests/generated/format6');
mkdirSync(out, {recursive: true});
const runtime = (name, xml, ...args) => {
  const file = resolve(out, name + '.xml');
  writeFileSync(file, xml);
  const r = spawnSync(checker, [...args, file], {encoding: 'utf8'});
  return {ok: r.status === 0, text: r.stdout + r.stderr};
};
// The runtime finds the editor's file the same as the source, start by start.
const same = (name, source, w) => {
  const a = resolve(out, name + '-source.xml'),
    b = resolve(out, name + '-editor.xml');
  writeFileSync(a, source);
  writeFileSync(b, compileWorkspace(w));
  const r = spawnSync(checker, ['--compare-starts', a, b], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
};

const HAND = `<AnimationSet version="6" id="Hand">
  <Start key="G" gamepad="RB" to="A1"/>
  <Action id="A1" clip="Animations\\Hand\\A1.hkx">
    <Transition to="A2" key="G" gamepad="RB" from="0.45"/>
    <Transition to="A3" key="H"/>
    <Vanilla to="Block"/>
  </Action>
  <Action id="A2" clip="Animations\\Hand\\A2.hkx">
    <Vanilla to="Jump" until="end-0.2"/>
  </Action>
  <Action id="A3" clip="Animations\\Hand\\A3.hkx"/>
</AnimationSet>`;

test('pad buttons: every name, code:N for the rest, a bare number refused like the runtime', needsChecker, () => {
  for (const [name, code] of Object.entries(gamepadNames)) {
    assert.equal(gamepadFromXml(name), code);
    assert.equal(gamepadFromXml(name.toLowerCase()), code, 'names ignore case');
    assert.equal(gamepadXml(code), name);
  }
  assert.equal(gamepadXml(300), 'code:300');
  assert.equal(gamepadFromXml('code:300'), 300);
  for (const bad of ['4096', 'code:0', 'code:65536', 'Z', ''])
    assert.throws(() => gamepadFromXml(bad), /패드 버튼/, bad);
  const numeric = HAND.replace('gamepad="RB"', 'gamepad="512"');
  assert.throws(() => importWorkspaceXml(numeric), /code:/);
  assert.ok(!runtime('pad-number', numeric).ok);
});

test(
  'new actions and pairs write only what was chosen (the defaults are the runtime omitted values)',
  needsChecker,
  () => {
    const w = emptyWorkspace();
    const single = addAction(w);
    w.actions.push(single);
    const pair = addAction(w, 'pair');
    w.actions.push(pair);
    single.config.steps[0].clip = 'Animations\\New\\Single.hkx';
    pair.config.steps[0].clip = 'Animations\\New\\Pair.hkx';
    assert.deepEqual(
      [single.config.air, 'safety' in single.config, 'cooldown' in single.config],
      ['deny', false, false],
      'a new action: ground only, no maximum play time; a cooldown is a start card`s'
    );
    assert.deepEqual([pair.pair.range, pair.pair.angle], [150, 60], 'a new pair: target 150 / 60');
    const xml = compileWorkspace(w);
    assert.doesNotMatch(xml, /<FindPartner|cooldown=|safety=|range=|angle=|air=/);
    const r = runtime('defaults', xml);
    assert.ok(r.ok, r.text);
    // Changed values are written, and read back: the cooldown on the start, the air rule on the action.
    w.starts.push({...newStart(w, {x: 0, y: 0}), key: 'G', cooldown: 0.5, to: {action: single.uid}});
    single.config.air = 'allow';
    Object.assign(pair.pair, {range: 200, angle: 90});
    const changed = compileWorkspace(w);
    assert.match(changed, /<Start to="CustomAction1" key="G" cooldown="0.5"\/>/);
    assert.match(changed, /<Action id="CustomAction1" clip="[^"]+" air="both"/);
    assert.match(changed, /<FindPartner range="200" angle="90"\/>/);
    same('changed', changed, importWorkspaceXml(changed));
  }
);

test('QTE keys and pad buttons by name; defaults left out', needsChecker, () => {
  const xml = `<AnimationSet version="6" id="Qte">
  <Start key="G" to="A"/>
  <Action id="A" clip="a.hkx">
    <QTE id="Q" at="0.5" key="" gamepad="X"/>
    <QTE id="S" at="0.6" type="keySequence">
      <Input gamepad="Y"/>
      <Input gamepad="A"/>
      <Input gamepad="code:300"/>
      <Input gamepad="B"/>
    </QTE>
  </Action>
</AnimationSet>`;
  const w = importWorkspaceXml(xml);
  assert.deepEqual(
    w.qtes.map(q => [q.key, q.gamepad]),
    [
      ['', 16384],
      ['E', 0],
    ]
  );
  assert.deepEqual(
    w.qtes[1].sequence.map(s => [s.key, s.gamepad]),
    [
      ['', 32768],
      ['', 4096],
      ['', 300],
      ['', 8192],
    ]
  );
  const written = compileWorkspace(w);
  assert.match(written, /<QTE id="Q" at="0.5" key="" gamepad="X"\/>/);
  assert.match(written, /<Input gamepad="A"\/>\s*<Input gamepad="code:300"\/>/);
  assert.doesNotMatch(written, /speed=|successWindow=|inputOwner=|anchor=|type="splitArc"/);
  same('qte', xml, w);
});
