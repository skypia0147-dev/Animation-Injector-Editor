import {
  extensionKinds,
  extensionError,
  extensionAttrs,
  formKinds,
  type ExtensionKind,
  type Comparison,
} from './conditionExtensions.ts';
import {activeConditionFlow} from './conditionExpression.ts';
import {equippedTypes, attackStates} from '../runtimeExtensions.ts';
import type {Workspace} from '../workspace.ts';
import {node} from '../xml.ts';
import {tr} from '../i18n/korean.ts';
export type BranchTarget = {node: string} | {action: string};
export type SpaceDirection = 'partnerForward' | 'partnerBack' | 'partnerRight' | 'partnerLeft';
export type BranchTest = {
  id: string;
  label?: string;
  enabled?: boolean;
  negate?: boolean;
  option?: string;
  compare?: Comparison;
  measure?: 'current' | 'percent';
  value?: number;
  upper?: number;
  kind:
    | ExtensionKind
    | 'all'
    | 'any'
    | 'not'
    | 'air'
    | 'weaponDrawn'
    | 'combat'
    | 'alive'
    | 'stamina'
    | 'magicka'
    | 'space'
    | 'ground'
    | 'unarmedRight'
    | 'magicEffect'
    | 'global'
    | 'equippedType'
    | 'attackState'
    | 'sneaking'
    | 'female';
  hand?: 'left' | 'right';
  equipmentType?: (typeof equippedTypes)[number];
  attackState?: (typeof attackStates)[number];
  operands?: string[];
  subject: 'self' | 'partner';
  minimum: number;
  form?: {plugin: string; id: string};
  equals?: number;
  space?: {candidate: string; distance: number; direction: SpaceDirection};
  ground?: {maxRise: number; maxDrop: number; maxSlope: number; radius: number};
  pass?: BranchTarget;
  fail?: BranchTarget;
};
export type BranchFlow = {entry: string; tests: BranchTest[]; detached?: boolean};
// NOT is an editor property; the runtime still evaluates its three-valued Not node.
export function foldNotConditions(w: Workspace): Workspace {
  for (const a of w.actions) {
    const f = a.flow;
    if (!f) continue;
    for (const t of f.tests)
      if (t.kind === 'unarmedRight') {
        t.kind = 'equippedType';
        t.hand = 'right';
        t.equipmentType = 'unarmed';
      }
    const original = new Map(f.tests.map(t => [t.id, t])),
      consumed = new Set<string>();
    const resolve = (t: BranchTest, seen = new Set<string>()): BranchTest => {
      if (t.kind !== 'not') return t;
      if (seen.has(t.id) || t.operands?.length !== 1) throw Error(tr('NOT 구성 조건이 잘못되었습니다.'));
      seen.add(t.id);
      const child = original.get(t.operands[0]);
      if (!child || child.pass || child.fail) throw Error(tr('NOT 구성 조건은 분기 연결 없이 사용하세요.'));
      const resolved = resolve(child, seen);
      consumed.add(child.id);
      const result: BranchTest = {...resolved, id: t.id};
      delete result.pass;
      delete result.fail;
      if (t.pass) result.pass = t.pass;
      if (t.fail) result.fail = t.fail;
      if (!!resolved.negate === !!t.negate) result.negate = true;
      else delete result.negate;
      return result;
    };
    f.tests = f.tests.map(t => resolve(t));
    const referenced = new Set([f.entry]);
    for (const t of f.tests) {
      for (const id of t.operands ?? []) referenced.add(id);
      for (const e of [t.pass, t.fail]) if (e && 'node' in e) referenced.add(e.node);
    }
    f.tests = f.tests.filter(t => !consumed.has(t.id) || referenced.has(t.id));
  }
  return w;
}
export const branchId = (owner: string, id: string) => `flow:${owner}:${id}`;
// Detached authoring nodes stay in the project but never become runtime conditions.
// A missing entry on a previously connected flow remains a compilation error.
export function lowerFlowDrafts(w: Workspace): {workspace: Workspace; omitted: string[]} {
  w = {...w, actions: w.actions.map(a => (a.flow ? {...a, flow: activeConditionFlow(a.flow)} : a))};
  const omitted: string[] = [];
  const actions = w.actions.map(a => {
    const f = a.flow;
    if (!f) return a;
    if (!f.entry && f.detached === true) {
      omitted.push(...f.tests.map(t => branchId(a.uid, t.id)));
      const {flow, ...rest} = a;
      return rest;
    }
    if (!f.tests.some(t => t.id === f.entry)) return a;
    const reachable = new Set<string>(),
      pending = [f.entry];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const t = f.tests.find(t => t.id === id);
      if (!t) continue;
      pending.push(...(t.operands ?? []));
      for (const end of [t.pass, t.fail]) if (end && 'node' in end) pending.push(end.node);
    }
    const tests = f.tests.filter(t => reachable.has(t.id));
    if (tests.length === f.tests.length) return a;
    omitted.push(...f.tests.filter(t => !reachable.has(t.id)).map(t => branchId(a.uid, t.id)));
    return {...a, flow: {...f, tests}};
  });
  return {workspace: omitted.length ? {...w, actions} : w, omitted};
}
export function checkFlows(w: Workspace): string[] {
  const errors: string[] = [];
  for (const a of w.actions)
    if (a.flow) {
      const f = a.flow,
        ids = new Set(f.tests.map(t => t.id));
      if (f.tests.length > 80 || ids.size !== f.tests.length || !ids.has(f.entry))
        errors.push(tr('조건 ID 또는 시작 조건이 잘못되었습니다.'));
      const runtimeCount = f.tests.reduce(
        (count, t) => count + 1 + (t.negate ? 1 : 0) + [t.pass, t.fail].filter(e => e && 'action' in e).length,
        0
      );
      if (runtimeCount > 256) errors.push(tr('조건·반전·동작 연결 합계가 런타임 한도 256개를 초과합니다.'));
      const visiting = new Set<string>(),
        done = new Set<string>();
      const visit = (id: string): void => {
        if (visiting.has(id)) {
          errors.push(tr('조건 연결이 순환합니다.'));
          return;
        }
        if (done.has(id)) return;
        const t = f.tests.find(t => t.id === id);
        if (!t) {
          errors.push(tr('연결된 조건이 없습니다.'));
          return;
        }
        visiting.add(id);
        if (t.enabled === false)
          errors.push(tr('진입 또는 분기 경로의 조건은 비활성화할 수 없습니다. 구성 조건에서 제외하세요.'));
        if (t.negate !== undefined && typeof t.negate !== 'boolean')
          errors.push(tr('NOT 옵션은 체크 값이어야 합니다.'));
        if (
          !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) ||
          ![
            'air',
            'weaponDrawn',
            'combat',
            'alive',
            'stamina',
            'magicka',
            'space',
            'ground',
            'unarmedRight',
            'magicEffect',
            'global',
            'equippedType',
            'attackState',
            'sneaking',
            'female',
            'all',
            'any',
            'not',
            ...extensionKinds,
          ].includes(t.kind) ||
          !['self', 'partner'].includes(t.subject)
        )
          errors.push(tr('지원하지 않는 조건입니다.'));
        if (['all', 'any', 'not'].includes(t.kind)) {
          const operands = t.operands ?? [];
          if (
            !operands.length ||
            (t.kind === 'not' && operands.length !== 1) ||
            new Set(operands).size !== operands.length
          )
            errors.push(tr('조건 그룹의 항목 수를 확인하세요. NOT은 한 항목만 사용합니다.'));
          for (const child of operands) {
            const c = f.tests.find(x => x.id === child);
            if (c?.pass || c?.fail) errors.push(tr('그룹 구성 조건의 통과·실패 연결을 해제하세요.'));
            visit(child);
          }
        }
        const extendedError = extensionError(t);
        if (extendedError) errors.push(extendedError);
        if (
          t.kind === 'equippedType' &&
          (!['left', 'right'].includes(t.hand ?? '') || !equippedTypes.includes(t.equipmentType!))
        )
          errors.push(tr('검사할 손과 장착 종류를 선택하세요.'));
        if (t.kind === 'attackState' && !attackStates.includes(t.attackState!))
          errors.push(tr('검사할 공격 상태를 선택하세요.'));
        if (formKinds.includes(t.kind)) {
          if (
            !t.form?.plugin ||
            /[\\/\r\n]/.test(t.form.plugin) ||
            !/^0*[0-9a-fA-F]{1,6}$/.test(t.form.id) ||
            parseInt(t.form.id, 16) === 0
          )
            errors.push(tr('플러그인 이름과 로컬 Form ID(16진수)를 확인하세요.'));
          if (
            t.kind === 'global' &&
            (t.subject !== 'self' || !Number.isFinite(t.equals) || Math.abs(t.equals!) > 3.4028234663852886e38)
          )
            errors.push(tr('전역 값의 비교 값을 확인하세요.'));
        }
        if (t.kind === 'space' || t.kind === 'ground') {
          const s = t.space,
            candidate = w.actions.find(x => x.uid === s?.candidate);
          if (!a.pair || !candidate?.pair || candidate.config.kind !== 'single')
            errors.push(tr('공간 검사는 페어 분기에서 검사할 페어 HKX를 지정하세요.'));
          if (
            !s ||
            !Number.isFinite(s.distance) ||
            s.distance < 0 ||
            (s.distance === 0 && t.kind === 'space') ||
            s.distance > 2000 ||
            !['partnerForward', 'partnerBack', 'partnerRight', 'partnerLeft'].includes(s.direction)
          )
            errors.push(tr('검사 방향과 거리(지면 0 이상, 공간 0 초과, 최대 2000)를 확인하세요.'));
          if (t.kind === 'ground' && t.ground) {
            const g = t.ground;
            if (
              ![g.maxRise, g.maxDrop, g.maxSlope, g.radius].every(Number.isFinite) ||
              g.maxRise < 0 ||
              g.maxRise > 200 ||
              g.maxDrop < 0 ||
              g.maxDrop > 500 ||
              g.maxSlope < 0 ||
              g.maxSlope > 80 ||
              g.radius <= 0 ||
              g.radius > 100
            )
              errors.push(tr('지면 검사의 높이·경사·반경을 확인하세요.'));
          }
        }
        if (!Number.isFinite(t.minimum) || t.minimum < 0 || t.minimum > 1000000)
          errors.push(tr('자원 최솟값이 잘못되었습니다.'));
        for (const end of [t.pass, t.fail])
          if (end) {
            if ('node' in end) visit(end.node);
            else {
              const dest = w.actions.find(x => x.uid === end.action);
              if (!dest || (!a.pair && dest.pair) || (dest.flow && dest !== a))
                errors.push(tr('목적지는 다른 분기가 없는 HKX여야 합니다. 페어 목적지는 페어 분기에서 선택하세요.'));
            }
          }
        visiting.delete(id);
        done.add(id);
      };
      for (const t of f.tests) visit(t.id);
      for (const l of w.links.filter(l => l.to === a.uid && l.blend !== undefined)) {
        const source = w.actions.find(x => x.uid === l.from);
        if (
          source?.pair ||
          f.tests.some(t =>
            [t.pass, t.fail].some(
              e => e && 'action' in e && (e.action === l.from || w.actions.find(x => x.uid === e.action)?.pair)
            )
          )
        )
          errors.push(tr('분기 블렌드는 서로 다른 단일 일반 동작 사이에서 사용하세요.'));
      }
    }
  return [...new Set(errors)];
}
// The runtime never pairs with a dead, child, ragdolled or getting-up partner: its target search skips
// them and a partner handed over by an event is refused (standing up only since runtime 0.12.217).
// Returns the raw condition value that means such a partner, if the condition checks one.
function unpairableWhen(t: BranchTest): boolean | undefined {
  if (t.subject !== 'partner') return undefined;
  if (t.kind === 'alive') return false;
  if (t.kind === 'actorStatus' && ['ragdoll', 'recovering', 'child'].includes(t.option ?? '')) return true;
  return undefined;
}
// Routes that reach a paired action only when the partner cannot be paired: that action never starts.
// One warning per condition that forces it and paired destination, on the condition's node.
export function unpairableRoutes(w: Workspace): {node: string; message: string}[] {
  const out: {node: string; message: string}[] = [];
  for (const a of w.actions) {
    const f = a.flow;
    if (!f) continue;
    const tests = new Map(f.tests.map(t => [t.id, t]));
    // Whether condition `id` having `outcome` means an unpairable partner.
    const forces = (id: string, outcome: boolean, depth: number): boolean => {
      const t = tests.get(id);
      if (!t || depth > 80) return false;
      const raw = t.negate ? !outcome : outcome;
      if (t.kind === 'not') return !!t.operands?.length && forces(t.operands[0], !raw, depth + 1);
      if (t.kind === 'all' || t.kind === 'any') {
        const operands = t.operands ?? [];
        // AND true / OR false: every operand has that value, so one forcing operand is enough.
        // AND false / OR true: only some operand has it, so every operand must force it.
        return (t.kind === 'all') === raw
          ? operands.some(o => forces(o, raw, depth + 1))
          : operands.length > 0 && operands.every(o => forces(o, raw, depth + 1));
      }
      return unpairableWhen(t) === raw;
    };
    const reported = new Set<string>(),
      walked = new Set<string>();
    const walk = (id: string, cause: string | undefined, depth: number) => {
      const t = tests.get(id);
      if (!t || depth > 80 || walked.has(id + '|' + (cause ?? ''))) return;
      walked.add(id + '|' + (cause ?? ''));
      for (const outcome of [true, false]) {
        const end = outcome ? t.pass : t.fail;
        if (!end) continue;
        const reason = cause ?? (forces(id, outcome, 0) ? id : undefined);
        if ('node' in end) {
          walk(end.node, reason, depth + 1);
          continue;
        }
        const dest = w.actions.find(x => x.uid === end.action);
        if (!reason || !dest?.pair || reported.has(reason + '|' + dest.uid)) continue;
        reported.add(reason + '|' + dest.uid);
        out.push({
          node: branchId(a.uid, reason),
          message: tr(
            "페어 동작 '{name}'로 가는 이 경로는 상대가 죽었거나 어린이, 래그돌·일어나는 중일 때만 이어지므로 페어가 시작되지 않습니다. 페어 상대는 살아서 서 있어야 합니다(런타임 0.12.217).",
            {name: dest.config.name}
          ),
        });
      }
    };
    walk(f.entry, undefined, 0);
  }
  return out;
}
export function flowXml(w: Workspace, owner: string) {
  const f = w.actions.find(a => a.uid === owner)!.flow!;
  const out = node('Flow', {entry: f.entry});
  let serial = 0;
  const used = new Set(f.tests.map(t => t.id));
  const allocate = (prefix: string) => {
    let id: string;
    do {
      id = prefix + ++serial;
    } while (used.has(id));
    used.add(id);
    return id;
  };
  for (const t of f.tests) {
    const test = node('Test', {
      id: t.id,
      kind: t.kind,
      subject: t.subject,
      ...(['stamina', 'magicka'].includes(t.kind) ? {minimum: t.minimum} : {}),
    });
    Object.assign(test.attrs, extensionAttrs(t));
    if (t.kind === 'equippedType') Object.assign(test.attrs, {hand: t.hand, type: t.equipmentType});
    if (t.kind === 'attackState') test.attrs.state = t.attackState!;
    if (formKinds.includes(t.kind) && t.form) Object.assign(test.attrs, {plugin: t.form.plugin, form: t.form.id});
    if (t.kind === 'global') test.attrs.equals = String(t.equals);
    if ((t.kind === 'space' || t.kind === 'ground') && t.space)
      Object.assign(test.attrs, {
        candidate: w.actions.find(a => a.uid === t.space!.candidate)!.config.actionId,
        distance: String(t.space.distance),
        direction: t.space.direction,
      });
    if (t.kind === 'ground')
      Object.assign(
        test.attrs,
        Object.fromEntries(
          Object.entries(t.ground ?? {maxRise: 20, maxDrop: 40, maxSlope: 45, radius: 20}).map(([k, v]) => [
            k,
            String(v),
          ])
        )
      );
    if (['all', 'any', 'not'].includes(t.kind)) {
      test.name = {all: 'All', any: 'Any', not: 'Not'}[t.kind as 'all' | 'any' | 'not'];
      test.attrs = {id: t.id};
      test.children = (t.operands ?? []).map(id => node('Use', {node: id}));
    }
    out.children.push(test);
    let routed = test;
    if (t.negate) {
      const inner = allocate('Predicate');
      test.attrs.id = inner;
      routed = node('Not', {id: t.id}, [node('Use', {node: inner})]);
      out.children.push(routed);
    }
    for (const port of ['pass', 'fail'] as const) {
      const end = t[port];
      if (!end) continue;
      if ('node' in end) routed.attrs[port] = end.node;
      else {
        const id = allocate('Destination');
        routed.attrs[port] = id;
        out.children.push(node('Play', {id, action: w.actions.find(a => a.uid === end.action)!.config.actionId}));
      }
    }
  }
  return out;
}
