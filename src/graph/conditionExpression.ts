import {extensionConditions, extensionSummary} from './conditionExtensions.ts';
import type {Workspace} from '../workspace.ts';
import type {BranchFlow, BranchTest} from './conditions.ts';
import {tr} from '../i18n/korean.ts';

export type Expression = {settings: Omit<BranchTest, 'id' | 'operands' | 'pass' | 'fail'>; children: Expression[]};
export const conditionNames: Record<string, string> = {
  ...Object.fromEntries(Object.entries(extensionConditions).map(([k, v]) => [k, v.label])),
  get all() {
    return tr('모두 충족 AND');
  },
  get any() {
    return tr('하나 이상 충족 OR');
  },
  not: 'NOT',
  get air() {
    return tr('공중');
  },
  get weaponDrawn() {
    return tr('무기 뽑음');
  },
  get combat() {
    return tr('전투 중');
  },
  get alive() {
    return tr('살아 있음');
  },
  get stamina() {
    return tr('스태미나');
  },
  get magicka() {
    return tr('매지카');
  },
  get space() {
    return tr('공간 확보');
  },
  get ground() {
    return tr('지면 확보');
  },
  get unarmedRight() {
    return tr('오른손 맨손');
  },
  get magicEffect() {
    return tr('마법 효과');
  },
  get global() {
    return tr('전역 값');
  },
  get equippedType() {
    return tr('장착 종류');
  },
  get attackState() {
    return tr('공격 상태');
  },
  get sneaking() {
    return tr('은신 중');
  },
  get female() {
    return tr('여성');
  },
};
export function readExpression(f: BranchFlow, id: string, seen = new Set<string>()): Expression {
  if (seen.has(id)) throw Error(tr('조건 그룹이 순환합니다.'));
  seen.add(id);
  const t = f.tests.find(t => t.id === id);
  if (!t) throw Error(tr('구성 조건을 찾지 못했습니다.'));
  const {id: _, operands, pass, fail, ...settings} = t;
  const result = {
    settings: structuredClone(settings),
    children: (operands ?? []).map(id => readExpression(f, id, seen)),
  };
  seen.delete(id);
  return result;
}
export function insertExpression(f: BranchFlow, e: Expression): string {
  let i = 1;
  while (f.tests.some(t => t.id === 'Condition' + i)) i++;
  const t: BranchTest = {...structuredClone(e.settings), id: 'Condition' + i};
  f.tests.push(t);
  if (e.children.length || ['all', 'any'].includes(t.kind)) t.operands = e.children.map(c => insertExpression(f, c));
  return t.id;
}
function prune(f: BranchFlow, candidates: Set<string>) {
  let changed = true;
  while (changed) {
    changed = false;
    const used = new Set([f.entry]);
    for (const t of f.tests) {
      for (const c of t.operands ?? []) used.add(c);
      for (const end of [t.pass, t.fail]) if (end && 'node' in end) used.add(end.node);
    }
    f.tests = f.tests.filter(t => {
      if (candidates.has(t.id) && !used.has(t.id)) {
        changed = true;
        return false;
      }
      return true;
    });
  }
}
function descendants(f: BranchFlow, id: string, out = new Set<string>()) {
  if (out.has(id)) return out;
  out.add(id);
  for (const c of f.tests.find(t => t.id === id)?.operands ?? []) descendants(f, c, out);
  return out;
}
export type ExpressionCommand =
  | {type: 'add'; parent: string; group?: boolean; expression?: Expression}
  | {type: 'remove'; parent: string; id: string}
  | {type: 'move'; parent: string; id: string; to: string; index: number}
  | {type: 'wrap'; id: string; mode: 'all' | 'any'};
export function editExpression(w: Workspace, owner: string, command: ExpressionCommand): Workspace {
  const n = structuredClone(w),
    f = n.actions.find(a => a.uid === owner)?.flow;
  if (!f) throw Error(tr('조건 분기를 선택하세요.'));
  const find = (id: string) => {
    const t = f.tests.find(t => t.id === id);
    if (!t) throw Error(tr('조건을 찾지 못했습니다.'));
    return t;
  };
  if (command.type === 'wrap') {
    const t = find(command.id);
    if (['all', 'any'].includes(t.kind)) {
      t.kind = command.mode;
      return n;
    }
    const child = insertExpression(f, readExpression(f, t.id));
    const {id, pass, fail, label, enabled} = t;
    Object.keys(t).forEach(k => delete (t as any)[k]);
    Object.assign(t, {
      id,
      label,
      enabled,
      kind: command.mode,
      subject: 'self',
      minimum: 0,
      operands: [child],
      ...(pass ? {pass} : {}),
      ...(fail ? {fail} : {}),
    });
    return n;
  }
  const p = find(command.parent);
  if (!['all', 'any'].includes(p.kind)) throw Error(tr('조건 그룹에 추가하세요.'));
  if (command.type === 'add') {
    const id = insertExpression(
      f,
      command.expression ?? {
        settings: {kind: command.group ? 'all' : 'alive', subject: 'self', minimum: 0},
        children: [],
      }
    );
    p.operands = [...(p.operands ?? []), id];
    return n;
  }
  if (!p.operands?.includes(command.id)) throw Error(tr('이 그룹의 구성 조건이 아닙니다.'));
  if (command.type === 'remove') {
    const removed = descendants(f, command.id);
    p.operands = p.operands.filter(id => id !== command.id);
    prune(f, removed);
    return n;
  }
  const target = find(command.to);
  if (!['all', 'any'].includes(target.kind) || descendants(f, command.id).has(target.id))
    throw Error(tr('자기 자신이나 자식 그룹으로 이동할 수 없습니다.'));
  p.operands = p.operands.filter(id => id !== command.id);
  target.operands ??= [];
  if (!target.operands.includes(command.id))
    target.operands.splice(Math.max(0, Math.min(command.index, target.operands.length)), 0, command.id);
  return n;
}
// Disabled children are authoring data only. Empty active groups remain invalid.
export function activeConditionFlow(f: BranchFlow): BranchFlow {
  if (!f.tests.some(t => t.id === f.entry)) return f;
  const tests = f.tests.map(t => ({
    ...t,
    ...(t.operands ? {operands: t.operands.filter(id => f.tests.find(c => c.id === id)?.enabled !== false)} : {}),
  }));
  const used = new Set([f.entry]),
    queue = [f.entry];
  for (let i = 0; i < queue.length; i++) {
    const t = tests.find(t => t.id === queue[i]);
    if (!t) continue;
    for (const id of [...(t.operands ?? []), ...[t.pass, t.fail].flatMap(e => (e && 'node' in e ? [e.node] : []))])
      if (!used.has(id)) {
        used.add(id);
        queue.push(id);
      }
  }
  return {...f, tests: tests.filter(t => used.has(t.id))};
}
export function expressionSummary(f: BranchFlow, id: string): string {
  const t = f.tests.find(t => t.id === id);
  if (!t) return '';
  const detail = extensionSummary(t);
  if (detail) return (t.negate ? 'NOT · ' : '') + detail;
  const e = readExpression(f, id);
  let count = 0;
  const visit = (e: Expression) => {
    if (e.settings.enabled === false) return;
    if (e.children.length) e.children.forEach(visit);
    else if (!['all', 'any'].includes(e.settings.kind)) count++;
  };
  visit(e);
  return tr('{v0}{v1} · 조건 {count}개', {v0: t.negate ? 'NOT · ' : '', v1: conditionNames[t.kind] ?? t.kind, count});
}
