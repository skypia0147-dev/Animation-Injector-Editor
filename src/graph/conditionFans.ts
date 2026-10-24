/** Fanned condition branches (docs/mockup-condition-fan, 10-21): one condition's pass leads to several conditions
 *  tried in a stored order; the first that passes runs. A branch's fail is an ordinary pin: empty, the next branch is
 *  tried (the last one runs nothing); connected, it goes there at once. The XML and the runtime are unchanged: the
 *  fan is written as today's chain (each empty fail points to the next branch), so the editor keeps the order and
 *  the connected fails here and rewrites the chain from them after every change (applyFans). */
import type {Workspace} from '../workspace.ts';
import type {BranchFlow, BranchTarget, BranchTest} from './conditions.ts';
import {tr} from '../i18n/korean.ts';

export type ConditionFan = {
  /** The condition whose pass fans out. */
  parent: string;
  /** The branches in their stored order (①②③…). Moving a card never changes it. */
  branches: string[];
  /** The fails the user connected, by branch; a branch missing here has an empty fail. */
  fails: Record<string, BranchTarget>;
};

export const fanOf = (f: BranchFlow | undefined, parent: string) => f?.fans?.find(x => x.parent === parent);
export function fanOfBranch(f: BranchFlow | undefined, branch: string) {
  const fan = f?.fans?.find(x => x.branches.includes(branch));
  return fan ? {fan, index: fan.branches.indexOf(branch)} : undefined;
}

/** The chain the fans stand for, written into the tests: the parent passes to ①, each branch fails to its own
 *  connection or the next branch, the last one to nothing. A fan left with fewer than two branches is no fan. */
export function applyFans(f: BranchFlow) {
  if (!f.fans) return;
  const test = (id: string) => f.tests.find(t => t.id === id);
  for (const fan of f.fans) {
    fan.branches = fan.branches.filter((id, i, all) => test(id) && all.indexOf(id) === i && id !== fan.parent);
    // A fail kept for a branch that left, or into a condition that is gone (deleted, moved to another flow).
    for (const [id, to] of Object.entries(fan.fails))
      if (!fan.branches.includes(id) || ('node' in to && !test(to.node))) delete fan.fails[id];
  }
  const kept: ConditionFan[] = [];
  for (const fan of f.fans) {
    const parent = test(fan.parent);
    if (!parent) continue;
    if (fan.branches.length < 2) {
      // Back to a plain route: the parent passes to the one left, which keeps only its own fail.
      if (fan.branches.length) {
        parent.pass = {node: fan.branches[0]};
        setFail(test(fan.branches[0])!, fan.fails[fan.branches[0]]);
      } else delete parent.pass;
      continue;
    }
    parent.pass = {node: fan.branches[0]};
    fan.branches.forEach((id, i) => {
      const next = fan.branches[i + 1];
      setFail(test(id)!, fan.fails[id] ?? (next ? {node: next} : undefined));
    });
    kept.push(fan);
  }
  if (kept.length) f.fans = kept;
  else delete f.fans;
}
/** The chain rewritten after a change: refused when a fail now loops back (the runtime rejects the whole flow,
 *  ConditionFlow.h kCycle), e.g. ③ moved before ① while ①'s fail goes to ③. */
function settle(f: BranchFlow, cut = false) {
  applyFans(f);
  // A cut is never refused (free editing): a loop it leaves is reported by validation (checkFlows) until mended.
  if (cut) return;
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 2) return true;
    if (state.get(id) === 1) return false;
    state.set(id, 1);
    const t = f.tests.find(t => t.id === id);
    for (const next of [...(t?.operands ?? []), ...[t?.pass, t?.fail].flatMap(e => (e && 'node' in e ? [e.node] : []))])
      if (!visit(next)) return false;
    state.set(id, 2);
    return true;
  };
  if (!f.tests.every(t => visit(t.id)))
    throw Error(tr('이 순서면 실패가 앞 갈래로 되돌아가 순환합니다. 그 실패 연결을 먼저 바꾸세요.'));
}
function setFail(t: BranchTest, target?: BranchTarget) {
  if (target) t.fail = {...target};
  else delete t.fail;
}

const flowOf = (w: Workspace, owner: string) => {
  const f = w.actions.find(a => a.uid === owner)?.flow;
  if (!f) throw Error(tr('수정할 조건이 없습니다.'));
  return f;
};

/** Draws `parent`'s pass to one more condition: the branches it already reaches become a fan, or the fan grows. */
export function addFanBranch(w: Workspace, owner: string, parent: string, branch: string): Workspace {
  const n = structuredClone(w),
    f = flowOf(n, owner),
    p = f.tests.find(t => t.id === parent),
    b = f.tests.find(t => t.id === branch);
  if (!p || !b) throw Error(tr('연결할 조건이 없습니다.'));
  let fan = fanOf(f, parent);
  if (!fan) {
    const first = p.pass && 'node' in p.pass ? p.pass.node : '';
    if (!first) throw Error(tr('통과가 조건 하나에 이어져 있을 때 갈래를 더할 수 있습니다.'));
    if (fanOfBranch(f, first) || fanOfBranch(f, branch)) throw Error(tr('다른 부채꼴의 갈래는 더할 수 없습니다.'));
    const firstTest = f.tests.find(t => t.id === first)!;
    fan = {parent, branches: [first], fails: {}};
    // The first branch's fail stays where it went, unless that was the branch now added (the same as empty).
    if (firstTest.fail && !('node' in firstTest.fail && firstTest.fail.node === branch))
      fan.fails[first] = firstTest.fail;
    (f.fans ??= []).push(fan);
  }
  if (fan.branches.includes(branch)) return w;
  if (fanOfBranch(f, branch)) throw Error(tr('다른 부채꼴의 갈래는 더할 수 없습니다.'));
  if (b.fail) fan.fails[branch] = b.fail;
  fan.branches.push(branch);
  settle(f);
  return n;
}

/** Cuts one of `parent`'s fanned lines: that branch leaves the fan with its own connected fail. */
export function removeFanBranch(w: Workspace, owner: string, parent: string, branch: string): Workspace {
  const n = structuredClone(w),
    f = flowOf(n, owner),
    fan = fanOf(f, parent);
  if (!fan || !fan.branches.includes(branch)) return w;
  const t = f.tests.find(t => t.id === branch);
  if (t) setFail(t, fan.fails[branch]);
  fan.branches = fan.branches.filter(id => id !== branch);
  delete fan.fails[branch];
  settle(f, true);
  return n;
}

/** Moves a branch to place `to` (0 = ①). Its connected fail and every other one stay as they are. */
export function moveFanBranch(w: Workspace, owner: string, branch: string, to: number): Workspace {
  const n = structuredClone(w),
    f = flowOf(n, owner),
    found = fanOfBranch(f, branch);
  if (!found) return w;
  const rest = found.fan.branches.filter(id => id !== branch);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, branch);
  found.fan.branches = rest;
  settle(f);
  return n;
}

/** A branch's own fail (undefined empties it: the next branch is tried). */
export function setFanFail(f: BranchFlow, branch: string, target?: BranchTarget) {
  const found = fanOfBranch(f, branch);
  if (!found) return false;
  if (target) found.fan.fails[branch] = {...target};
  else delete found.fan.fails[branch];
  settle(f, !target);
  return true;
}

/** Ends `parent`'s fan: every branch keeps only the fail the user connected. */
export function dropFan(f: BranchFlow, parent: string) {
  const fan = fanOf(f, parent);
  if (!fan) return;
  for (const id of fan.branches) {
    const t = f.tests.find(t => t.id === id);
    if (t) setFail(t, fan.fails[id]);
  }
  f.fans = f.fans!.filter(x => x !== fan);
  if (!f.fans.length) delete f.fans;
}

/** What the canvas shows of a fan: each branch's number, whether the order can reach it, and whether its fail
 *  points back to an earlier branch (after a reorder: the same checks would repeat). */
export function fanState(f: BranchFlow, fan: ConditionFan) {
  const reached = new Set<string>(),
    pending = [fan.branches[0]];
  while (pending.length) {
    const id = pending.pop()!;
    if (!id || reached.has(id) || !fan.branches.includes(id)) continue;
    reached.add(id);
    const t = f.tests.find(t => t.id === id);
    if (t?.fail && 'node' in t.fail) pending.push(t.fail.node);
  }
  return fan.branches.map((id, i) => {
    const own = fan.fails[id];
    return {
      id,
      index: i,
      reached: reached.has(id),
      back: !!own && 'node' in own && fan.branches.indexOf(own.node) >= 0 && fan.branches.indexOf(own.node) <= i,
      ownFail: !!own,
      failTo: own && 'node' in own && fan.branches.includes(own.node) ? fan.branches.indexOf(own.node) : undefined,
      next: fan.branches[i + 1],
    };
  });
}

/** The fans a flow keeps, as the document reads them (an editor-only part of the action's flow). */
export function checkFans(f: any) {
  if (f.fans === undefined) return true;
  return (
    Array.isArray(f.fans) &&
    f.fans.every(
      (x: any) =>
        x &&
        typeof x.parent === 'string' &&
        Array.isArray(x.branches) &&
        x.branches.every((b: any) => typeof b === 'string') &&
        x.fails &&
        typeof x.fails === 'object' &&
        Object.values(x.fails).every(
          (e: any) =>
            e &&
            typeof e === 'object' &&
            Object.keys(e).length === 1 &&
            (typeof e.node === 'string' || typeof e.action === 'string')
        )
    )
  );
}

export type FanBox = {id: string; x: number; y: number; w: number; h: number};
/** A branch card dropped onto another branch of its fan is inserted there (above or below that card's middle);
 *  anywhere else it only moves. `branches` in stored order, the dragged one among them. The dragged card is placed
 *  by its header, where it is held: a card opens when it is picked up, and its middle then falls far below. */
export function fanDropSlot(dragged: FanBox, branches: FanBox[]) {
  const rest = branches.filter(b => b.id !== dragged.id),
    cx = dragged.x + dragged.w / 2,
    cy = dragged.y + Math.min(dragged.h, 48) / 2;
  for (const o of rest) {
    const inside = cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h;
    if (!inside || Math.abs(cx - (o.x + o.w / 2)) >= 115) continue;
    const below = cy > o.y + o.h / 2;
    return {at: rest.indexOf(o) + (below ? 1 : 0), x: o.x - 8, y: below ? o.y + o.h + 6 : o.y - 10, w: o.w + 16};
  }
}
/** After an insert the branch cards trade places: the places, top to bottom, taken in the new order, each pushed
 *  below the card before it when that one is taller (`heights`, a 40 gap as in arrange.ts). */
export function fanSlots(
  order: string[],
  places: Record<string, {x: number; y: number}>,
  heights: Record<string, number> = {}
) {
  const sorted = order
    .map(id => places[id])
    .filter(Boolean)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  let end = -Infinity;
  return Object.fromEntries(
    order.flatMap((id, i) => {
      const p = sorted[i];
      if (!p) return [];
      const y = Math.max(p.y, end + 40);
      end = y + (heights[id] ?? 0);
      return [[id, {x: p.x, y}]];
    })
  );
}
