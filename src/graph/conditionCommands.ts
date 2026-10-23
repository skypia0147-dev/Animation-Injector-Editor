import type {Workspace} from '../workspace.ts';
import type {BranchTarget} from './conditions.ts';
import {tr} from '../i18n/korean.ts';
import {isLoose, judgementRoot} from './conditionBinding.ts';
import {addFanBranch, applyFans, dropFan, fanOf, fanOfBranch, setFanFail} from './conditionFans.ts';

/** `mode` 'add': a line drawn from a pass that already leads to a condition, onto another condition, fans out
 *  (graph/conditionFans.ts) instead of replacing it. */
export function setBranchTarget(
  w: Workspace,
  owner: string,
  key: string,
  port: 'pass' | 'fail',
  target?: BranchTarget,
  mode?: 'add'
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
    // A loose condition is no action's yet (docs/mockup-free-conditions ⑥): pair or not is checked once a start
    // reaches it. A destination with a judgement of its own is written split (graph/conditions.ts
    // splitSelfJudgements); one that only selects has no HKX to play.
    if (
      !destination ||
      (!action.pair && destination.pair && !isLoose(w, owner, key)) ||
      (destination.uid !== owner && judgementRoot(w, destination) && !destination.config.steps.some(s => s.clip))
    )
      throw Error(tr('다른 분기가 없는 HKX로 연결하세요. 페어 목적지는 페어 분기에서 선택합니다.'));
  }
  const current = flow.tests.find(t => t.id === key)![port];
  if (
    mode === 'add' &&
    port === 'pass' &&
    target &&
    'node' in target &&
    (fanOf(flow, key) || (current && 'node' in current && current.node !== target.node))
  )
    return addFanBranch(w, owner, key, target.node);
  const next = structuredClone(w);
  const f = next.actions.find(a => a.uid === owner)!.flow!;
  // A fanned branch's fail is its own connection; the chain is rewritten from the fan.
  if (port === 'fail' && fanOfBranch(f, key)) {
    setFanFail(f, key, target);
    return next;
  }
  // A fan's pass chosen or cleared as a whole: the fan ends, each branch keeping only its own fail.
  if (port === 'pass') dropFan(f, key);
  const test = f.tests.find(t => t.id === key)!;
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
  // The first condition gone: the start goes nowhere and what followed it is loose (docs/mockup-free-conditions
  // ⑥). A start that followed this condition from another action goes nowhere too.
  const first = action.flow!.entry === key;
  if (first) {
    action.flow!.entry = '';
    action.flow!.unlinked = true;
    delete action.flow!.detached;
  }
  for (const other of next.actions)
    if (other.flow?.follow?.owner === owner && other.flow.follow.test === key) {
      delete other.flow.follow;
      other.flow.entry = '';
      other.flow.unlinked = true;
    }
  if (!action.flow!.tests.length && !first) delete action.flow;
  else applyFans(action.flow!);
  return next;
}
