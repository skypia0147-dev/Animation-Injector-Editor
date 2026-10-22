import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseCommand, commandSummary} from '../src/annotationCommands.ts';
import {sentEvent} from '../src/graph/annotations.ts';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {add, rows, remove} from '../src/timeline/model.ts';
import {hkxMoments, clipToEvent, eventToClip, moveFunction} from '../src/graph/hkxMoments.ts';
import {setFunctions, readDo} from '../src/eventRegistry.ts';
import {parseXml} from '../src/xml.ts';
import {checker, needsChecker} from './local.mjs';

const folder = 'tests/generated/annotation-commands';
fs.mkdirSync(folder, {recursive: true});

test('AI.CamShake parses like the runtime: every number written (0.12.275)', () => {
  assert.deepEqual(parseCommand('CamShake|1.5|0.5'), {command: 'CamShake', strength: 1.5, duration: 0.5});
  assert.deepEqual(parseCommand('camshake|2|1'), {command: 'CamShake', strength: 2, duration: 1});
  assert.ok(parseCommand('CamShake|0|0') && parseCommand('CamShake|10|30'));
  for (const bad of [
    '',
    'CamShake',
    'CamShake|',
    'CamShake|1|',
    'CamShake||1',
    'CamShake|1|1|1',
    'CamShake|x',
    'CamShake|1x',
    'CamShake|-1',
    'CamShake|11',
    'CamShake|1|31',
    'CamShake|+1',
    '@CamShake|1',
    'Shake|1|1',
    ' CamShake|1',
    'CamShake|1.5',
  ])
    assert.equal(parseCommand(bad), undefined, bad);
  assert.match(commandSummary('CamShake|1.5|0.5'), /1\.5/);
});

test('an "AI." annotation is a command, in a pair clip too; "name|value" is not a registered name', () => {
  assert.deepEqual(sentEvent('AI.CamShake|1.5|0.5', false), {
    name: 'AI',
    values: 'CamShake|1.5|0.5',
    role: undefined,
    command: true,
  });
  assert.equal(sentEvent('2_AI.CamShake|1', true).role, 'receiver');
  assert.equal(sentEvent('2_AI.CamShake|1', true).command, true);
  assert.equal(sentEvent('Grapple_CamShake|1.5|0.5', false).command, undefined);
});

test('an ordinary action keeps clip-time functions on its own actor (runtime 0.12.274)', needsChecker, () => {
  let w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  const a = w.actions[0];
  a.config.steps[0].clip = 'Animations\\Mod\\Slam.hkx';
  let r = add(w, a.uid, 'shake', 0.4);
  w = r.workspace;
  const shake = r.id;
  w = add(w, a.uid, 'spell', 0.4).workspace;
  const effects = w.actions[0].config.effects;
  assert.deepEqual(
    effects.map(e => e.values),
    [
      {op: 'shake', at: '0.4'},
      {op: 'spell', at: '0.4'},
    ]
  );
  effects[1].values.plugin = 'My.esp';
  effects[1].values.form = '801';
  effects[0].values.strength = '1.5';
  assert.ok(rows(w, w.actions[0]).some(row => row.id === shake && row.kind === 'shake'));
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).actions[0].config.effects, effects);
  const xml = compileWorkspace(w);
  assert.match(
    xml,
    /<Effects>\s*<Do at="0.4" op="shake" strength="1.5"\/>\s*<Do at="0.4" op="spell" plugin="My.esp" form="801"\/>/
  );
  fs.writeFileSync(folder + '/ordinary.xml', xml);
  const check = spawnSync(checker, [folder + '/ordinary.xml'], {encoding: 'utf8'});
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.deepEqual(
    importWorkspaceXml(xml).actions[0].config.effects.map(e => e.values),
    effects.map(e => e.values)
  );
  // Not an ordinary action's: a target, or a function its own slots or a pair hold.
  const bad = structuredClone(w);
  bad.actions[0].config.effects[0].values.target = 'player';
  bad.actions[0].config.effects[1].values.op = 'cancel';
  assert.equal(validateWorkspace(bad).filter(i => i.level === 'error').length, 2);
  // Removing the last one leaves no list.
  w = remove(remove(w, a.uid, 'effect:' + effects[0].id), a.uid, 'effect:' + effects[1].id);
  assert.equal(w.actions[0].config.effects, undefined);
  assert.doesNotMatch(compileWorkspace(w), /<Effects/);
});

const pairWorkspace = () => {
  let w = emptyWorkspace();
  w.actions.push(addAction(w, 'pair'));
  w.actions[0].config.steps[0].clip = 'Animations\\Mod\\Slam.hkx';
  w = setFunctions(w, 'Grapple_Stom', [{id: 'fn1', values: {op: 'spell', plugin: 'FH_Grapple.esp', form: '808'}}]);
  return w;
};
test('an HKX card lists the registered functions its clip sends and its AI. commands (10-23)', () => {
  const w = pairWorkspace();
  const moments = hkxMoments(w, w.actions[0], [
    {time: 0.87, text: 'Grapple_Stom'},
    {time: 4, text: 'NPCAI.CamShake|1.5|0.5'},
    {time: 4, text: '2_AI.CamShake|1.5|0.5'},
    {time: 7, text: 'AI.CamShake|1|0.5'},
    {time: 9, text: 'AI.CamShake|2'},
    {time: 9.5, text: 'Unregistered'},
  ]);
  assert.deepEqual(
    moments.registry.map(r => [r.event, r.fn.values.op, r.sent.times]),
    [['Grapple_Stom', 'spell', [0.87]]]
  );
  const [shake] = moments.commands;
  assert.deepEqual(
    shake.rows.map(r => [r.time, [...r.roles].sort(), r.strength, r.duration]),
    [
      [4, ['initiator', 'receiver'], 1.5, 0.5],
      [7, [], 1, 0.5],
    ],
    'the two roles of one moment are one row'
  );
  assert.deepEqual(shake.bad, [{time: 9, text: 'AI.CamShake|2'}], 'a missing number is shown as not run');
  assert.deepEqual(hkxMoments(w, w.actions[0], undefined), {registry: [], commands: [], read: false});
});
test('a moment moves between a clip time and an event, and between events', () => {
  let w = pairWorkspace();
  w = add(w, w.actions[0].uid, 'hide', 0.4).workspace;
  const effect = w.actions[0].pair.effects.at(-1);
  effect.values.target = 'receiver';
  w = clipToEvent(w, w.actions[0].uid, effect.id, 'Grapple_Stom');
  assert.equal(w.actions[0].pair.effects.length, 0);
  const fns = w.eventRegistry.find(r => r.name === 'Grapple_Stom').functions;
  assert.deepEqual(
    fns.map(f => f.values),
    [{op: 'spell', plugin: 'FH_Grapple.esp', form: '808'}, {op: 'hide'}],
    'an event function changes its sender: no time, no role'
  );
  w = moveFunction(w, 'Grapple_Stom', fns[1].id, 'Grapple_Land');
  assert.deepEqual(
    w.eventRegistry.find(r => r.name === 'Grapple_Land').functions.map(f => f.values),
    [{op: 'hide'}]
  );
  const moved = w.eventRegistry.find(r => r.name === 'Grapple_Land').functions[0];
  w = eventToClip(w, w.actions[0].uid, 'Grapple_Land', moved.id, 1.25);
  assert.deepEqual(w.eventRegistry.find(r => r.name === 'Grapple_Land').functions, []);
  assert.deepEqual(
    w.actions[0].pair.effects.map(e => e.values),
    [{op: 'hide', at: '1.25'}]
  );
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
});
test('a pair clip-time effect names a role and no sender filter (runtime 0.12.275)', needsChecker, () => {
  // An older project: target and from as they were.
  const w = pairWorkspace();
  w.actions[0].pair.effectsEnabled = true;
  w.actions[0].pair.effects = [
    {id: 'e1', values: {op: 'hide', at: '0.1', target: 'sender', from: 'receiver'}},
    {id: 'e2', values: {op: 'shake', at: '0.2', target: 'initiator', from: 'initiator'}},
    {
      id: 'e3',
      values: {op: 'spell', at: '0.3', target: 'partner', from: 'any', plugin: 'a.esp', form: '1', space: 'back'},
    },
  ];
  const opened = parseWorkspace(JSON.stringify(w));
  assert.deepEqual(
    opened.actions[0].pair.effects.map(e => e.values),
    [
      {op: 'hide', at: '0.1', target: 'receiver'},
      {op: 'shake', at: '0.2'},
      {op: 'spell', at: '0.3', plugin: 'a.esp', form: '1'},
    ],
    'the role reached; a player-only function and both name none; the space condition is dropped'
  );
  const xml = compileWorkspace(opened);
  assert.doesNotMatch(xml, / from="| space=/);
  fs.writeFileSync(folder + '/pair-roles.xml', xml);
  const check = spawnSync(checker, [folder + '/pair-roles.xml'], {encoding: 'utf8'});
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // An older file reads the same way.
  assert.deepEqual(readDo(parseXml('<Do at="0.5" op="hide" target="partner" from="initiator"/>'), true), {
    at: '0.5',
    op: 'hide',
    target: 'receiver',
  });
});
