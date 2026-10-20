import type {Workspace} from '../workspace.ts';
import type {BranchFlow, BranchTest} from './conditions.ts';
import {branchId} from './conditions.ts';
import type {ViewGraph} from './navigation.ts';
import {graphPosition} from './projection.ts';
import {tr} from '../i18n/korean.ts';
export const tableId = (owner: string) => 'conditionTable:' + owner;
export function groupConditions(w: Workspace): Workspace {
  return {...w, conditionTables: w.actions.filter(a => a.flow).map(a => a.uid)};
}
export function tableRows(f: BranchFlow): BranchTest[] {
  const result: BranchTest[] = [],
    seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const t = f.tests.find(t => t.id === id);
    if (!t) return;
    result.push(t);
    for (const dest of [t.pass, t.fail]) if (dest && 'node' in dest) visit(dest.node);
  };
  visit(f.entry);
  return result;
}
export function linearRows(f: BranchFlow): BranchTest[] | undefined {
  const rows: BranchTest[] = [],
    seen = new Set<string>();
  let id = f.entry;
  while (id) {
    if (seen.has(id)) return;
    seen.add(id);
    const t = f.tests.find(t => t.id === id);
    if (!t || (t.pass && 'node' in t.pass)) return;
    rows.push(t);
    id = t.fail && 'node' in t.fail ? t.fail.node : '';
  }
  return rows;
}
export function reorderRow(w: Workspace, owner: string, id: string, delta: number): Workspace {
  const n = structuredClone(w),
    f = n.actions.find(a => a.uid === owner)!.flow!,
    rows = linearRows(f);
  if (!rows) throw Error(tr('복합 경로는 통과·실패 연결로 순서를 변경하세요.'));
  const index = rows.findIndex(t => t.id === id),
    target = index + delta;
  if (index < 0 || target < 0 || target >= rows.length) return w;
  const fallback = rows.at(-1)!.fail;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  f.entry = rows[0].id;
  rows.forEach((r, i) => (r.fail = i + 1 < rows.length ? {node: rows[i + 1].id} : fallback));
  return n;
}
export function addTableRow(w: Workspace, owner: string): Workspace {
  const n = structuredClone(w),
    a = n.actions.find(a => a.uid === owner)!;
  a.flow ??= {entry: '', tests: []};
  const f = a.flow;
  let i = 1;
  while (f.tests.some(t => t.id === 'Choice' + i)) i++;
  const id = 'Choice' + i;
  f.tests.push({id, kind: 'air', subject: 'self', minimum: 0, ...(f.entry ? {fail: {node: f.entry}} : {})});
  f.entry = id;
  delete f.detached;
  n.conditionTables = [...new Set([...(n.conditionTables ?? []), owner])];
  return n;
}
export function removeTableRow(w: Workspace, owner: string, id: string): Workspace {
  const n = structuredClone(w),
    a = n.actions.find(a => a.uid === owner)!,
    f = a.flow!,
    t = f.tests.find(t => t.id === id);
  if (!t) return w;
  if (f.tests.some(t => t.operands?.includes(id)))
    throw Error(tr('다른 조건이 사용하는 항목은 먼저 참조를 해제하세요.'));
  if (f.entry === id && (!t.fail || !('node' in t.fail)))
    throw Error(tr('마지막 진입 규칙은 삭제 대신 조건 묶음을 펼쳐 편집하세요.'));
  for (const r of f.tests)
    for (const p of ['pass', 'fail'] as const) if (r[p] && 'node' in r[p] && r[p].node === id) r[p] = t.fail;
  if (f.entry === id && t.fail && 'node' in t.fail) f.entry = t.fail.node;
  f.tests = f.tests.filter(r => r.id !== id);
  return n;
}
export function tableProjection(w: Workspace, g: ViewGraph): ViewGraph {
  const nodes = [...g.nodes],
    edges = g.edges.map(e => ({...e})),
    hide = new Set<string>();
  for (const owner of w.conditionTables ?? []) {
    const a = w.actions.find(a => a.uid === owner);
    if (!a?.flow) continue;
    const reachable = new Set(tableRows(a.flow).map(t => t.id));
    const queue = [...reachable];
    for (let i = 0; i < queue.length; i++)
      for (const operand of a.flow.tests.find(t => t.id === queue[i])?.operands ?? [])
        if (!reachable.has(operand)) {
          reachable.add(operand);
          queue.push(operand);
        }
    const ids = new Set([...reachable].map(id => branchId(owner, id))),
      first = nodes.find(n => n.id === branchId(owner, a.flow!.entry));
    if (!first) continue;
    const id = tableId(owner),
      outputs: `choice:${string}`[] = [];
    for (const e of edges)
      if (ids.has(e.source) && !ids.has(e.target)) {
        const key = e.source.slice(('flow:' + owner + ':').length),
          pin = ('choice:' + key + ':' + e.pin) as `choice:${string}`;
        outputs.push(pin);
        e.source = id;
        e.pin = pin;
      }
    for (const e of edges) if (ids.has(e.target) && !ids.has(e.source) && e.source !== id) e.target = id;
    // An unconnected pass pin lets authors attach a new candidate directly.
    for (const r of tableRows(a.flow)) if (!r.pass) outputs.push(`choice:${r.id}:pass`);
    const last = linearRows(a.flow)?.at(-1);
    if (last && !last.fail) outputs.push(`choice:${last.id}:fail`);
    const orderedPorts = tableRows(a.flow).flatMap(r => [`choice:${r.id}:pass`, `choice:${r.id}:fail`]);
    outputs.sort((a, b) => orderedPorts.indexOf(a) - orderedPorts.indexOf(b));
    nodes.push({
      ...first,
      id,
      kind: 'conditionTable',
      title: tr('조건 분기 · ') + a.config.name,
      summary: tableRows(a.flow).length + tr('개 규칙'),
      outputs: [...new Set(outputs)],
      position: graphPosition(w, {kind: 'root'}, id, first.position),
    });
    ids.forEach(id => hide.add(id));
  }
  return {
    nodes: nodes.filter(n => !hide.has(n.id)),
    edges: edges.filter(e => !hide.has(e.source) && !hide.has(e.target)),
  };
}
