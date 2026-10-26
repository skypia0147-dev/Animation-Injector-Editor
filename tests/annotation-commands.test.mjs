import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseCommand, commandSummary} from '../src/annotationCommands.ts';
import {sentEvent} from '../src/graph/annotations.ts';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {add, rows, remove} from '../src/timeline/model.ts';
import {hkxMoments, clipToEvent, slotToEvent, costToEvent} from '../src/graph/hkxMoments.ts';
import {setFunctions, readDo, nodeValues} from '../src/eventRegistry.ts';
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
    /<Do at="0.4" op="shake" strength="1.5"\/>\s*<Do at="0.4" op="spell" plugin="My.esp" form="801"\/>/
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
  assert.doesNotMatch(compileWorkspace(w), /<Do /);
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
test('a clip-time moment becomes an event: the registry gets what it acts with, this node its numbers (0.12.281)', () => {
  let w = pairWorkspace();
  w = add(w, w.actions[0].uid, 'hide', 0.4).workspace;
  const effect = w.actions[0].pair.effects.at(-1);
  effect.values.target = 'receiver';
  w = clipToEvent(w, w.actions[0].uid, effect.id, 'Grapple_Stom');
  assert.equal(w.actions[0].pair.effects.length, 0);
  const row = () => w.eventRegistry.find(r => r.name === 'Grapple_Stom');
  assert.deepEqual(
    row().functions.map(f => f.values),
    [{op: 'spell', plugin: 'FH_Grapple.esp', form: '808'}, {op: 'hide'}],
    'an event function changes its sender: no time, no role'
  );
  w = add(w, w.actions[0].uid, 'shake', 0.6).workspace;
  const shake = w.actions[0].pair.effects.at(-1);
  shake.values.strength = '1.5';
  shake.values.delay = '0.2';
  w = clipToEvent(w, w.actions[0].uid, shake.id, 'Grapple_Stom');
  const fn = row().functions.at(-1);
  assert.deepEqual(fn.values, {op: 'shake'}, 'the registry holds no numbers');
  assert.deepEqual(nodeValues(w.actions[0], row(), fn), {op: 'shake', strength: '1.5', delay: '0.2'});
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
  assert.match(
    compileWorkspace(w),
    /<EventValues>\s*<Event name="Grapple_Stom">\s*<Do op="shake" strength="1.5" delay="0.2"\/>\s*<\/Event>\s*<\/EventValues>/
  );
});
test('a window and a cost move between the clip and the registry; on and off are one item (docs/mockup-moment-timing)', () => {
  let w = emptyWorkspace();
  const a = addAction(w);
  w.actions.push(a);
  a.config.steps[0].clip = 'Animations\T\dodge.hkx';
  a.config.slots.iframe = {
    enabled: true,
    from: {basis: 'seconds', seconds: 0.1, event: '', fallback: false, fallbackBasis: 'seconds'},
    until: {basis: 'seconds', seconds: 0.8, event: '', fallback: false, fallbackBasis: 'seconds'},
  };
  a.config.cost = {...a.config.cost, enabled: true, stamina: 20};
  const sent = [
    {time: 0.2, text: 'DodgeOn'},
    {time: 0.7, text: 'DodgeOff'},
  ];
  // The window becomes the registry's on function; its off one is registered on another event.
  w = slotToEvent(w, a.uid, 'iframe', 'DodgeOn');
  assert.equal(w.actions[0].config.slots.iframe.enabled, false);
  let [item] = hkxMoments(w, w.actions[0], sent).registry;
  assert.deepEqual([item.event, item.fn.values.op, item.off], ['DodgeOn', 'iframeOn', null]);
  w = setFunctions(w, 'DodgeOff', [{id: 'fn1', values: {op: 'iframeOff'}}]);
  const moments = hkxMoments(w, w.actions[0], sent).registry;
  assert.equal(moments.length, 1, 'the off function shows inside its on one');
  item = moments[0];
  assert.deepEqual([item.off.event, item.off.fn.values.op], ['DodgeOff', 'iframeOff']);
  // The cost's amounts stay this node's numbers (runtime 0.12.281).
  w = costToEvent(w, a.uid, 'DodgeOn');
  const cost = hkxMoments(w, w.actions[0], sent).registry.find(r => r.fn.values.op === 'cost');
  assert.deepEqual(cost.fn.values, {op: 'cost'});
  const row = w.eventRegistry.find(r => r.name === 'DodgeOn');
  assert.deepEqual(nodeValues(w.actions[0], row, cost.fn), {op: 'cost', stamina: '20', magicka: '0'});
  assert.equal(w.actions[0].config.cost.enabled, false);
  assert.equal(validateWorkspace(w).filter(i => i.level === 'error').length, 0);
});
test('the clip bar drags like the timeline: the moment, an end, or the whole window within the clip', async () => {
  const {rulerGrab, rulerDrag} = await import('../src/graph/hkxMoments.ts');
  // A press near an end holds it; inside the window holds all of it; outside moves the nearer end there.
  assert.equal(rulerGrab(0.5, undefined, 0.05), 'at');
  assert.equal(rulerGrab(0.12, [0.1, 0.8], 0.05), 'from');
  assert.equal(rulerGrab(0.78, [0.1, 0.8], 0.05), 'until');
  assert.equal(rulerGrab(0.4, [0.1, 0.8], 0.05), 'move');
  assert.equal(rulerGrab(1.2, [0.1, 0.8], 0.05), 'until');
  const origin = {t: 0.4, at: 0.5, from: 0.1, until: 0.8};
  assert.deepEqual(rulerDrag('at', origin, 1.234, 2), {at: 1.23, from: 0.1, until: 0.8});
  assert.deepEqual(
    rulerDrag('from', origin, 0.95, 2),
    {at: 0.5, from: 0.8, until: 0.8},
    'a start never passes the end'
  );
  assert.deepEqual(rulerDrag('until', origin, 1.5, 2), {at: 0.5, from: 0.1, until: 1.5});
  assert.deepEqual(rulerDrag('move', origin, 0.7, 2), {at: 0.5, from: 0.4, until: 1.1}, 'moved whole, same length');
  assert.deepEqual(rulerDrag('move', origin, 3, 2), {at: 0.5, from: 1.3, until: 2}, 'stops at the clip end');
  assert.deepEqual(rulerDrag('move', origin, -1, 2), {at: 0.5, from: 0, until: 0.7}, 'stops at the clip start');
});
test('the item a clip/event switch makes opens: its key is the one the card lists it under', async () => {
  const {switchTo, openedBySwitch} = await import('../src/graph/momentOpen.ts');
  let w = pairWorkspace();
  const uid = w.actions[0].uid,
    sent = [
      {time: 0.87, text: 'Grapple_Stom'},
      {time: 1.5, text: 'Grapple_Land'},
    ];
  w = add(w, uid, 'hide', 0.4).workspace;
  const effect = w.actions[0].pair.effects.at(-1);
  // Clip -> event: the registered row of that event and function.
  w = switchTo(uid, {event: 'Grapple_Stom'})(clipToEvent(w, uid, effect.id, 'Grapple_Stom'));
  const row = hkxMoments(w, w.actions[0], sent).registry.find(r => r.fn.values.op === 'hide');
  assert.ok(openedBySwitch(`${uid}|${row.key}`));
});
test('the card lists items by when they happen: whole play and start blend, moments by trigger time, end blend', async () => {
  const {itemPlace, byPlace, markTime} = await import('../src/graph/momentOrder.ts');
  const w = emptyWorkspace();
  const a = addAction(w);
  w.actions.push(a);
  a.config.slots.iframe = {
    enabled: true,
    from: {basis: 'seconds', seconds: 0.3, event: '', fallback: false, fallbackBasis: 'seconds'},
    until: {basis: 'seconds', seconds: 0.8, event: '', fallback: false, fallbackBasis: 'seconds'},
  };
  a.config.cost = {...a.config.cost, enabled: true, at: {...a.config.cost.at, seconds: 0.1}};
  a.config.recovery = {
    enabled: true,
    at: {basis: 'event', seconds: 0.9, event: 'Ready', fallback: true, fallbackBasis: 'seconds'},
    blend: 0.2,
  };
  const times = new Map([['ready', 0.5]]);
  const place = (n, blend) => itemPlace(w, a, n, blend, times, 2);
  // A registered function stands at its event's time like a clip-time one.
  const list = byPlace([
    {key: 'end blend', place: place({kind: 'blend'}, 'exit')},
    {key: 'recovery (event at 0.5)', place: place({kind: 'notify', notify: 'recovery'})},
    {key: 'iframe 0.3', place: place({kind: 'notify', notify: 'iframe'})},
    {key: 'start limit', place: place({kind: 'stateCondition'})},
    {key: 'registered at 0.2', place: {group: 1, t: 0.2}},
    {key: 'cost 0.1', place: place({kind: 'notify', notify: 'cost'})},
    {key: 'start blend', place: place({kind: 'blend'}, 'enter')},
    {key: 'unknown time', place: {group: 1, t: Infinity}},
  ]);
  assert.deepEqual(
    list.map(e => e.key),
    [
      'start limit',
      'start blend',
      'cost 0.1',
      'registered at 0.2',
      'iframe 0.3',
      'recovery (event at 0.5)',
      'unknown time',
      'end blend',
    ]
  );
  // An event that is not in the clip has no time (it waits for its event only); before the end needs the clip's length.
  assert.equal(markTime({basis: 'event', event: 'Other', seconds: 0.7, fallback: false}, times), Infinity);
  assert.equal(markTime({basis: 'end', seconds: 0.5}, times, 2), 1.5);
  assert.equal(markTime({basis: 'end', seconds: 0.5}, times), Infinity);
});
