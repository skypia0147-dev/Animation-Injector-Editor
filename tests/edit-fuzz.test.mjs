// Free editing (10-24): lines and cards cut, deleted, added and drawn anywhere, as the canvas issues them
// (graph/commands.ts), must never leave the project broken, and which action a condition belongs to follows its
// lines. Random edits of real projects from fixed seeds; after every accepted edit the project must round-trip,
// report only errors an edit rightly leaves (something new to fill in, two settings that disagree), compile when it
// has none into XML the runtime accepts and that reads back the same, and keep every reference it holds whole.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readEditorBlock} from '../src/editorBlock.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {parseWorkspace, validateWorkspace, compileWorkspace} from '../src/workspace.ts';
import {executeGraphCommand} from '../src/graph/commands.ts';
import {checklistProjection} from '../src/graph/checklist.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {checker, needsChecker} from './local.mjs';

const SEEDS = [
  'examples/S3Directional.xml',
  'examples/S3Event.xml',
  'examples/S4Connections.xml',
  'tests/fixtures/current-xml/Chain.xml',
  'tests/fixtures/edit-fuzz/Selecting.xml',
];
// Errors an edit rightly leaves: something new still to fill in, or two settings that disagree.
const RIGHTFUL = [
  /전환 키: 유효한 키/,
  /블렌드 양쪽을 연결하세요/,
  /플러그인 파일 이름/,
  /16진수 폼 ID/,
  /시작 이벤트 이름을 입력/,
  /동작을 하나 이상 추가/,
  /같은 입력의 전환이 둘/,
  /블렌드가 충돌합니다/,
  /연결 이벤트 이름을 입력/,
  /이벤트 이름은 1~64바이트/,
  /운반: 내려놓기 동작을 고르세요/,
  /전환이 들어오는 고르기 동작에 이어진 조건이 없습니다/,
  /조건 분기를 거치는 전환에는 블렌드를 둘 수 없습니다/,
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
/** The edits the canvas could issue next: lines drawn between any two cards, lines cut, cards deleted, added and
 *  added from a card's menu. */
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
  const a = pick(w.actions);
  if (a && rnd() < 0.4)
    out.push({
      type: 'add',
      owner: a.uid,
      kind: pick(['conditionBranch', 'keyInput', 'markerReceive']),
      position: {x: Math.round(rnd() * 2000), y: Math.round(rnd() * 2000)},
    });
  const host = pick(nodes);
  if (host && rnd() < 0.4) {
    const options = contextualAdds(w, host.id).filter(o => !o.disabled);
    if (options.length)
      out.push({
        type: 'addConnected',
        source: host.id,
        option: pick(options),
        position: {x: Math.round(rnd() * 2000), y: Math.round(rnd() * 2000)},
      });
  }
  return out.length ? pick(out) : undefined;
}
/** What is wrong with the project after an edit; `selecting` are the actions that only select in the seed. */
function problems(w, selecting, runtime) {
  const found = [];
  try {
    if (JSON.stringify(parseWorkspace(JSON.stringify(w)).actions) !== JSON.stringify(w.actions))
      found.push('the project does not round-trip');
  } catch (e) {
    return ['the project does not reopen: ' + e.message];
  }
  // Every condition, action and followed condition a flow names is there.
  const uids = new Set(w.actions.map(a => a.uid));
  for (const a of w.actions) {
    const f = a.flow;
    if (!f) continue;
    const ids = new Set(f.tests.map(t => t.id)),
      bad = e => e && (('node' in e && !ids.has(e.node)) || ('action' in e && !uids.has(e.action)));
    if (f.entry && !ids.has(f.entry) && !f.unlinked) found.push('a flow enters a missing condition');
    for (const t of f.tests) {
      if (bad(t.pass) || bad(t.fail)) found.push('a route leads to a missing condition or action');
      if (t.operands?.some(o => !ids.has(o))) found.push('a group holds a missing condition');
    }
    for (const x of f.fans ?? [])
      if (
        !ids.has(x.parent) ||
        x.branches.some(b => !ids.has(b)) ||
        Object.entries(x.fails).some(([k, v]) => !ids.has(k) || bad(v))
      )
        found.push('a fan names a missing condition');
    if (f.follow && !w.actions.some(x => x.uid === f.follow.owner && x.flow?.tests.some(t => t.id === f.follow.test)))
      found.push('a start follows a missing condition');
  }
  // A start's line into a condition card: its own flow's, or the one it follows.
  for (const e of checklistProjection(w).edges)
    for (const o of e.origins?.length ? e.origins : [e]) {
      const card = /^flow:([^:]+):/.exec(e.target)?.[1],
        start = /^start:([^|]+)\|/.exec(o.source)?.[1] ?? (uids.has(o.source) ? o.source : undefined),
        a = start && w.actions.find(x => x.uid === start);
      if (card && a && card !== (a.flow?.follow ? a.flow.follow.owner : a.uid))
        found.push("a start's line is drawn into another action's condition");
    }
  // A blend behind a transition's card ends at that transition's destination, or is left open.
  for (const b of w.blends ?? []) {
    const id = /^link:([^|]+)\|/.exec(b.source)?.[1],
      l = id && w.links.find(l => l.id === id);
    if (id && !l) found.push('a blend sits behind a transition that is gone');
    else if (l && b.target && (/^anim:([^:]+):\|clip_/.exec(b.target)?.[1] ?? b.target) !== l.to)
      found.push("a transition's blend ends at another HKX than the transition");
  }
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  for (const e of errors) {
    if (RIGHTFUL.some(r => r.test(e.message))) continue;
    // A new HKX card's file is the user's to choose; a selecting action never asks for one.
    if (/HKX 경로를 입력/.test(e.message) && !selecting.has(w.actions.find(x => x.uid === e.node)?.config.actionId))
      continue;
    found.push('error: ' + e.message);
  }
  if (errors.length) return found;
  const xml = compileWorkspace(w);
  const reason = runtime?.(xml);
  if (reason) found.push('the runtime refuses it: ' + reason);
  if (compileWorkspace(importWorkspaceXml(xml)) !== xml) found.push('the XML reads back differently');
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

test('free editing never breaks a project (fixed random edits of real projects)', needsChecker, () => {
  const runtime = runtimeCheck(),
    report = [];
  let accepted = 0;
  for (const [n, path] of SEEDS.entries()) {
    const base = importWorkspaceXml(readEditorBlock(readFileSync(path, 'utf8')).body),
      selecting = new Set(base.actions.filter(a => !a.config.steps.some(s => s.clip)).map(a => a.config.actionId)),
      rnd = random(1024 + n);
    for (let run = 0; run < 24; run++) {
      let w = structuredClone(base);
      const trail = [];
      for (let step = 0; step < 30; step++) {
        const c = edits(w, rnd);
        if (!c) break;
        let next;
        try {
          next = executeGraphCommand(w, c).workspace;
        } catch (e) {
          // Refused, as the canvas would, with words for the user; never a program error.
          if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError)
            report.push(`${path} run ${run}: an edit fails with ${e.stack}\n  ${trail.join('\n  ')}`);
          continue;
        }
        if (!next || next === w) continue;
        accepted++;
        w = next;
        trail.push(
          c.type === 'disconnect' ? `cut ${c.edge.source} -> ${c.edge.target}` : JSON.stringify(c).slice(0, 160)
        );
        const found = problems(w, selecting, runtime);
        if (found.length) {
          report.push(`${path} run ${run}: ${found.join('; ')}\n  ${trail.join('\n  ')}`);
          break;
        }
      }
    }
  }
  assert.ok(accepted > 1000, `only ${accepted} edits were accepted`);
  assert.deepEqual(report, []);
});

// Whatever a card's menu offers, and every line's cut and every card's delete, works: on each project as it opens
// and after random edits (10-24: 「통과 → 조건 분기 추가」 on a condition with a next one looped back into it).
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
        report.push(`${where}: cut ${edge.source} -> ${edge.target}: ${e.message}`);
      }
  };
  for (const [n, path] of SEEDS.entries()) {
    const base = importWorkspaceXml(readEditorBlock(readFileSync(path, 'utf8')).body),
      rnd = random(4096 + n);
    sweep(base, path);
    for (let run = 0; run < 8; run++) {
      let w = structuredClone(base);
      for (let step = 0; step < 25; step++) {
        const c = edits(w, rnd);
        if (!c) break;
        try {
          w = executeGraphCommand(w, c).workspace ?? w;
        } catch {}
      }
      sweep(w, `${path} run ${run}`);
    }
  }
  assert.deepEqual(report, []);
});
