import {setRecoveryRule} from '../clipRecovery.ts';
import {defaultFireArrow} from '../runtimeExtensions.ts';
import {defaultCarryFix} from '../carry.ts';
import type {Action, Workspace} from '../workspace.ts';
import {addAction, defaultCamera} from '../workspace.ts';
import {addGraphItem, graphPosition} from './projection.ts';
import {add, rows} from '../timeline/model.ts';
import {createProject, mark} from '../model.ts';
import type {GraphRef} from './state.ts';
import type {NodeKind} from '../nodes/catalog.ts';
import {tr} from '../i18n/korean.ts';
export type DraftNode = {
  id: string;
  kind: string;
  owner: string;
  value: Action;
  local: string;
  notify: string;
  from: string;
  to: string;
};
export function draftWorkspace(w: Workspace, d: DraftNode): Workspace {
  return {...w, blends: undefined, drafts: undefined, links: [], actions: [d.value]};
}
export function draftScope(d: DraftNode): GraphRef {
  return ['keyInput', 'markerReceive', 'stateCondition'].includes(d.kind)
    ? {kind: 'start', action: d.value.uid}
    : {kind: 'anim', action: d.value.uid};
}
export function makeDraft(w: Workspace, owner: string, kind: string, position: {x: number; y: number}) {
  let i = 1;
  while (w.drafts?.some(d => d.id === `draft:${i}`)) i++;
  const id = `draft:${i}`,
    context = w.actions.find(a => a.uid === owner);
  let value = addAction(w, context?.pair ? 'pair' : 'single');
  value.uid = 'draftAction';
  value.variants = {};
  value.config.steps = [createProject().steps[0]];
  value.config.steps[0].clip = '';
  value.config.entry = value.config.steps[0].id;
  Object.values(value.config.slots).forEach(s => (s.enabled = false));
  value.config.cost.enabled = false;
  value.config.recovery.enabled = false;
  let d: DraftNode = {
    id,
    kind,
    owner,
    value,
    local: '',
    notify: '',
    from: '',
    to: '',
  };
  let temp = draftWorkspace(w, d);
  if (kind.startsWith('notify:')) {
    const r = add(temp, value.uid, kind.slice(7), 0);
    d.value = r.workspace.actions[0];
    d.notify = r.id;
    d.local = r.id;
  } else if (d.kind === 'hkxPlay') d.local = 'clip_' + value.config.steps[0].id;
  else if (['outputPose', 'conditionTable'].includes(d.kind)) d.local = d.kind;
  else {
    const r = addGraphItem(temp, draftScope(d), kind as NodeKind);
    d.value = r.workspace.actions[0];
    d.local = r.id;
  }
  return {workspace: {...w, drafts: [...(w.drafts ?? []), d]}, id, position};
}
export function attachDraft(w: Workspace, d: DraftNode, action: string, step?: string) {
  if (d.from || d.to) throw Error(tr('HKX에서 나온 전환 키입니다. 출력을 도착할 다른 HKX에 연결하세요.'));
  let next = structuredClone(w),
    a = next.actions.find(a => a.uid === action);
  if (!a) throw Error(tr('연결할 동작을 찾지 못했습니다.'));
  const p = a.config,
    q = d.value.config;
  let local = d.local;
  if (d.kind === 'hkxPlay') {
    if (p.steps.length)
      throw Error(tr('동작에는 HKX 하나만 연결할 수 있습니다. 다음 HKX는 새 동작으로 만들어 전환으로 이으세요.'));
    const s = structuredClone(q.steps[0]);
    let i = 1;
    while (p.steps.some(x => x.id === `A${i}`)) i++;
    s.id = `A${i}`;
    p.steps.push(s);
    const window = d.value.clipWindows?.[q.steps[0].id];
    if (window) a.clipWindows = {...a.clipWindows, [s.id]: structuredClone(window)};
    if (!p.entry) p.entry = s.id;
    local = 'clip_' + s.id;
  } else if (d.kind === 'keyInput' || d.kind === 'markerReceive') {
    if (p.start.mode !== 'none') throw Error(tr('이미 시작 입력이 있습니다. 기존 입력을 삭제한 뒤 연결하세요.'));
    // A start event reads no key: only a start key brings its input (an event start left an unused Num0 behind).
    const input = q.start.mode === 'input' ? q.inputs.find(i => i.id === q.start.input) : undefined;
    if (input) {
      let id = input.id,
        i = 1;
      while (p.inputs.some(x => x.id === id)) id = input.id + '_' + i++;
      p.inputs.push({...input, id});
      p.start = {...q.start, input: id};
    } else p.start = {...q.start, input: ''};
  } else if (d.kind === 'stateCondition') {
    for (const k of ['weapon', 'air', 'cooldown', 'requiredStamina', 'blockWhileAttacking'] as const)
      Object.assign(p, {[k]: q[k]});
  } else if (d.kind === 'fireArrow') {
    if (a.pair || p.fireArrow) throw Error(tr('일반 동작에 활 발사 하나만 연결하세요.'));
    p.fireArrow = structuredClone(q.fireArrow ?? defaultFireArrow());
  } else if (d.kind === 'carryRelease') {
    if (a.pair || p.carryRelease) throw Error(tr('한 사람 일반 동작에 대상 놓기 하나만 연결하세요.'));
    p.carryRelease = structuredClone(q.carryRelease ?? {at: mark(1)});
  } else if (d.kind === 'suppress') {
    if (p.suppress) throw Error(tr('이미 연결된 기능입니다. 기존 카드를 편집하세요.'));
    p.suppress = structuredClone(q.suppress ?? {events: [''], when: 'startable'});
  } else if (d.kind === 'carryFix') {
    if (!a.pair?.carry) throw Error(tr('운반이 있는 들기 페어 HKX에 연결하세요.'));
    if (a.pair.carry.fix) throw Error(tr('이미 대상 고정 시점이 있습니다. 기존 항목을 편집하세요.'));
    a.pair.carry.fix = structuredClone(d.value.pair?.carry?.fix ?? defaultCarryFix());
  } else if (d.kind === 'carry') {
    if (!a.pair || !d.value.pair?.carry) throw Error(tr('페어 HKX에 연결하세요.'));
    if (a.pair.carry) throw Error(tr('이미 운반 카드가 있습니다.'));
    a.pair.carry = structuredClone(d.value.pair.carry);
    const carryInput = a.pair.carry.input;
    if (!p.inputs.some(i => i.id === carryInput)) a.pair.carry.input = p.start.input || p.inputs[0]?.id || '';
  } else if (d.kind === 'cameraRestore') {
    // Any action (10-16): a pair's Effects is switched on with it.
    a.cameraEnabled = true;
    if (a.pair) a.pair.effectsEnabled = true;
    a.camera = structuredClone(d.value.camera ?? {...defaultCamera(), reset: next.globals.cameraReset ?? ''});
  } else if (d.notify) {
    if (!!a.pair !== !!d.value.pair) throw Error(tr('동일한 일반/페어 유형에 연결하세요.'));
    const kind = d.kind.slice(7);
    if (a.pair && ['rotate', 'iframe', 'armor', 'cost'].includes(kind) && rows(next, a).some(r => r.kind === kind))
      throw Error(tr('이미 연결된 같은 기능이 있습니다. 기존 카드를 편집하거나 삭제 후 연결하세요.'));
    const r = add(next, action, kind, 0, 1, kind === 'recovery' ? step : undefined);
    next = r.workspace;
    a = next.actions.find(a => a.uid === action)!;
    local = r.id;
    if (!a.pair) {
      const slot = kind === 'iframe' ? 'iframe' : kind === 'armor' ? 'armor' : kind === 'rotate' ? 'rotate' : null;
      if (slot) a.config.slots[slot] = structuredClone(q.slots[slot]);
      if (slot === 'rotate') a.config.rotationLocked = q.rotationLocked;
      if (kind === 'cost') a.config.cost = structuredClone(q.cost);
      if (kind === 'recovery') setRecoveryRule(a.config, local, q.recovery);
      if (kind === 'vanillaCancel') {
        const c = a.cancels.at(-1)!;
        Object.assign(c, structuredClone(d.value.cancels[0]), {id: c.id});
      }
    } else {
      // A draft starts from an empty pair timeline/effect list.
      for (const [key, val] of Object.entries(d.value.pair!.timeline))
        if ((val as {enabled?: boolean}).enabled) Object.assign(a.pair.timeline, {[key]: structuredClone(val)});
      const fresh = d.value.pair!.effects;
      if (fresh.length) {
        a.pair.effects.splice(
          -fresh.length,
          fresh.length,
          ...fresh.map((e, i) => ({
            ...structuredClone(e),
            id: a!.pair!.effects[a!.pair!.effects.length - fresh.length + i].id,
          }))
        );
      }
    }
  } else throw Error(tr('지원하지 않는 연결입니다.'));
  next.drafts = next.drafts?.filter(x => x.id !== d.id);
  const endpoint = d.notify
    ? `notify:${action}|${local}`
    : ['keyInput', 'markerReceive', 'stateCondition'].includes(d.kind)
      ? `start:${action}|${local}`
      : `anim:${action}:|${local}`;
  next.blends = next.blends?.map(b => ({
    ...b,
    source: b.source === d.id ? endpoint : b.source,
    target: b.target === d.id ? endpoint : b.target,
  }));
  return {workspace: next, local};
}
