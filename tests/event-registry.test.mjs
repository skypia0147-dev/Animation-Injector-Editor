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
import {newStart} from '../src/cards.ts';

const folder = 'tests/generated/event-registry';
fs.mkdirSync(folder, {recursive: true});
const runtime = file => {
  const r = spawnSync(checker, [file], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};
const eventMark = (event, seconds = 0) => ({...mark(seconds), basis: 'event', event});

test('summaries and XML leave defaults out; checks warn about game-wide names and lasting functions', () => {
  assert.deepEqual(doAttrs({op: 'hide', target: 'sender', from: 'any', plugin: 'x.esp'}), {op: 'hide'});
  assert.deepEqual(doAttrs({op: 'spell', target: 'both', plugin: 'a.esp', form: '1', stamina: '3'}), {
    op: 'spell',
    plugin: 'a.esp',
    form: '1',
  });
  assert.equal(functionSummary({op: 'hide'}), '무기 숨김');
  assert.equal(functionSummary({op: 'shake'}), '카메라 흔들림');
  // A set shake says its numbers (a card item would otherwise show none).
  assert.equal(functionSummary({op: 'shake', strength: '1.5'}), '카메라 흔들림 · 세기 1.5 · 0.5초');
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
  // A registered function holds no target (runtime 0.12.273).
  w.eventRegistry.at(-1).functions[0].values.target = 'partner';
  assert.ok(validateWorkspace(w).some(i => i.level === 'error' && /적용|등록 기능 속성/.test(i.message)));
  delete w.eventRegistry.at(-1).functions[0].values.target;
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
  w.starts.push({...newStart(w, {x: 0, y: 0}, 'event'), event: 'Start', to: {action: a.uid}});
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
  // The clip time is kept for a switch back; the event moment waits for its event only (runtime 0.12.278).
  assert.deepEqual(
    (({basis, event, fallback, seconds}) => ({basis, event, fallback, seconds}))(n.actions[0].clipWindows.A1.open),
    {basis: 'event', event: 'Swing', fallback: false, seconds: 0.45}
  );
  assert.throws(() => removeEventRow(n, n.eventRegistry[0].id), /용도/);
  n = renameEvent(n, 'swing', 'Swing2');
  assert.equal(n.eventRegistry[0].name, 'Swing2');
  assert.equal(n.actions[0].clipWindows.A1.open.event, 'Swing2');
  assert.throws(() => renameEvent(n, 'Swing2', 'start'), /이미/);
  n = renameEvent(n, 'Start', 'Begin');
  assert.equal(n.starts[0].event, 'Begin');
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

test('a registry line shortens its uses: no own name, repeats counted, a kind at several places as a count', async () => {
  const {shortUses} = await import('../src/eventRegistry.ts');
  const use = label => ({name: 'X', label, node: 'n'});
  assert.deepEqual(shortUses('Air_ContactBack', [use('시작 트리거 · Air_ContactBack')]), ['시작 트리거']);
  assert.deepEqual(shortUses('S', [use('QTE 시작 · Pounding'), use('QTE 시작 · Pounding')]), [
    'QTE 시작 · Pounding ×2',
  ]);
  assert.deepEqual(
    shortUses('C', [
      use('카메라 복구 · Front'),
      use('카메라 복구 · Rear'),
      use('카메라 복구 · Rear'),
      use('QTE 중지 · P'),
    ]),
    ['카메라 복구 · 3곳', 'QTE 중지 · P']
  );
});
