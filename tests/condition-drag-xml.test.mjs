import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {
  mergeCondition,
  moveCondition,
  rowIntoList,
  setGroupJoin,
  setRowJoin,
  transferCondition,
  transferRow,
} from '../src/graph/cardCommands.ts';
import {checker, needsChecker} from './local.mjs';

// Dragging on condition cards, end to end (10-27): Dynamic Dodge Shot as installed, each drag made with the command
// the card face calls, then the XML it writes: its <Start> holds what the drag meant, it reads back to the same XML,
// and the runtime checker takes it. card1 = the start's common conditions (True → card2), card2 = sneaking (True →
// card3, False → card4), card3 / card4 = the sneak / plain dodge rows (back, left, right).
const source = readFileSync(new URL('./fixtures/DynamicDodgeShot.xml', import.meta.url), 'utf8');
const base = () => importWorkspaceXml(source);
const start = xml => xml.slice(xml.indexOf('<Start'), xml.indexOf('</Start>') + 8).replace(/\s*\n\s*/g, '');
const c = (w, uid) => w.cards.find(x => x.uid === uid);
const idOf = (w, uid, kind, value) =>
  c(w, uid).tests.find(
    t => t.kind === kind && (value === undefined || [t.option, t.attackState, t.type].includes(value))
  ).id;

// Shorthands for what the XML should hold.
const mv = o => `<Check kind="movementDirection" option="${o}"/>`;
const WD = '<Check kind="weaponDrawn"/>',
  EQ = '<Check kind="equippedType" hand="left" type="bow"/>',
  ATT = '<Check kind="attackState" state="bowAttached"/>',
  DRAWN = '<Check kind="attackState" state="bowDrawn"/>',
  SNEAK = '<Check kind="sneaking"/>',
  BOW_OR = `<Or>${ATT}${DRAWN}</Or>`;

const scenarios = [
  // Within a card
  [
    'A1 a row condition into the common conditions',
    w => moveCondition(w, 'card3', 'row:row1', idOf(w, 'card3', 'movementDirection', 'back'), 'guards', 0),
    [`<True>${SNEAK}<True>${mv('back')}<Row to="SneakBowDodge_L1">`],
    ['to="SneakBowDodge_B1"'],
  ],
  [
    'A2 a common condition out into a new row (True becomes the row)',
    w => moveCondition(w, 'card1', 'guards', idOf(w, 'card1', 'weaponDrawn'), 'newRow', 0),
    [
      `${EQ}${BOW_OR}<Row>${WD}<Condition>${SNEAK}<True><Row to="SneakBowDodge_B1">`,
      '</False></Condition></Row></Start>',
    ],
    ['<True><Check kind="sneaking"/><True>'],
  ],
  [
    'A3 a condition into another row',
    w => moveCondition(w, 'card4', 'row:row3', idOf(w, 'card4', 'movementDirection', 'right'), 'row:row2', 1),
    [`<Row to="BowDodge_L1">${mv('left')}${mv('right')}</Row></False>`],
    ['to="BowDodge_R1"'],
  ],
  [
    'A4 reordering the common conditions',
    w => moveCondition(w, 'card1', 'guards', idOf(w, 'card1', 'equippedType'), 'guards', 0),
    [`key="Mouse2" cooldown="0.2" block="blockStart,bashStart">${EQ}${WD}${BOW_OR}`],
    [],
  ],
  [
    "A5 a row's last condition leaving takes the row",
    w => moveCondition(w, 'card4', 'row:row1', idOf(w, 'card4', 'movementDirection', 'back'), 'row:row3', 0),
    [`<Row to="BowDodge_R1">${mv('back')}${mv('right')}</Row>`],
    ['to="BowDodge_B1"'],
  ],
  [
    'A6 every row emptied: True comes back with the last destination',
    w => {
      for (const r of ['row1', 'row2', 'row3'])
        w = moveCondition(w, 'card3', 'row:' + r, c(w, 'card3').rows.find(x => x.id === r).guards[0], 'guards', 99);
      return w;
    },
    [`<True>${SNEAK}<True>${mv('back')}${mv('left')}${mv('right')}<True to="SneakBowDodge_R1"/></True><False>`],
    ['<Row to="SneakBowDodge'],
  ],
  [
    "A7 a condition let go on a True card opens a row with True's destination",
    w => moveCondition(w, 'card2', 'guards', idOf(w, 'card2', 'sneaking'), 'newRow', 0),
    [`<True><Row>${SNEAK}<Condition><Row to="SneakBowDodge_B1">`, '</Condition></Row><False><Row to="BowDodge_B1">'],
    [],
  ],

  // Between cards
  [
    'B1 to another card',
    w =>
      transferCondition(
        w,
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        'card3',
        'guards',
        0,
        false
      ),
    [`<True>${mv('back')}<Row to="SneakBowDodge_B1">`, `<False><Row to="BowDodge_L1">`],
    ['to="BowDodge_B1"'],
  ],
  [
    'B2 Ctrl copies to another card',
    w => transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'weaponDrawn'), 'card2', 'guards', 1, true),
    [`${WD}${EQ}`, `<True>${SNEAK}${WD}<True>`],
    [],
  ],
  [
    "B3 into another card's True: a row there",
    w =>
      transferCondition(
        w,
        'card4',
        'row:row3',
        idOf(w, 'card4', 'movementDirection', 'right'),
        'card2',
        'newRow',
        0,
        false
      ),
    [`<True>${SNEAK}<Row>${mv('right')}<Condition><Row to="SneakBowDodge_B1">`, '</Condition></Row><False>'],
    ['to="BowDodge_R1"'],
  ],

  // Groups
  [
    'C1 two common conditions merged: an OR group',
    w =>
      mergeCondition(
        w,
        'card1',
        'guards',
        idOf(w, 'card1', 'weaponDrawn'),
        'card1',
        'guards',
        idOf(w, 'card1', 'equippedType'),
        false
      ),
    [`block="blockStart,bashStart"><Or>${EQ}${WD}</Or>${BOW_OR}`],
    [],
  ],
  [
    'C2 two rows merged: an OR row',
    w =>
      mergeCondition(
        w,
        'card4',
        'row:row2',
        idOf(w, 'card4', 'movementDirection', 'left'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      ),
    [`<False><Row to="BowDodge_B1" match="any">${mv('back')}${mv('left')}</Row><Row to="BowDodge_R1">`],
    ['to="BowDodge_L1"'],
  ],
  [
    'C3 merged in an OR row: an AND group',
    w => {
      w = mergeCondition(
        w,
        'card4',
        'row:row2',
        idOf(w, 'card4', 'movementDirection', 'left'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      );
      return mergeCondition(
        w,
        'card4',
        'row:row3',
        idOf(w, 'card4', 'movementDirection', 'right'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      );
    },
    [`<Row to="BowDodge_B1" match="any"><And>${mv('back')}${mv('right')}</And>${mv('left')}</Row></False>`],
    [],
  ],
  [
    'C4 a row switched from AND to OR',
    w => {
      w = moveCondition(w, 'card4', 'row:row2', idOf(w, 'card4', 'movementDirection', 'left'), 'row:row1', 1);
      return setRowJoin(w, 'card4', 'row1', true);
    },
    [`<Row to="BowDodge_B1" match="any">${mv('back')}${mv('left')}</Row>`],
    [],
  ],
  [
    "C5 a group set to its holder's operator dissolves",
    w => setGroupJoin(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'all'),
    [`${WD}${EQ}${ATT}${DRAWN}<True>`],
    ['<Or>'],
  ],
  [
    'C6 a condition into a group',
    w => moveCondition(w, 'card1', 'guards', idOf(w, 'card1', 'weaponDrawn'), 'group:' + idOf(w, 'card1', 'any'), 0),
    [`block="blockStart,bashStart">${EQ}<Or>${WD}${ATT}${DRAWN}</Or>`],
    [],
  ],
  [
    'C7 a group left with one member dissolves',
    w =>
      moveCondition(
        w,
        'card1',
        'group:' + idOf(w, 'card1', 'any'),
        idOf(w, 'card1', 'attackState', 'bowAttached'),
        'guards',
        0
      ),
    [`block="blockStart,bashStart">${ATT}${WD}${EQ}${DRAWN}<True>`],
    ['<Or>'],
  ],
  [
    "C8 a whole group into another card's row",
    w => transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card4', 'row:row1', 1, false),
    [`${WD}${EQ}<True>`, `<Row to="BowDodge_B1">${mv('back')}${BOW_OR}</Row>`],
    [],
  ],
  [
    "C9 a whole group into another card's common conditions",
    w => transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card2', 'guards', 1, false),
    [`${WD}${EQ}<True>${SNEAK}${BOW_OR}<True>`],
    [],
  ],
  [
    'C10 a group copied (Ctrl) to another card',
    w => transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card3', 'guards', 0, true),
    [`${WD}${EQ}${BOW_OR}<True>`, `<True>${SNEAK}<True>${BOW_OR}<Row to="SneakBowDodge_B1">`],
    [],
  ],
  [
    'C11 an OR group into an OR row joins it',
    w => {
      w = mergeCondition(
        w,
        'card4',
        'row:row2',
        idOf(w, 'card4', 'movementDirection', 'left'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      );
      return transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card4', 'row:row1', 2, false);
    },
    [`<Row to="BowDodge_B1" match="any">${mv('back')}${mv('left')}${ATT}${DRAWN}</Row>`],
    [],
  ],
  [
    'C12 an AND row into an OR row: an AND group',
    w => {
      w = moveCondition(w, 'card4', 'row:row2', idOf(w, 'card4', 'movementDirection', 'left'), 'row:row1', 1); // row1 = back AND left
      w = mergeCondition(
        w,
        'card3',
        'row:row2',
        idOf(w, 'card3', 'movementDirection', 'left'),
        'card3',
        'row:row1',
        idOf(w, 'card3', 'movementDirection', 'back'),
        false
      ); // card3 row1 OR
      return rowIntoList(w, 'card4', 'row1', 'card3', 'row:row1', false);
    },
    [`<Row to="SneakBowDodge_B1" match="any">${mv('back')}${mv('left')}<And>${mv('back')}${mv('left')}</And></Row>`],
    ['to="BowDodge_B1"'],
  ],

  // Whole rows
  [
    'D1 an OR row into the common conditions: an OR group, the row and its destination gone',
    w => {
      w = mergeCondition(
        w,
        'card4',
        'row:row2',
        idOf(w, 'card4', 'movementDirection', 'left'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      );
      return rowIntoList(w, 'card4', 'row1', 'card4', 'guards', false);
    },
    [`<False><Or>${mv('back')}${mv('left')}</Or><Row to="BowDodge_R1">`],
    ['to="BowDodge_B1"'],
  ],
  [
    'D2 a row into another row',
    w => rowIntoList(w, 'card4', 'row3', 'card4', 'row:row2', false),
    [`<Row to="BowDodge_L1">${mv('left')}${mv('right')}</Row></False>`],
    ['to="BowDodge_R1"'],
  ],
  [
    "D3 a row between another card's rows, with its destination",
    w => transferRow(w, 'card4', 'row1', 'card3', 0, false),
    [`<True><Row to="BowDodge_B1">${mv('back')}</Row><Row to="SneakBowDodge_B1">`, `<False><Row to="BowDodge_L1">`],
    [],
  ],
  [
    'D4 a row copied (Ctrl) to another card',
    w => transferRow(w, 'card4', 'row1', 'card3', 3, true),
    [
      `<Row to="SneakBowDodge_R1">${mv('right')}</Row><Row to="BowDodge_B1">${mv('back')}</Row></True>`,
      `<False><Row to="BowDodge_B1">`,
    ],
    [],
  ],
  [
    'D5 the last row into the common conditions: True takes its destination',
    w => {
      w = rowIntoList(w, 'card4', 'row1', 'card4', 'guards', false);
      w = rowIntoList(w, 'card4', 'row2', 'card4', 'guards', false);
      return rowIntoList(w, 'card4', 'row3', 'card4', 'guards', false);
    },
    [`<False>${mv('back')}${mv('left')}${mv('right')}<True to="BowDodge_R1"/></False>`],
    [],
  ],
];

// Refused: the edit throws (the card face shows the message and changes nothing).
const refused = [
  [
    'R1 a group into a group on another card',
    w => {
      w = moveCondition(w, 'card4', 'row:row2', idOf(w, 'card4', 'movementDirection', 'left'), 'row:row1', 1); // row1 = back AND left
      w = mergeCondition(
        w,
        'card4',
        'row:row3',
        idOf(w, 'card4', 'movementDirection', 'right'),
        'card4',
        'row:row1',
        idOf(w, 'card4', 'movementDirection', 'back'),
        false
      ); // (back OR right) AND left
      const g = c(w, 'card4').tests.find(t => t.kind === 'any' || t.kind === 'all').id;
      return transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card4', 'group:' + g, 0, false);
    },
  ],
  [
    'R2 a group into a group on its own card',
    w => {
      w = mergeCondition(
        w,
        'card1',
        'guards',
        idOf(w, 'card1', 'weaponDrawn'),
        'card1',
        'guards',
        idOf(w, 'card1', 'equippedType'),
        false
      );
      const [g1, g2] = c(w, 'card1').guards;
      return moveCondition(w, 'card1', 'guards', g2, 'group:' + g1, 0);
    },
  ],
  [
    'R3 a group merged onto a condition',
    w =>
      mergeCondition(
        w,
        'card1',
        'guards',
        idOf(w, 'card1', 'any'),
        'card1',
        'guards',
        idOf(w, 'card1', 'weaponDrawn'),
        false
      ),
  ],
  [
    'R4 a row holding a group into a list of the other operator',
    w => {
      w = transferCondition(w, 'card1', 'guards', idOf(w, 'card1', 'any'), 'card4', 'row:row1', 1, true); // card4 row1 = back AND (OR)
      w = mergeCondition(
        w,
        'card3',
        'row:row2',
        idOf(w, 'card3', 'movementDirection', 'left'),
        'card3',
        'row:row1',
        idOf(w, 'card3', 'movementDirection', 'back'),
        false
      ); // card3 row1 OR
      return rowIntoList(w, 'card4', 'row1', 'card3', 'row:row1', false);
    },
  ],
  [
    'R5 a row moved so the cards loop',
    w => {
      w = moveCondition(w, 'card1', 'guards', idOf(w, 'card1', 'weaponDrawn'), 'newRow', 0); // card1: Row → card2
      return transferRow(w, 'card1', c(w, 'card1').rows[0].id, 'card3', 0, false);
    },
  ],
];

const original = start(compileWorkspace(base()));
const out = fileURLToPath(new URL('./generated/condition-drag-xml/', import.meta.url));
mkdirSync(out, {recursive: true});
const written = [];
for (const [name, edit, want, absent] of scenarios)
  test('drag to XML: ' + name, () => {
    const w = edit(base());
    assert.deepEqual(
      validateWorkspace(w)
        .filter(i => i.level === 'error')
        .map(i => i.message),
      []
    );
    const xml = compileWorkspace(w),
      s = start(xml);
    assert.notEqual(s, original, 'the drag changes the XML');
    for (const part of want) assert.ok(s.includes(part), 'missing: ' + part + '\n' + s);
    for (const part of absent) assert.ok(!s.includes(part), 'left behind: ' + part + '\n' + s);
    assert.equal(compileWorkspace(importWorkspaceXml(xml)), xml, 'reads back to the same XML');
    const file = out + name.split(' ')[0] + '.xml';
    writeFileSync(file, xml);
    written.push(file);
  });
for (const [name, edit] of refused)
  test('drag refused: ' + name, () => assert.throws(() => edit(base()), /한 단계|순환/));
test('drag to XML: the runtime checker takes every result', needsChecker, () => {
  assert.equal(written.length, scenarios.length);
  for (const file of written) {
    const r = spawnSync(checker, ['--json', file], {encoding: 'utf8'});
    assert.equal(r.status, 0, file + '\n' + r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.deepEqual([report.valid, report.errors, report.warnings], [true, [], []], file);
  }
});
