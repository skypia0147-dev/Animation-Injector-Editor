// Free editing (XML format 6): lines and cards cut, deleted, added and drawn anywhere, as the canvas issues them
// (graph/commands.ts), and a condition card's own edits (rows, True, conditions, groups: graph/cardCommands.ts,
// graph/conditionExpression.ts), must never leave the project broken. Random edits of real projects from fixed seeds;
// after every accepted edit the project must round-trip, keep every reference it holds whole, hold no card loop,
// report only errors an edit rightly leaves (something new to fill in), and when it has none compile into XML the
// runtime accepts and that the editor reads back to the same XML (one to one).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, rmSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readEditorBlock} from '../src/editorBlock.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseWorkspace, validateWorkspace, compileWorkspace} from '../src/workspace.ts';
import {executeGraphCommand} from '../src/graph/commands.ts';
import {checklistProjection} from '../src/graph/checklist.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {
  addRow,
  removeRow,
  moveRow,
  setTrue,
  addCondition,
  removeCondition,
  moveCondition,
  mergeCondition,
  setRowJoin,
  setGroupJoin,
  tidyCardIn,
  duplicateCondition,
} from '../src/graph/cardCommands.ts';
import {editExpression} from '../src/graph/conditionExpression.ts';
import {cardLoop, refAction, refCard} from '../src/cards.ts';
import {checker, needsChecker, runtimeSource} from './local.mjs';

const SEEDS = [
  'tests/fixtures/current-xml/Directional.xml',
  'tests/fixtures/current-xml/Event.xml',
  'tests/fixtures/current-xml/Connections.xml',
  'tests/fixtures/current-xml/Chain.xml',
  'tests/fixtures/current-xml/Grapple.xml',
  'tests/fixtures/edit-fuzz/Selecting.xml',
  `${runtimeSource}/tests/data/dynamic-dodge-shot.xml`,
].filter(existsSync);
// Errors an edit rightly leaves: something new still to fill in (a key, an event, a destination, a condition's
// setting), or two settings that disagree.
const RIGHTFUL = [
  /유효한 키/,
  /키 또는 패드/,
  /키를 지정/,
  /이벤트 이름/,
  /이벤트를 지정/,
  /플러그인 파일 이름/,
  /16진수 폼 ID/,
  /동작을 하나 이상 추가/,
  /같은 입력의 전환이 둘/,
  /내려놓기 동작을 고르세요/,
  /내려놓기 입력을 선택/,
  /대상 놓기 시점/,
  /목적지/,
  /갈 곳/,
  /조건 카드를 거치는 전환/,
  /빈 조건 그룹/,
  /같은 출발 HKX에 이미 연결된 이벤트/,
  /전투 대상은 페어로/,
  /재생할 곳이 없습니다/,
  /빈 조건 카드/,
  /HKX 경로를 입력/,
  /소리 파일 또는 등록 사운드/,
];

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const at = rnd => ({x: Math.round(rnd() * 2000), y: Math.round(rnd() * 2000)});
/** A condition card's own edits: rows, True, its conditions and groups. */
function cardEdit(w, rnd) {
  const pick = list => list[Math.floor(rnd() * list.length)];
  const c = pick(w.cards);
  if (!c) return;
  const places = ['guards', ...c.rows.map(r => 'row:' + r.id)],
    place = pick(places),
    roots = place === 'guards' ? c.guards : (c.rows.find(r => 'row:' + r.id === place)?.guards ?? []),
    root = pick(roots),
    row = pick(c.rows),
    group = pick(c.tests.filter(t => t.kind === 'all' || t.kind === 'any')),
    member = group && pick(group.operands ?? []);
  return pick(
    [
      {name: 'addRow', run: w => addRow(w, c.uid).workspace},
      row && {name: 'removeRow', run: w => removeRow(w, c.uid, row.id)},
      row && {name: 'moveRow', run: w => moveRow(w, c.uid, row.id, Math.floor(rnd() * 3))},
      {name: 'setTrue', run: w => setTrue(w, c.uid)},
      {name: 'addCondition', run: w => addCondition(w, c.uid, place).workspace},
      root && {name: 'removeCondition', run: w => removeCondition(w, c.uid, place, root)},
      root && {
        name: 'moveCondition',
        run: w => moveCondition(w, c.uid, place, root, pick(places), Math.floor(rnd() * 3)),
      },
      root && {name: 'duplicateCondition', run: w => duplicateCondition(w, c.uid, place, root)},
      // Dropped on another condition of its list: the two become a group (runtime 0.12.301: one level, opposite).
      root && {
        name: 'merge',
        run: w =>
          mergeCondition(w, c.uid, place, root, c.uid, place, pick(roots.filter(r => r !== root)) ?? root, false),
      },
      row && {name: 'rowJoin', run: w => setRowJoin(w, c.uid, row.id, !row.any)},
      group && {
        name: 'groupJoin',
        run: w =>
          setGroupJoin(
            w,
            c.uid,
            c.guards.includes(group.id) ? 'guards' : 'row:' + (c.rows.find(r => r.guards.includes(group.id))?.id ?? ''),
            group.id,
            group.kind === 'all' ? 'any' : 'all'
          ),
      },
      group && {
        name: 'addMember',
        run: w => tidyCardIn(editExpression(w, c.uid, {type: 'add', parent: group.id}), c.uid),
      },
      member && {
        name: 'removeMember',
        run: w => tidyCardIn(editExpression(w, c.uid, {type: 'remove', parent: group.id, id: member}), c.uid),
      },
      root && {
        name: 'negate',
        run: w => ({
          ...w,
          cards: w.cards.map(x =>
            x.uid === c.uid ? {...x, tests: x.tests.map(t => (t.id === root ? {...t, negate: !t.negate} : t))} : x
          ),
        }),
      },
    ].filter(Boolean)
  );
}
/** The edits the canvas could issue next: lines drawn between any two cards, lines cut, cards deleted, added and
 *  added from a card's menu, and a card's own edits. */
function edits(w, rnd) {
  const pick = list => list[Math.floor(rnd() * list.length)];
  const p = checklistProjection(w),
    nodes = p.nodes.filter(n => n.id !== 'eventRegistry'),
    out = [];
  for (let i = 0; i < 6 && nodes.length; i++) {
    const s = pick(nodes);
    out.push({
      type: 'connect',
      source: s.id,
      target: pick(nodes).id,
      port: pick(s.outputs?.length ? s.outputs : [undefined]),
    });
  }
  for (const edge of p.edges) if (rnd() < 0.15) out.push({type: 'disconnect', edge});
  if (nodes.length && rnd() < 0.5) out.push({type: 'delete', id: pick(nodes).id});
  if (rnd() < 0.4)
    out.push({
      type: 'add',
      owner: '',
      kind: pick(['conditionCard', 'keyInput', 'markerReceive', 'playNode']),
      position: at(rnd),
    });
  const host = pick(nodes);
  if (host && rnd() < 0.4) {
    const options = contextualAdds(w, host.id).filter(o => !o.disabled);
    if (options.length) out.push({type: 'addConnected', source: host.id, option: pick(options), position: at(rnd)});
  }
  for (let i = 0; i < 3; i++) {
    const c = cardEdit(w, rnd);
    if (c) out.push({type: 'card', ...c});
  }
  return out.length ? pick(out) : undefined;
}
const run = (w, c) => (c.type === 'card' ? c.run(w) : executeGraphCommand(w, c).workspace);
const describe = c =>
  c.type === 'disconnect'
    ? `cut ${c.edge.source} -> ${c.edge.target}`
    : c.type === 'card'
      ? 'card ' + c.name
      : JSON.stringify(c).slice(0, 160);

/** What is wrong with the project after an edit. */
function problems(w, runtime) {
  const found = [];
  try {
    const back = parseWorkspace(JSON.stringify(w));
    for (const k of ['actions', 'starts', 'cards', 'links', 'qtes'])
      if (JSON.stringify(back[k]) !== JSON.stringify(w[k])) found.push(`the project's ${k} do not round-trip`);
  } catch (e) {
    return ['the project does not reopen: ' + e.message];
  }
  // Every destination, condition and owner the document names is there.
  const actions = new Set(w.actions.map(a => a.uid)),
    cards = new Set(w.cards.map(c => c.uid));
  const whole = (r, where) => {
    if (r === null || r === undefined) return;
    if (refAction(r) && !actions.has(refAction(r))) found.push(`${where} goes to a missing action`);
    if (refCard(r) && !cards.has(refCard(r))) found.push(`${where} goes to a missing card`);
  };
  for (const s of w.starts) whole(s.to, 'a start');
  for (const c of w.cards) {
    const ids = new Set(c.tests.map(t => t.id));
    for (const r of c.rows) {
      whole(r.to, 'a row');
      if (r.guards.some(g => !ids.has(g))) found.push('a row names a missing condition');
    }
    if (c.true !== undefined) whole(c.true, 'a True');
    whole(c.false, 'a False');
    if (c.guards.some(g => !ids.has(g))) found.push('a card names a missing common condition');
    for (const t of c.tests) if (t.operands?.some(o => !ids.has(o))) found.push('a group holds a missing condition');
    if (c.true !== undefined && c.rows.length) found.push('a card has both True and rows');
  }
  for (const l of w.links) {
    if (!actions.has(l.from)) found.push('a transition from a missing action');
    if (l.to && !actions.has(l.to)) found.push('a transition to a missing action');
    if (l.card && !cards.has(l.card)) found.push('a transition to a missing card');
    if (l.partnerTo && !actions.has(l.partnerTo)) found.push("a transition's partner is missing");
  }
  for (const q of w.qtes ?? []) {
    if (q.owner && !actions.has(q.owner)) found.push('a QTE of a missing action');
    for (const r of Object.values(q.results)) {
      if (r.to && !actions.has(r.to)) found.push('a QTE result to a missing action');
      if (r.card && !cards.has(r.card)) found.push('a QTE result to a missing card');
    }
  }
  if (w.order.some(u => !actions.has(u) && !cards.has(u) && !w.starts.some(s => s.uid === u)))
    found.push('the order names something gone');
  if (cardLoop(w)) found.push('condition cards go to one another in a loop');
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  for (const e of errors) if (!RIGHTFUL.some(r => r.test(e.message))) found.push('error: ' + e.node + ': ' + e.message);
  if (errors.length) return found;
  const xml = compileWorkspace(w);
  const reason = runtime?.(xml);
  if (reason) found.push('the runtime refuses it: ' + reason);
  try {
    const again = compileWorkspace(importWorkspaceXml(xml));
    if (again !== xml) {
      found.push('the XML reads back differently');
      if (!existsSync(`${dir}/differs-a.xml`)) {
        writeFileSync(`${dir}/differs-a.xml`, xml);
        writeFileSync(`${dir}/differs-b.xml`, again);
      }
    }
  } catch (e) {
    found.push('the XML does not read back: ' + e.message);
  }
  return found;
}

const dir = 'tests/generated/edit-fuzz';
function runtimeCheck() {
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const seen = new Map();
  return xml => {
    const h = createHash('sha1').update(xml).digest('hex');
    if (!seen.has(h)) {
      const file = `${dir}/${h}.xml`;
      writeFileSync(file, xml);
      try {
        execFileSync(checker, [file], {stdio: 'pipe'});
        seen.set(h, '');
      } catch (e) {
        seen.set(
          h,
          String(e.stdout ?? e.message)
            .split('\n')
            .find(l => /\[error\]/.test(l)) ?? 'refused'
        );
      }
    }
    return seen.get(h);
  };
}
const open = path => importWorkspaceXml(readEditorBlock(readFileSync(path, 'utf8')).body);

test('free editing never breaks a project (fixed random edits of real projects)', needsChecker, t => {
  const runtime = runtimeCheck(),
    report = [];
  let accepted = 0,
    compiled = 0;
  for (const [n, path] of SEEDS.entries()) {
    const base = open(path),
      rnd = random(1024 + n);
    for (let r = 0; r < 24; r++) {
      let w = structuredClone(base);
      const trail = [];
      for (let step = 0; step < 30; step++) {
        const c = edits(w, rnd);
        if (!c) break;
        let next;
        try {
          next = run(w, c);
        } catch (e) {
          // Refused, as the canvas would, with words for the user; never a program error.
          if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError)
            report.push(`${path} run ${r}: an edit fails with ${e.stack}\n  ${[...trail, describe(c)].join('\n  ')}`);
          continue;
        }
        if (!next || next === w) continue;
        accepted++;
        w = next;
        trail.push(describe(c));
        const found = problems(w, runtime);
        if (!validateWorkspace(w).some(i => i.level === 'error')) compiled++;
        if (found.length) {
          report.push(`${path} run ${r}: ${[...new Set(found)].join('; ')}\n  ${trail.join('\n  ')}`);
          break;
        }
      }
    }
  }
  t.diagnostic(`${accepted} edits accepted, ${compiled} edited projects compiled and checked by the runtime`);
  assert.ok(accepted > 1500, `only ${accepted} edits were accepted`);
  assert.ok(compiled > 300, `only ${compiled} edited projects compiled`);
  assert.deepEqual(report, []);
});

// Whatever a card's menu offers, and every line's cut and every card's delete, works: on each project as it opens
// and after random edits.
test('every menu item, cut and delete works', () => {
  const report = [];
  const sweep = (w, where) => {
    const p = checklistProjection(w);
    for (const n of p.nodes) {
      for (const option of contextualAdds(w, n.id).filter(o => !o.disabled))
        try {
          executeGraphCommand(w, {type: 'addConnected', source: n.id, option, position: {x: 100, y: 100}});
        } catch (e) {
          report.push(`${where}: ${n.id} menu ${option.label}: ${e.message}`);
        }
      if (n.id !== 'eventRegistry')
        try {
          executeGraphCommand(w, {type: 'delete', id: n.id});
        } catch (e) {
          report.push(`${where}: delete ${n.id}: ${e.message}`);
        }
    }
    for (const edge of p.edges)
      try {
        executeGraphCommand(w, {type: 'disconnect', edge});
      } catch (e) {
        // A dashed line to an event's listener is changed on its QTE result, not cut.
        if (!edge.via) report.push(`${where}: cut ${edge.source} -> ${edge.target}: ${e.message}`);
      }
  };
  for (const [n, path] of SEEDS.entries()) {
    const base = open(path),
      rnd = random(4096 + n);
    sweep(base, path);
    for (let r = 0; r < 8; r++) {
      let w = structuredClone(base);
      for (let step = 0; step < 25; step++) {
        const c = edits(w, rnd);
        if (!c) break;
        try {
          w = run(w, c) ?? w;
        } catch {}
      }
      sweep(w, `${path} run ${r}`);
    }
  }
  assert.deepEqual(report, []);
});
