import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, validateWorkspace, putAction} from '../src/workspace.ts';
import {checklistModel, checklistProjection, transferItem} from '../src/graph/checklist.ts';
import {connectPin} from '../src/graph/pinTargets.ts';
import {
  linkBlend,
  patchLink,
  patchStart,
  setLinkKey,
  setLinkMode,
  setLinkWindowScope,
  startDefaults,
  startMode,
} from '../src/graph/cardEdits.ts';
import {playbackState, resetAttack, resetDetection, resetExit} from '../src/graph/playbackSettings.ts';
import {setActionView, setFirstPersonStart, projectView} from '../src/view.ts';
import {setSourceWindow} from '../src/graph/clipWindows.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {deleteFlat} from '../src/graph/flat.ts';
import {mark} from '../src/model.ts';
import {checker, needsChecker} from './local.mjs';

// The start, transition, QTE and HKX cards edited as their cards edit them (unify ⑧–⑪, 10-27), each edit's XML: the
// lines it should write (and no longer write), the same XML read back, and the runtime checker taking it. As
// tests/condition-drag-xml.test.mjs does for condition cards.
const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const DDS = 'DynamicDodgeShot.xml',
  CHAIN = 'current-xml/Chain.xml',
  GRAPPLE = 'current-xml/Grapple.xml',
  QTE = 'GrappleQte.xml';
const view = w => checklistProjection(w, checklistModel(w));
const hkx = (w, uid) => {
  const a = w.actions.find(a => a.uid === uid);
  return checklistModel(w).raw.nodes.find(n => n.kind === 'hkxPlay' && n.action === uid && n.step === a.config.entry)
    .id;
};
/** A route chosen from its list (the destination chip), or cleared ("연결 안 함"). */
const pin = (w, id, p, uid) => connectPin(w, view(w), id, p, uid ? hkx(w, uid) : '');
const item = (w, uid, test) => checklistModel(w).items.get(hkx(w, uid)).find(test);
const withoutItem = (w, uid, test) => deleteFlat(w, item(w, uid, test).node.id);
const setExit = (w, exit) =>
  putAction(w, {...w.actions[0], config: {...w.actions[0].config, exit: {...w.actions[0].config.exit, ...exit}}});
// Chain's Attack1 as the editor makes one (node authored): its key transitions read its detection window.
const ownDetection = w =>
  putAction(
    w,
    setSourceWindow({...w.actions[0], nodeAuthored: true}, w.actions[0].config.entry, {
      open: mark(0.3),
      close: mark(0, 'end'),
      buffered: true,
    })
  );
const START = '<Start id="BowDodge" ';

// [name, fixture, edit, lines written, lines no longer written, the XML unchanged]
const scenarios = [
  // ── 시작 카드 (⑨) ──
  ['S1 키', DDS, w => patchStart(w, 'start1', {key: 'Num7'}), [START + 'key="Num7" cooldown="0.2"'], ['key="Mouse2"']],
  ['S2 뗄 때', DDS, w => patchStart(w, 'start1', {onKeyUp: true}), [START + 'key="Mouse2" onKeyUp="true"'], []],
  [
    'S3 이벤트로 · 보낸 쪽',
    DDS,
    w =>
      patchStart(patchStart(w, 'start1', startMode(w.starts[0], 'event')), 'start1', {
        event: 'MyEvent',
        actor: 'player',
      }),
    [START + 'event="MyEvent" actor="player" cooldown="0.2"'],
    ['key="Mouse2"'],
  ],
  [
    'S4 쿨다운 기본값으로',
    DDS,
    w => patchStart(w, 'start1', startDefaults.cooldown),
    [START + 'key="Mouse2" block='],
    ['cooldown="0.2"'],
  ],
  ['S5 쿨다운 0.5', DDS, w => patchStart(w, 'start1', {cooldown: 0.5}), ['cooldown="0.5"'], ['cooldown="0.2"']],
  [
    'S6 바닐라 차단 기본값으로',
    DDS,
    w => patchStart(w, 'start1', startDefaults.block),
    [START + 'key="Mouse2" cooldown="0.2">'],
    ['block='],
  ],
  [
    'S7 바닐라 차단 · 차단 시점',
    DDS,
    w => patchStart(w, 'start1', {block: {events: ['blockStart'], when: 'active'}}),
    ['block="blockStart" blockWhen="active"'],
    ['bashStart'],
  ],
  [
    'S8 대상 전투 대상',
    DDS,
    w => patchStart(w, 'start1', {target: 'combatTarget'}),
    [START + 'key="Mouse2" target="combatTarget"'],
    [],
  ],
  ['S9 대상 거리 · 각도', DDS, w => patchStart(w, 'start1', {range: 300, angle: 120}), ['range="300" angle="120"'], []],
  [
    'S10 대상 기본값으로',
    DDS,
    w => patchStart(patchStart(w, 'start1', {target: 'combatTarget', range: 300}), 'start1', startDefaults.target),
    [],
    ['target=', 'range='],
    true,
  ],
  [
    'S11 도착 칩으로 HKX',
    DDS,
    w => pin(w, 'startCard:start1', 'trigger', 'a2'),
    [START + 'to="BowDodge_L1" key="Mouse2" cooldown="0.2" block="blockStart,bashStart"/>'],
    ['<Check kind="sneaking"/>'],
  ],
  [
    'P1 페어 상대 기본값으로',
    GRAPPLE,
    w => patchStart(w, 'start1', startDefaults.partner),
    ['<Start to="GrappleFront" event="Grapple_ContactFront" cooldown="0.2"/>'],
    [],
  ],
  [
    'P2 보낸 쪽 NPC',
    GRAPPLE,
    w => patchStart(w, 'start1', {actor: 'npc'}),
    ['event="Grapple_ContactFront" actor="npc"'],
    [],
  ],
  // ── 전환 카드 (⑨) ──
  [
    'T1 키',
    CHAIN,
    w => setLinkKey(w, 'link1', 'J', 0),
    ['<Transition to="Attack2" key="J" from="0.45" blend="0.1"/>'],
    [],
  ],
  [
    'T2 이벤트로',
    CHAIN,
    w => patchLink(setLinkMode(w, 'link1', 'event'), 'link1', {event: 'Combo_Go'}),
    ['<Transition to="Attack2" event="Combo_Go" from="0.45" blend="0.1"/>'],
    ['<Transition to="Attack2" key="Num6"'],
  ],
  [
    'T3 블렌드 기본값으로',
    CHAIN,
    w => patchLink(w, 'link1', linkBlend.reset),
    ['<Transition to="Attack2" key="Num6" from="0.45"/>'],
    [],
  ],
  [
    'T4 블렌드 추가',
    CHAIN,
    w => patchLink(patchLink(w, 'link1', linkBlend.reset), 'link1', linkBlend.add),
    ['<Transition to="Attack2" key="Num6" from="0.45" blend="0.3"/>'],
    [],
  ],
  [
    'T5 감지 구간 끔',
    CHAIN,
    w => patchLink(w, 'link1', {window: false}),
    ['<Transition to="Attack2" key="Num6" blend="0.1"/>'],
    [],
  ],
  ['T6 감지 구간 이 전환만', CHAIN, w => setLinkWindowScope(w, 'link1', true), [], [], true],
  [
    'T7 도착 칩으로 다른 HKX',
    CHAIN,
    w => pin(w, 'transition:link1', 'trigger', 'a3'),
    ['<Transition to="Attack3" key="Num6" from="0.45" blend="0.1"/><Transition to="Attack3" key="H"'],
    ['<Transition to="Attack2"'],
  ],
  [
    'T8 페어 전환 피해자',
    GRAPPLE,
    w => pin(w, 'transition:link1', 'partner', 'a6'),
    ['<Transition to="GrappleStage01Attacker" partnerTo="GrappleStage02Target" event="Grapple_QTE_Stage01"/>'],
    [],
  ],
  // ── QTE 결과 (⑧) ──
  [
    'Q1 성공 피해자 비우기',
    QTE,
    w => pin(w, 'qte:QTE4', 'choice:success:partner', ''),
    ['<Success to="GrappleStage10Attacker" soundPlugin'],
    ['partnerTo="GrappleStage10Target"'],
  ],
  [
    'Q2 성공 가해자 다른 HKX',
    QTE,
    w => pin(w, 'qte:QTE4', 'pass', 'a3'),
    ['<Success to="GrappleStage02Attacker" partnerTo="GrappleStage10Target"'],
    ['<Success to="GrappleStage10Attacker"'],
  ],
  ['Q3 성공 비우기(계속)', QTE, w => pin(w, 'qte:QTE4', 'pass', ''), [], ['to="GrappleStage10Attacker"']],
  [
    'Q4 실패에 HKX',
    QTE,
    w => pin(w, 'qte:QTE4', 'fail', 'a1'),
    ['<Failure to="GrappleStage01Attacker" soundPlugin="FH_Grapple.esp" soundForm="819"/>'],
    [],
  ],
  // ── HKX 카드 재생 설정 (⑩) ──
  [
    'H1 1인칭에서 기본값으로',
    DDS,
    w => setFirstPersonStart(w, 'a1', 'block'),
    ['<Action id="BowDodge_B1" clip="Animations\\DynamicDodgeShot\\BowDodgeBack.hkx">'],
    [],
  ],
  [
    'H2 공격 데이터 기본값으로',
    CHAIN,
    w => resetAttack(w, 'a1'),
    ['<Action id="Attack1" clip="Animations\\ComboTest\\test_Attack1.hkx" enter="0.1">'],
    [],
  ],
  [
    'H3 블렌드(시작) 지움',
    CHAIN,
    w => withoutItem(w, 'a1', i => i.blend === 'enter'),
    ['<Action id="Attack1" clip="Animations\\ComboTest\\test_Attack1.hkx" attack="attackStart">'],
    [],
  ],
  [
    'H4 블렌드(시작) ＋ 설정',
    CHAIN,
    w => {
      const bare = withoutItem(w, 'a1', i => i.blend === 'enter'),
        option = contextualAdds(bare, hkx(bare, 'a1'), checklistModel(bare).raw).find(
          o => o.kind === 'blend' && o.before
        );
      return addConnected(bare, hkx(bare, 'a1'), option, {x: 0, y: 0}).workspace;
    },
    ['<Action id="Attack1" clip="Animations\\ComboTest\\test_Attack1.hkx" attack="attackStart" enter="0.3">'],
    [],
  ],
  ['H5 종료 끝 - 0.3', CHAIN, w => setExit(w, {seconds: 0.3}), ['enter="0.1"><Exit at="end-0.3" blend="0.2"/>'], []],
  [
    'H6 종료 이벤트',
    CHAIN,
    w => setExit(w, {basis: 'event', event: 'Attack1_Done'}),
    ['<Exit at="event:Attack1_Done" blend="0.2"/>'],
    [],
  ],
  ['H7 종료 기본값으로', CHAIN, w => resetExit(setExit(w, {seconds: 0.3}), 'a1'), [], ['end-0.3'], true],
  [
    'H8 인칭 1인칭',
    CHAIN,
    w => setActionView(w, 'a1', 'first'),
    ['attack="attackStart" enter="0.1" view="first">'],
    [],
  ],
  [
    'H9 인칭 기본값으로',
    CHAIN,
    w => setActionView(setActionView(w, 'a1', 'first'), 'a1', projectView(w)),
    [],
    ['view='],
    true,
  ],
  [
    'H10 입력 감지',
    CHAIN,
    ownDetection,
    [
      '<Transition to="Attack2" key="Num6" from="0.3" blend="0.1"/>',
      '<Transition to="Attack3" key="H" from="0.3" blend="0.1"/>',
    ],
    [],
  ],
  [
    'H11 입력 감지 기본값으로',
    CHAIN,
    w => resetDetection(ownDetection(w), 'a1', w.actions[0].config.entry),
    [],
    ['from="0.3"'],
    true,
  ],
  // ── HKX 기능 끌기 (⑪) ──
  [
    'F1 기능 옮기기 (페어로)',
    GRAPPLE,
    w => transferItem(w, item(w, 'a3', i => i.node.notify === 'armor').node.id, 'a1', false),
    ['<Do at="0" op="armorOn" target="initiator"/><Do at="0.5" op="armorOff" target="initiator"/>'],
    [],
  ],
  [
    'F2 기능 Ctrl 복사',
    GRAPPLE,
    w => transferItem(w, item(w, 'a3', i => i.node.notify === 'armor').node.id, 'a1', true),
    ['<Do at="0" op="armorOn" target="initiator"/><Do at="0.5" op="armorOff" target="initiator"/>'],
    [],
  ],
  [
    'F3 지운 기능을 다른 카드에서 복사',
    CHAIN,
    w => {
      const bare = withoutItem(w, 'a2', i => i.node.notify === 'recovery');
      return transferItem(bare, item(bare, 'a1', i => i.node.notify === 'recovery').node.id, 'a2', true);
    },
    [],
    [],
    true,
  ],
];

const flat = xml => xml.replace(/<!-- AnimationInjectorEditor [\s\S]*?-->/, '').replace(/\s*\n\s*/g, '');
const section = (xml, id) => {
  const f = flat(xml),
    at = f.search(new RegExp(`<(Action|Pair) id="${id}"`));
  return f.slice(at, f.indexOf(f[at + 1] === 'P' ? '</Pair>' : '</Action>', at));
};
const out = fileURLToPath(new URL('./generated/card-xml/', import.meta.url));
mkdirSync(out, {recursive: true});
const written = [];
for (const [name, file, edit, want, absent, same = false] of scenarios)
  test('card XML: ' + name, () => {
    const base = compileWorkspace(importWorkspaceXml(fixture(file)));
    const w = edit(importWorkspaceXml(fixture(file)));
    assert.deepEqual(
      validateWorkspace(w)
        .filter(i => i.level === 'error')
        .map(i => i.message),
      []
    );
    const xml = compileWorkspace(w),
      f = flat(xml);
    if (same) assert.equal(f, flat(base), 'back to the XML it was');
    else assert.notEqual(f, flat(base), 'the edit changes the XML');
    for (const part of want) assert.ok(f.includes(part), 'missing: ' + part);
    for (const part of absent) assert.ok(!f.includes(part), 'left behind: ' + part);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml, 'reads back to the same XML');
    const path = out + name.split(' ')[0] + '.xml';
    writeFileSync(path, xml);
    written.push(path);
  });
// Moved, the feature leaves the HKX it came from; copied, it stays (an ordinary HKX writes it <HyperArmor/>).
test('card XML: a moved feature leaves its HKX, a copied one stays', () => {
  const w = importWorkspaceXml(fixture(GRAPPLE)),
    armor = item(w, 'a3', i => i.node.notify === 'armor').node.id,
    moved = compileWorkspace(transferItem(w, armor, 'a1', false)),
    copied = compileWorkspace(transferItem(w, armor, 'a1', true));
  assert.ok(section(compileWorkspace(w), 'GrappleStage01Attacker').includes('<HyperArmor/>'));
  assert.ok(!section(moved, 'GrappleStage01Attacker').includes('<HyperArmor/>'));
  assert.ok(section(copied, 'GrappleStage01Attacker').includes('<HyperArmor/>'));
  assert.ok(
    section(moved, 'GrappleFront').includes('op="armorOn"') && section(copied, 'GrappleFront').includes('op="armorOn"')
  );
});
// The HKX card's chips are what its XML holds: set after the edit, not after 「기본값으로」; 입력 감지 only where a key
// transition reads it.
test('card XML: the HKX chips follow the XML', () => {
  const chain = importWorkspaceXml(fixture(CHAIN)),
    entry = chain.actions[0].config.entry,
    state = w => playbackState(w, w.actions[0], entry);
  assert.equal(state(chain).attack.set, true);
  assert.equal(state(resetAttack(chain, 'a1')).attack.set, false);
  assert.equal(state(setActionView(chain, 'a1', 'first')).view.set, true);
  assert.equal(state(setExit(chain, {seconds: 0.3})).exit.set, true);
  assert.equal(state(resetExit(setExit(chain, {seconds: 0.3}), 'a1')).exit.set, false);
  assert.equal(state(chain).detection.applies, false, 'transitions with their own windows do not read it');
  assert.equal(state(ownDetection(chain)).detection.applies, true);
  assert.equal(state(ownDetection(chain)).detection.set, true);
  assert.equal(state(resetDetection(ownDetection(chain), 'a1', entry)).detection.set, false);
  const dds = importWorkspaceXml(fixture(DDS)),
    first = w => playbackState(w, w.actions[0], w.actions[0].config.entry).firstPerson.set;
  assert.equal(first(dds), true);
  assert.equal(first(setFirstPersonStart(dds, 'a1', 'block')), false);
});
test('card XML: the runtime checker takes every result', needsChecker, () => {
  assert.equal(written.length, scenarios.length);
  for (const path of written) {
    const r = spawnSync(checker, ['--json', path], {encoding: 'utf8'});
    assert.equal(r.status, 0, path + '\n' + r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.deepEqual([report.valid, report.errors, report.warnings], [true, [], []], path);
  }
});
