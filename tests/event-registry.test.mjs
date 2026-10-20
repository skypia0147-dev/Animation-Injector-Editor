import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {mark} from '../src/model.ts';
import {
  doAttrs,
  functionSummary,
  registryEntries,
  eventUses,
  renameEvent,
  bindSlot,
  eventSlots,
  removeEventRow,
  addEventRow,
  addFunction,
  vanillaName,
} from '../src/eventRegistry.ts';
import {checker, needsChecker} from './local.mjs';

const folder = 'tests/generated/event-registry';
fs.mkdirSync(folder, {recursive: true});
const runtime = file => {
  const r = spawnSync(checker, [file], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
const eventMark = (event, seconds = 0) => ({...mark(seconds), basis: 'event', event});

test('an older project moves its event functions into the registry once, renaming role/source', needsChecker, () => {
  const w = emptyWorkspace();
  const pair = addAction(w, 'pair');
  w.actions.push(pair);
  const one = addAction(w, 'single');
  w.actions.push(one);
  pair.pair.effectsEnabled = true;
  pair.pair.effects = [
    {id: 'a', values: {op: 'spell', name: 'Grapple_Stom', role: 'sender', plugin: 'FH_Grapple.esp', form: '80B'}},
    {id: 'b', values: {op: 'hide', name: 'grapple_stom', role: 'other', source: 'target'}},
    {id: 'c', values: {op: 'show', at: '0.75', role: 'both', source: 'both'}},
  ];
  pair.pair.timeline.iframe = {
    ...pair.pair.timeline.iframe,
    enabled: true,
    from: eventMark('GuardOn'),
    until: mark(0.9),
  };
  one.config.extraEvents = ['SoundPlay.X'];
  one.config.fireArrow = {at: eventMark('Shoot')};
  one.config.slots.armor = {enabled: true, from: eventMark('ArmorOn'), until: eventMark('ArmorOff')};
  one.config.cost = {enabled: true, at: eventMark('Pay'), stamina: 5, magicka: 0};
  const legacy = {...structuredClone(w), eventCatalog: ['Declared']};
  const opened = parseWorkspace(JSON.stringify(legacy));
  const rows = Object.fromEntries(opened.eventRegistry.map(r => [r.name, r.functions.map(f => f.values)]));
  assert.deepEqual(rows.Grapple_Stom, [
    {op: 'spell', target: 'sender', plugin: 'FH_Grapple.esp', form: '80B'},
    {op: 'hide', target: 'partner', from: 'receiver'},
  ]);
  assert.equal(rows.grapple_stom, undefined, 'one row per name, first spelling');
  assert.deepEqual(rows.GuardOn, [{op: 'iframeOn', target: 'initiator', from: 'initiator'}]);
  assert.deepEqual(rows['SoundPlay.X'], []);
  assert.deepEqual(rows.Shoot, [{op: 'fireArrow', from: 'player'}]);
  assert.deepEqual(rows.ArmorOn, [{op: 'armorOn'}]);
  assert.deepEqual(rows.ArmorOff, [{op: 'armorOff'}]);
  assert.deepEqual(rows.Pay, [{op: 'cost', stamina: '5', magicka: '0'}]);
  assert.deepEqual(rows.Declared, []);
  const p = opened.actions[0].pair;
  assert.deepEqual(
    p.effects.map(e => e.values),
    [
      {op: 'show', at: '0.75', target: 'both', from: 'any'},
      {op: 'iframeOff', target: 'initiator', from: 'initiator', at: '0.9'},
    ]
  );
  assert.equal(p.timeline.iframe.enabled, false);
  const a = opened.actions[1].config;
  assert.deepEqual(a.fireArrow, {at: null, onRelease: true});
  assert.equal(a.slots.armor.enabled, false);
  assert.equal(a.cost.enabled, false);
  assert.equal('extraEvents' in a, false);
  assert.equal(opened.eventCatalog, undefined);
  assert.deepEqual(parseWorkspace(JSON.stringify(opened)), opened, 'idempotent');
  assert.equal(validateWorkspace(opened).filter(i => i.level === 'error').length, 0);
  const file = folder + '/lifted.xml';
  fs.writeFileSync(file, compileWorkspace(opened));
  assert.match(runtime(file), /registered events/);
});

test('formats 2 and 3 are refused naming the converter; format 4 refuses the removed forms like the runtime', () => {
  for (const version of ['2', '3'])
    assert.throws(
      () =>
        importWorkspaceXml(`<AnimationSet version="${version}" id="Old"><Action id="A" clip="a.hkx"/></AnimationSet>`),
      /version="4"/
    );
  const v3 = body => `<AnimationSet version="4" id="New"><Action id="A" clip="a.hkx">${body}</Action></AnimationSet>`;
  for (const body of [
    '<Events extra="X"/>',
    '<FireArrow at="event:Fire"/>',
    '<IFrame from="event:On" until="end"/>',
    '<Cost at="event:Pay"/>',
  ])
    assert.throws(() => importWorkspaceXml(v3(body)), /형식 3/);
  assert.throws(() =>
    importWorkspaceXml(
      '<AnimationSet version="4" id="New"><Pair id="P" clip="p.hkx"><Effects><Effect at="1" op="hide"/></Effects></Pair></AnimationSet>'
    )
  );
  assert.throws(() =>
    importWorkspaceXml(
      '<AnimationSet version="4" id="Old"><EventRegistry><Event name="X"/></EventRegistry></AnimationSet>'
    )
  );
  assert.throws(
    () =>
      importWorkspaceXml(
        '<AnimationSet version="4" id="New"><EventRegistry><Event name="X"/><Event name="x"/></EventRegistry><Action id="A" clip="a.hkx"/></AnimationSet>'
      ),
    /두 번/
  );
});

test('summaries and XML leave defaults out; checks warn about game-wide names and lasting functions', () => {
  assert.deepEqual(doAttrs({op: 'hide', target: 'sender', from: 'any', plugin: 'x.esp'}), {op: 'hide'});
  assert.deepEqual(doAttrs({op: 'spell', target: 'both', plugin: 'a.esp', form: '1', stamina: '3'}), {
    op: 'spell',
    target: 'both',
    plugin: 'a.esp',
    form: '1',
  });
  assert.equal(functionSummary({op: 'hide'}), '무기 숨김');
  assert.equal(
    functionSummary({op: 'shake', target: 'player', from: 'player', parameters: 'true'}),
    '카메라 흔들림 · 플레이어 · 플레이어 이벤트만 · 값 전달'
  );
  assert.ok(vanillaName('weaponSwing') && vanillaName('SoundPlay.WPNBowFire') && !vanillaName('Grapple_unequip'));
  // "Name.payload" annotations of a vanilla event are the game's; Payload Interpreter commands are not.
  assert.ok(vanillaName('StartAnimatedCamera.Camera3rd [Cam3]') && !vanillaName('PIE.@SGVF'));
  let w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  w = addEventRow(w, 'weaponSwing');
  w = addFunction(w, 'weaponSwing', 'hide');
  const issues = validateWorkspace(w).filter(i => i.node === 'eventRegistry');
  assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('게임 전체')));
  assert.ok(issues.some(i => i.level === 'warning' && i.message.includes('짝 기능')));
  w = addFunction(w, 'Unequip', 'show');
  assert.ok(!validateWorkspace(w).some(i => i.message.includes('짝 기능')));
  w = addFunction(w, 'Shoot', 'fireArrow');
  w.eventRegistry.at(-1).functions[0].values.target = 'partner';
  assert.ok(validateWorkspace(w).some(i => i.level === 'error' && i.message.includes('활 발사')));
  w.eventRegistry.at(-1).functions[0].values.target = 'player';
  w = addFunction(w, 'Cast', 'stateOn');
  assert.ok(validateWorkspace(w).some(i => i.level === 'error' && i.message.includes('플러그인')));
  assert.throws(() => addEventRow(w, 'WEAPONSWING'), /이미/);
});

test('the registry lists registrations and referenced names; rename, bind and unbind follow every use', () => {
  let w = emptyWorkspace();
  const a = addAction(w, 'single');
  w.actions.push(a);
  a.nodeAuthored = true;
  a.clipWindows = {A1: {open: eventMark('MCO_WinOpen', 0.45), close: mark(0, 'end'), buffered: true}};
  a.config.start.mode = 'event';
  a.config.start.event = 'Start';
  w = addFunction(w, 'Swing', 'hide');
  const entries = registryEntries(w);
  assert.deepEqual(
    entries.map(e => [e.name, !!e.row, e.uses.length]),
    [
      ['Swing', true, 0],
      ['MCO_WinOpen', false, 1],
      ['Start', false, 1],
    ]
  );
  const openKey = eventUses(w).get('mco_winopen')[0].slot;
  assert.ok(openKey);
  // Unbinding returns the moment to its clip time; binding points it back at the event.
  let n = bindSlot(w, openKey, '');
  assert.equal(n.actions[0].clipWindows.A1.open.basis, 'seconds');
  assert.equal(n.actions[0].clipWindows.A1.open.seconds, 0.45);
  assert.ok(!registryEntries(n).some(e => e.name === 'MCO_WinOpen'));
  n = bindSlot(n, openKey, 'Swing');
  assert.equal(eventUses(n).get('swing').length, 1);
  // The clip time stays as the fallback.
  assert.deepEqual(
    (({basis, event, fallback, seconds}) => ({basis, event, fallback, seconds}))(n.actions[0].clipWindows.A1.open),
    {basis: 'event', event: 'Swing', fallback: true, seconds: 0.45}
  );
  assert.throws(() => removeEventRow(n, n.eventRegistry[0].id), /용도/);
  n = renameEvent(n, 'swing', 'Swing2');
  assert.equal(n.eventRegistry[0].name, 'Swing2');
  assert.equal(n.actions[0].clipWindows.A1.open.event, 'Swing2');
  assert.throws(() => renameEvent(n, 'Swing2', 'start'), /이미/);
  n = renameEvent(n, 'Start', 'Begin');
  assert.equal(n.actions[0].config.start.event, 'Begin');
  assert.ok(eventSlots(n).every(s => s.node));
  assert.equal(validateWorkspace(n).filter(i => i.level === 'error').length, 0);
});

test('HKX annotations: AMR data is not an event; a paired clip prefix names the sending actor', async () => {
  const {sentEvent} = await import('../src/graph/annotations.ts');
  assert.equal(sentEvent('animmotion 0 -1.474189 0', false), undefined);
  assert.equal(sentEvent('animrotation 0 0 0 1', true), undefined);
  assert.equal(sentEvent('2_animmotion 0 0 0', true), undefined);
  assert.deepEqual(sentEvent('NPCGrapple_unequip', true), {name: 'Grapple_unequip', values: '', role: 'initiator'});
  assert.deepEqual(sentEvent('2_Grapple_Stage_Start_10', true), {
    name: 'Grapple_Stage_Start_10',
    values: '',
    role: 'receiver',
  });
  assert.deepEqual(sentEvent('NPCGrapple_CamShake|1.5|0.5', true), {
    name: 'Grapple_CamShake',
    values: '1.5|0.5',
    role: 'initiator',
  });
  // Outside a pair the text is the name as it is.
  assert.deepEqual(sentEvent('NPCKillMoveStart', false), {name: 'NPCKillMoveStart', values: '', role: undefined});
});

test("an HKX card lists only its own action's uses of an event, by a short label, repeats merged", async () => {
  const {newQte} = await import('../src/qte.ts');
  const {ownUseLabels} = await import('../src/eventRegistry.ts');
  const w = emptyWorkspace();
  const a = addAction(w, 'single');
  w.actions.push(a);
  const b = addAction(w, 'single');
  w.actions.push(b);
  a.config.exit = eventMark('Hit', 1);
  a.config.recovery.enabled = true;
  a.config.recovery.at = eventMark('Hit', 0.8);
  b.config.exit = eventMark('Hit', 1);
  w.qtes = [a, a, b].map((owner, i) => ({
    ...newQte(w),
    id: 'QTE' + (i + 1),
    owner: owner.uid,
    step: owner.config.entry,
    at: eventMark('Hit', 0.5),
  }));
  w.qtes[0].results.success = {...w.qtes[0].results.success, mode: 'event', event: 'Hit'};
  const uses = eventUses(w).get('hit');
  assert.equal(uses.length, 7);
  assert.deepEqual(ownUseLabels(uses, a.uid, a.config.entry), [
    '종료 시점',
    '이동키 취소',
    'QTE 시작 ×2',
    'QTE 성공 시 보냄',
  ]);
  assert.deepEqual(ownUseLabels(uses, b.uid, b.config.entry), ['종료 시점', 'QTE 시작']);
  // A clip's card leaves out the uses tied to another clip of the same action.
  assert.deepEqual(ownUseLabels(uses, a.uid, 'other'), ['종료 시점', '이동키 취소']);
  // The registry keeps the full labels, naming the action.
  assert.ok(
    uses.every(u =>
      u.label.includes(u.owner === a.uid ? a.config.name || a.config.actionId : b.config.name || b.config.actionId)
    )
  );
});

test('the registry lists repeated uses once with a count; unbinding a group frees every slot in it', async () => {
  const {groupUses} = await import('../src/eventRegistry.ts');
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    const a = addAction(w, 'single');
    a.nodeAuthored = true;
    a.clipWindows = {A1: {open: eventMark('Open', 0.3), close: mark(0, 'end'), buffered: true}};
    w.actions.push(a);
  }
  const uses = eventUses(w).get('open');
  const groups = groupUses(uses);
  assert.equal(
    groups.reduce((n, g) => n + g.uses.length, 0),
    uses.length
  );
  // Same labels collapse: two uses that read alike become one line "×2".
  const twice = groupUses([uses[0], {...uses[0]}]);
  assert.deepEqual(
    twice.map(g => g.text),
    [uses[0].label + ' ×2']
  );
  const slots = uses.flatMap(u => (u.slot ? [u.slot] : []));
  w = slots.reduce((n, slot) => bindSlot(n, slot, ''), w);
  assert.equal(eventUses(w).get('open'), undefined);
});

test(
  'values: "name|value" spellings round-trip through the project, XML and the runtime checker',
  needsChecker,
  async () => {
    const {setEventValues, addEventValue, registryIssues, splitValues} = await import('../src/eventRegistry.ts');
    let w = emptyWorkspace();
    w.actions.push(addAction(w, 'single'));
    w = addFunction(w, 'Grapple_CamShake', 'shake');
    w = setEventValues(w, 'Grapple_CamShake', splitValues(' 1.5|0.5  3.0|1.0 1.5|0.5 '));
    w = addEventValue(w, 'Grapple_HealthDamage', '2|1');
    assert.deepEqual(
      w.eventRegistry.map(r => [r.name, r.values]),
      [
        ['Grapple_CamShake', ['1.5|0.5', '3.0|1.0']],
        ['Grapple_HealthDamage', ['2|1']],
      ]
    );
    assert.deepEqual(parseWorkspace(JSON.stringify(w)).eventRegistry, w.eventRegistry);
    assert.throws(() => setEventValues(w, 'X', ['@SGVF']), /값이 잘못/);
    assert.equal(registryIssues(w).filter(i => i.level === 'error').length, 0);
    const xml = compileWorkspace(w);
    assert.match(xml, /<Event name="Grapple_CamShake" values="1.5\|0.5 3.0\|1.0">/);
    assert.match(xml, /<Event name="Grapple_HealthDamage" values="2\|1"\/>/);
    fs.writeFileSync(folder + '/values.xml', xml);
    assert.match(runtime(folder + '/values.xml'), /2 registered events/);
    const back = importWorkspaceXml(xml);
    assert.deepEqual(
      back.eventRegistry.map(r => [r.name, r.values]),
      w.eventRegistry.map(r => [r.name, r.values])
    );
    fs.writeFileSync(folder + '/values-back.xml', compileWorkspace(back));
    const same = spawnSync(checker, ['--compare', folder + '/values.xml', folder + '/values-back.xml'], {
      encoding: 'utf8',
    });
    assert.equal(same.status, 0, same.stdout + same.stderr);
    // Clearing the field drops the attribute; a value twice is refused like the runtime.
    assert.equal(setEventValues(w, 'Grapple_HealthDamage', []).eventRegistry[1].values, undefined);
    assert.throws(
      () =>
        importWorkspaceXml(
          '<AnimationSet version="4" id="V"><EventRegistry><Event name="X" values="1|2 1|2"/></EventRegistry><Action id="A" clip="a.hkx"/></AnimationSet>'
        ),
      /두 번/
    );
  }
);
