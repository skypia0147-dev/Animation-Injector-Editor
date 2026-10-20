import type {Workspace} from '../workspace.ts';
import type {BranchTarget} from './conditions.ts';
import {tr} from '../i18n/korean.ts';

export function setBranchTarget(
  w: Workspace,
  owner: string,
  key: string,
  port: 'pass' | 'fail',
  target?: BranchTarget
): Workspace {
  const action = w.actions.find(a => a.uid === owner),
    flow = action?.flow;
  if (!action || !flow?.tests.some(t => t.id === key)) throw Error(tr('수정할 조건이 없습니다.'));
  if (target && flow.tests.some(t => t.operands?.includes(key)))
    throw Error(tr('구성 조건은 통과·실패 분기를 갖지 않아야 합니다.'));
  if (target && 'node' in target) {
    if (!flow.tests.some(t => t.id === target.node)) throw Error(tr('연결할 조건이 없습니다.'));
    const pending = [target.node],
      seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === key) throw Error(tr('조건 분기를 순환 연결할 수 없습니다.'));
      if (seen.has(id)) continue;
      seen.add(id);
      const test = flow.tests.find(t => t.id === id);
      for (const next of [test?.pass, test?.fail]) if (next && 'node' in next) pending.push(next.node);
      pending.push(...(test?.operands ?? []));
    }
  } else if (target) {
    const destination = w.actions.find(a => a.uid === target.action);
    if (!destination || (!action.pair && destination.pair) || (destination.flow && destination.uid !== owner))
      throw Error(tr('다른 분기가 없는 HKX로 연결하세요. 페어 목적지는 페어 분기에서 선택합니다.'));
  }
  const next = structuredClone(w);
  const test = next.actions.find(a => a.uid === owner)!.flow!.tests.find(t => t.id === key)!;
  if (target) test[port] = {...target};
  else delete test[port];
  return next;
}

export function setConditionOperands(w: Workspace, owner: string, key: string, operands: string[]): Workspace {
  const flow = w.actions.find(a => a.uid === owner)?.flow;
  const group = flow?.tests.find(t => t.id === key);
  if (!flow || !group || !['all', 'any', 'not'].includes(group.kind))
    throw Error(tr('같은 진입 경로의 조건 그룹에 연결하세요.'));
  const ids = [...new Set(operands)];
  if (group.kind === 'not' && ids.length > 1) throw Error(tr('NOT은 한 항목만 사용합니다.'));
  const pending = [...ids],
    seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === key) throw Error(tr('조건 그룹을 순환 연결할 수 없습니다.'));
    if (seen.has(id)) continue;
    seen.add(id);
    const child = flow.tests.find(t => t.id === id);
    if (!child || child.pass || child.fail) throw Error(tr('구성 조건은 통과·실패 분기를 갖지 않아야 합니다.'));
    pending.push(...(child.operands ?? []));
  }
  const next = structuredClone(w);
  next.actions.find(a => a.uid === owner)!.flow!.tests.find(t => t.id === key)!.operands = ids;
  return next;
}

export function deleteCondition(w: Workspace, owner: string, key: string): Workspace {
  const flow = w.actions.find(a => a.uid === owner)?.flow;
  if (!flow?.tests.some(t => t.id === key)) return w;
  const next = structuredClone(w),
    action = next.actions.find(a => a.uid === owner)!;
  action.flow!.tests = action.flow!.tests.filter(t => t.id !== key);
  for (const test of action.flow!.tests) {
    if (test.operands) test.operands = test.operands.filter(id => id !== key);
    for (const port of ['pass', 'fail'] as const) {
      const target = test[port];
      if (target && 'node' in target && target.node === key) delete test[port];
    }
  }
  if (!action.flow!.tests.length) delete action.flow;
  else if (action.flow!.entry === key) action.flow!.entry = '';
  return next;
}
