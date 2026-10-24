import type {Workspace, Action} from '../workspace.ts';
import type {BranchFlow, BranchTest} from './conditions.ts';
import {branchId} from './conditions.ts';
import {applyFans} from './conditionFans.ts';
import {tr} from '../i18n/korean.ts';

// Conditions belong to the lines (docs/mockup-free-conditions): a condition is judged when a start (or a key/event
// transition into its action) reaches it through the lines; otherwise it is loose. The project still keeps every
// condition in some action's flow (the XML needs it there), but which one is an implementation detail fixed when a
// line arrives and undone when it goes.

/** The tests a flow reaches from these roots: pass/fail routes to other tests and group operands. */
export function reachTests(f: BranchFlow | undefined, roots: string[]): Set<string> {
  const seen = new Set<string>(),
    pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!,
      t = f?.tests.find(t => t.id === id);
    if (!t || seen.has(id)) continue;
    seen.add(id);
    for (const e of [t.pass, t.fail]) if (e && 'node' in e) pending.push(e.node);
    pending.push(...(t.operands ?? []));
    // A fan's branches are each a line from its parent, a later one too when an earlier fail leaves the chain.
    pending.push(...(f?.fans?.find(x => x.parent === id)?.branches ?? []));
  }
  return seen;
}
const startCard = (a: Action) => `start:${a.uid}|${a.config.start.mode === 'event' ? 'markerReceive' : 'keyInput'}`;
/** The words a start goes by on a card: its event or its key. */
function startLabel(a: Action): string {
  const s = a.config.start;
  if (s.mode === 'event') return s.event;
  const input = a.config.inputs.find(i => i.id === s.input);
  return input?.key || input?.label || s.input || tr('시작 키');
}
/** Whether an action's own start is in use: set, its line not cut, its flow not left without one. */
export function startInUse(w: Workspace, a: Action): boolean {
  if (a.config.start.mode === 'none' || a.flow?.unlinked) return false;
  const card = startCard(a);
  return !w.disconnections?.some(c => c.bindings.some(b => b.source === card));
}
/** Where an action's judgement starts: its own entry, or the condition it follows in another action's flow. */
export function judgementRoot(w: Workspace, a: Action): {owner: string; test: string} | undefined {
  const f = a.flow;
  if (!f || f.unlinked) return;
  if (f.follow) {
    const owner = w.actions.find(x => x.uid === f.follow!.owner);
    return owner?.flow?.tests.some(t => t.id === f.follow!.test) ? {...f.follow} : undefined;
  }
  return f.tests.some(t => t.id === f.entry) ? {owner: a.uid, test: f.entry} : undefined;
}
/** For each condition card (branch id), the starts and transitions that make it judge, in words. */
export function conditionStarts(w: Workspace): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const mark = (root: {owner: string; test: string}, label: string) => {
    const f = w.actions.find(a => a.uid === root.owner)?.flow;
    for (const id of reachTests(f, [root.test])) {
      const key = branchId(root.owner, id),
        list = out.get(key) ?? [];
      if (!list.includes(label)) list.push(label);
      out.set(key, list);
    }
  };
  for (const a of w.actions) {
    const root = judgementRoot(w, a);
    if (!root) continue;
    if (startInUse(w, a)) mark(root, startLabel(a));
    for (const l of w.links)
      if (l.to === a.uid)
        mark(root, l.mode === 'event' ? l.event : a.config.inputs.find(i => i.id === l.input)?.key || l.input);
  }
  return out;
}
export const isLoose = (w: Workspace, owner: string, test: string) => !conditionStarts(w).has(branchId(owner, test));

/** Moves the conditions reached from `test` in `from`'s flow into `to`'s flow under ids free there (route and
 *  operand ids follow). With `copy` the originals stay; otherwise those no longer reached from `from`'s own
 *  judgement leave it, and routes that led to them are emptied. Returns each moved id's new one. Mutates `w`. */
export function transplant(w: Workspace, from: string, test: string, to: string, copy = false): Map<string, string> {
  const source = w.actions.find(a => a.uid === from)!,
    target = w.actions.find(a => a.uid === to)!;
  const f = source.flow!,
    moved = reachTests(f, [test]);
  target.flow ??= {entry: '', tests: [], detached: true};
  const g = target.flow,
    taken = new Set(g.tests.map(t => t.id)),
    ids = new Map<string, string>();
  for (const id of moved) {
    let next = id,
      i = 1;
    while (taken.has(next)) next = 'Condition' + i++;
    taken.add(next);
    ids.set(id, next);
  }
  const map = (e: BranchTest['pass']) => (e && 'node' in e ? {node: ids.get(e.node)!} : e && {...e});
  for (const t of f.tests)
    if (moved.has(t.id)) {
      const c: BranchTest = {...structuredClone(t), id: ids.get(t.id)!};
      if (t.pass) c.pass = map(t.pass);
      if (t.fail) c.fail = map(t.fail);
      if (t.operands) c.operands = t.operands.map(o => ids.get(o)!);
      g.tests.push(c);
    }
  for (const fan of f.fans ?? [])
    if (moved.has(fan.parent))
      (g.fans ??= []).push({
        parent: ids.get(fan.parent)!,
        branches: fan.branches.map(b => ids.get(b) ?? b),
        fails: Object.fromEntries(Object.entries(fan.fails).map(([k, v]) => [ids.get(k) ?? k, map(v)!])),
      });
  if (!copy) {
    const own = judgementRoot(w, source),
      kept = own?.owner === from ? reachTests(f, [own.test]) : new Set<string>();
    const gone = new Set([...moved].filter(id => !kept.has(id)));
    f.tests = f.tests.filter(t => !gone.has(t.id));
    for (const t of f.tests) {
      for (const port of ['pass', 'fail'] as const) {
        const e = t[port];
        if (e && 'node' in e && gone.has(e.node)) delete t[port];
      }
      if (t.operands) t.operands = t.operands.filter(o => !gone.has(o));
    }
    if (f.fans) {
      f.fans = f.fans.filter(x => !gone.has(x.parent));
      for (const x of f.fans) x.branches = x.branches.filter(b => !gone.has(b));
      // A fan left with one branch is a plain route again; its kept fails into what left are dropped.
      applyFans(f);
    }
    if (gone.has(f.entry)) f.entry = '';
    // Starts that followed what moved follow it where it went; the one it went to judges it as its own.
    for (const a of w.actions) {
      const follow = a.flow?.follow;
      if (follow?.owner !== from || !gone.has(follow.test)) continue;
      if (a.uid !== to) a.flow!.follow = {owner: to, test: ids.get(follow.test)!};
      else {
        delete a.flow!.follow;
        a.flow!.entry ||= ids.get(follow.test)!;
      }
    }
    // A flow left with nothing of its own: only a start that goes nowhere keeps it (its unlinked mark). A selecting
    // action (no HKX) keeps that mark too: with no flow it would read as an HKX card with its file missing. An HKX
    // card, its file chosen or not, is just itself again.
    if (!f.tests.length && !f.unlinked && !f.follow) {
      if (!f.selects) delete source.flow;
      else source.flow = {entry: '', tests: [], unlinked: true, selects: true};
    }
  }
  return ids;
}

/** Before `owner` goes: the conditions another start follows in its flow are that start's own now (its line still
 *  reaches them), and later starts following the same ones follow it there. What stays is `owner`'s alone. */
export function handOverFollowed(w: Workspace, owner: string): Workspace {
  if (!w.actions.some(a => a.uid !== owner && a.flow?.follow?.owner === owner)) return w;
  const n = structuredClone(w),
    source = n.actions.find(a => a.uid === owner);
  if (!source?.flow) return w;
  const moved: {to: string; ids: Map<string, string>}[] = [];
  for (const a of n.actions) {
    const follow = a.flow?.follow;
    if (a.uid === owner || follow?.owner !== owner) continue;
    const prior = moved.find(m => m.ids.has(follow.test));
    if (prior) {
      a.flow!.follow = {owner: prior.to, test: prior.ids.get(follow.test)!};
      continue;
    }
    if (!source.flow.tests.some(t => t.id === follow.test)) continue;
    const ids = transplant(n, owner, follow.test, a.uid, true),
      f = a.flow!;
    f.entry = ids.get(follow.test)!;
    delete f.follow;
    delete f.detached;
    delete f.unlinked;
    moved.push({to: a.uid, ids});
  }
  const handed = new Set(moved.flatMap(m => [...m.ids.keys()])),
    f = source.flow;
  f.tests = f.tests.filter(t => !handed.has(t.id));
  for (const t of f.tests) {
    for (const port of ['pass', 'fail'] as const) {
      const e = t[port];
      if (e && 'node' in e && handed.has(e.node)) delete t[port];
    }
    if (t.operands) t.operands = t.operands.filter(o => !handed.has(o));
  }
  if (f.fans) {
    f.fans = f.fans.filter(x => !handed.has(x.parent));
    for (const x of f.fans) x.branches = x.branches.filter(b => !handed.has(b));
    applyFans(f);
  }
  if (handed.has(f.entry)) f.entry = '';
  return n;
}
