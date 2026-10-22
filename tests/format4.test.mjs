import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, emptyWorkspace, addAction} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {gamepadFromXml, gamepadXml, gamepadNames} from '../src/keys.ts';
import {createProject} from '../src/model.ts';
import {checker, needsChecker} from './local.mjs';

// XML format 4 (runtime 0.12.233, docs/계획-문법개편-v4.md): keys where they are used, pad buttons by name,
// the omitted Window, defaults left out, combos gone. The runtime's own parser checks what the editor writes.
const out = resolve('tests/generated/format4');
mkdirSync(out, {recursive: true});
const runtime = (name, xml, ...args) => {
  const file = resolve(out, name + '.xml');
  writeFileSync(file, xml);
  const r = spawnSync(checker, [...args, file], {encoding: 'utf8'});
  return {ok: r.status === 0, text: r.stdout + r.stderr};
};
const same = (name, source, w) => {
  const a = resolve(out, name + '-source.xml'),
    b = resolve(out, name + '-editor.xml');
  writeFileSync(a, source);
  writeFileSync(b, compileWorkspace(w));
  const r = spawnSync(checker, ['--compare', a, b], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
};

const HAND = `<AnimationSet version="4" id="Hand">
  <Action id="A1" clip="Animations\\Hand\\A1.hkx">
    <Start key="G" gamepad="RB"/>
    <Connect to="A2" key="G" gamepad="RB"><Window from="0.45"/></Connect>
    <Connect to="A3" key="H"/>
    <Cancel to="vanilla:Block"/>
  </Action>
  <Action id="A2" clip="Animations\\Hand\\A2.hkx"><Cancel to="vanilla:Jump"><Window until="end-0.2"/></Cancel></Action>
  <Action id="A3" clip="Animations\\Hand\\A3.hkx"/>
</AnimationSet>`;

test('a hand-written file imports, writes back the same way, and reads the same in the runtime', needsChecker, () => {
  const w = importWorkspaceXml(HAND);
  const a1 = w.actions[0];
  const key = id => a1.config.inputs.find(i => i.id === id);
  assert.deepEqual(
    [key(a1.config.start.input).key, key(a1.config.start.input).gamepad],
    ['G', 512],
    'start key and pad button'
  );
  // The same key on the same action is one editor input.
  assert.equal(w.links[0].input, a1.config.start.input);
  assert.equal(w.links[0].window, true);
  assert.equal(w.links[1].window, false, 'no Window: the whole clip');
  assert.equal(a1.cancels[0].always, true);
  const xml = compileWorkspace(w);
  assert.doesNotMatch(xml, /<Inputs|<Require|<Advanced|graph=/);
  assert.match(xml, /<Start key="G" gamepad="RB"\/>/);
  assert.match(xml, /<Connect to="A2" key="G" gamepad="RB">\s*<Window from="0.45"\/>\s*<\/Connect>/);
  assert.match(xml, /<Connect to="A3" key="H"\/>/);
  assert.match(xml, /<Cancel to="vanilla:Block"\/>/);
  assert.match(xml, /<Cancel to="vanilla:Jump">\s*<Window until="end-0.2"\/>/);
  same('hand', HAND, w);
  // Saved and opened again, the project writes the same file.
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), xml);
});

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
      [single.config.cooldown, single.config.air, 'safety' in single.config],
      [0, 'deny', false],
      'a new action: no cooldown, ground only, no maximum play time'
    );
    assert.deepEqual(
      [pair.config.cooldown, pair.pair.range, pair.pair.angle],
      [0, 150, 60],
      'a new pair: no cooldown, target 150 / 60'
    );
    const xml = compileWorkspace(w);
    assert.doesNotMatch(xml, /<Require|<Advanced|<Target|cooldown=|safety=|range=|angle=/);
    const r = runtime('defaults', xml);
    assert.ok(r.ok, r.text);
    // Changed values are written, and read back.
    Object.assign(single.config, {cooldown: 0.5, air: 'allow'});
    Object.assign(pair.pair, {range: 200, angle: 90});
    const changed = compileWorkspace(w);
    assert.match(changed, /<Require air="allow" cooldown="0.5"\/>/);
    assert.match(changed, /<Target range="200" angle="90"\/>/);
    same('changed', changed, importWorkspaceXml(changed));
  }
);

test('the maximum play time left the editor (10-23): a written one is read and dropped, a saved one too', () => {
  const xml = `<AnimationSet version="4" id="Safety"><Action id="A" clip="a.hkx"><Start key="G"/><Advanced safety="2"/></Action></AnimationSet>`;
  const w = importWorkspaceXml(xml);
  assert.equal('safety' in w.actions[0].config, false);
  assert.doesNotMatch(compileWorkspace(w), /<Advanced|safety=/);
  const saved = captureGraph(w);
  saved.nodes.find(n => n.kind === 'settings').data.config.safety = 2;
  const reopened = parseWorkspace(JSON.stringify(saved));
  assert.equal('safety' in reopened.actions[0].config, false);
});

test(
  'an older Require stamina check becomes a branch test (runtime 0.12.276); spending stays Cost',
  needsChecker,
  () => {
    const xml = `<AnimationSet version="4" id="Stamina"><Action id="A" clip="a.hkx"><Start key="G"/><Require stamina="30"/><Cost stamina="10"/></Action></AnimationSet>`;
    const w = importWorkspaceXml(xml);
    assert.equal('requiredStamina' in w.actions[0].config, false);
    assert.deepEqual(
      w.actions[0].flow.tests.map(t => [t.kind, t.minimum, t.pass]),
      [['stamina', 30, {action: w.actions[0].uid}]]
    );
    assert.deepEqual([w.actions[0].config.cost.enabled, w.actions[0].config.cost.stamina], [true, 10]);
    const out = compileWorkspace(w);
    assert.doesNotMatch(out, /<Require/);
    assert.match(out, /<Test id="RequireStamina" kind="stamina" subject="self" minimum="30" pass="[^"]+"\/>/);
    assert.match(out, /<Cost stamina="10"\/>/);
    mkdirSync('tests/generated', {recursive: true});
    writeFileSync('tests/generated/format4-stamina.xml', out);
    const r = spawnSync(checker, ['tests/generated/format4-stamina.xml'], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
);

test('removed forms are refused by the editor and the runtime alike, naming what replaces them', needsChecker, () => {
  const action = body =>
    `<AnimationSet version="4" id="Gone"><Action id="A" clip="a.hkx">${body}</Action></AnimationSet>`;
  for (const [name, xml, pattern] of [
    ['format3', action('').replace('version="4"', 'version="3"'), /version="4"/],
    [
      'combo',
      '<AnimationSet version="4" id="Gone"><Combo id="C" entry="S"><Step id="S" clip="a.hkx"/></Combo></AnimationSet>',
      /Connect/,
    ],
    ['step', action('<Step id="S" clip="a.hkx"/>'), /Connect/],
    ['graph', action('<Advanced graph="FullBodyPlayerIdles_Behavior"/>'), /graph/],
    ['always', action('<Cancel to="vanilla:Block"><Window always="true"/></Cancel>'), /always/],
  ]) {
    assert.throws(() => importWorkspaceXml(xml), pattern, name);
    assert.ok(!runtime('gone-' + name, xml).ok, name);
  }
});

test('a project saved with a combo does not open; one saved before format 4 without a combo does', () => {
  const w = importWorkspaceXml(HAND),
    g = captureGraph(w);
  // A saved combo: its transition (a rule node) and a second HKX.
  const combo = structuredClone(g),
    owner = combo.nodes.find(n => n.kind === 'settings');
  owner.data.config.kind = 'combo';
  combo.nodes.push({id: 'rule:a1:T1', kind: 'rule', data: {id: 'T1'}});
  combo.edges.push({id: 'e999', source: owner.id, target: 'rule:a1:T1', role: 'owns'});
  assert.throws(() => parseWorkspace(JSON.stringify(combo)), /콤보는 없어졌습니다/);
  // Schema 7 projects carried an empty transition list on every action.
  const old = structuredClone(w);
  for (const a of old.actions) a.config.transitions = [];
  assert.deepEqual(parseWorkspace(JSON.stringify(old)), w);
  // A switched-away combo variant is dropped, not refused.
  const variant = structuredClone(w);
  variant.actions[0].variants = {combo: {config: {...createProject(), kind: 'combo'}, pair: null}};
  assert.deepEqual(parseWorkspace(JSON.stringify(variant)).actions[0].variants, {});
});

test(
  'removed in 0.12.238: the lock window, lock functions and External are refused; unused lock fields drop',
  needsChecker,
  () => {
    const action = body =>
      `<AnimationSet version="4" id="Gone"><Action id="A" clip="a.hkx">${body}</Action></AnimationSet>`;
    const registry = op =>
      `<AnimationSet version="4" id="Gone"><EventRegistry><Event name="E"><Do op="${op}"/></Event></EventRegistry></AnimationSet>`;
    for (const [name, xml] of [
      ['lock-window', action('<Lock from="0.1" until="end"/>')],
      ['lock-function', registry('lock')],
      ['unlock-function', registry('unlock')],
      [
        'external',
        '<AnimationSet version="4" id="Gone"><External id="B" type="action"/><Action id="A" clip="a.hkx"/></AnimationSet>',
      ],
    ]) {
      assert.throws(() => importWorkspaceXml(xml), /0\.12\.238/, name);
      assert.match(runtime('gone0238-' + name, xml, '--json').text, /"valid":false.*0\.12\.238/, name);
    }
    // A saved action: an unused lock window and its settings are dropped; one turned on cannot open.
    const w = importWorkspaceXml(HAND),
      old = structuredClone(w);
    Object.assign(old.actions[0].config, {lockMove: true, lockLook: false});
    old.actions[0].config.slots.lock = structuredClone(old.actions[0].config.slots.armor);
    assert.deepEqual(parseWorkspace(JSON.stringify(old)), w);
    old.actions[0].config.slots.lock.enabled = true;
    assert.throws(() => parseWorkspace(JSON.stringify(old)), /조작 잠금.*0\.12\.238/);
    // A saved pair: an unused lock track (and the move/look every track carried) is dropped; one on cannot open.
    const p = emptyWorkspace(),
      pair = addAction(p, 'pair');
    p.actions.push(pair);
    const saved = structuredClone(p),
      timeline = saved.actions[0].pair.timeline;
    timeline.lock = {...structuredClone(timeline.rotate), role: 'player'};
    for (const track of Object.values(timeline)) Object.assign(track, {move: true, look: false});
    assert.deepEqual(parseWorkspace(JSON.stringify(saved)), parseWorkspace(JSON.stringify(p)));
    timeline.lock.enabled = true;
    assert.throws(() => parseWorkspace(JSON.stringify(saved)), /조작 잠금.*0\.12\.238/);
    // A saved lock function in the registry cannot open.
    const shake = importWorkspaceXml(
      registry('shake').replace('</AnimationSet>', '<Action id="A" clip="a.hkx"/></AnimationSet>')
    );
    const locked = JSON.stringify(shake).replace('"op":"shake"', '"op":"lock"');
    assert.notEqual(locked, JSON.stringify(shake));
    assert.throws(() => parseWorkspace(locked), /lock.*0\.12\.238/);
  }
);

test('QTE keys and pad buttons by name; defaults left out', needsChecker, () => {
  const xml = `<AnimationSet version="4" id="Qte"><Action id="A" clip="a.hkx"><Start key="G"/>
    <QTE id="Q" at="0.5" key="" gamepad="X"/>
    <QTE id="S" at="0.6" type="keySequence"><Input gamepad="Y"/><Input gamepad="A"/><Input gamepad="code:300"/><Input gamepad="B"/></QTE>
  </Action></AnimationSet>`;
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
