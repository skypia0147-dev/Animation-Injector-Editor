import type {Project, Step} from './model.ts';
import {tr} from './i18n/korean.ts';
import {isGameControl} from './keys.ts';
/** A new action shot: on the attack button's release, no clip time (an event shot is a registry function). */
export type Suppression = {events: string[]; when: 'startable' | 'active' | 'both'};
export const equippedTypes = [
  'bow',
  'crossbow',
  'sword',
  'dagger',
  'axe',
  'mace',
  'greatsword',
  'battleaxe',
  'warhammer',
  'staff',
  'shield',
  'spell',
  'torch',
  'unarmed',
] as const;
export const attackStates = [
  'none',
  'draw',
  'swing',
  'hit',
  'nextAttack',
  'followThrough',
  'bash',
  'bowDraw',
  'bowAttached',
  'bowDrawn',
  'bowReleasing',
  'bowReleased',
  'bowNextAttack',
  'bowFollowThrough',
] as const;
const trimEvent = (s: string) => s.replace(/^ +| +$/g, '');
export function eventListError(events: string[]): string | undefined {
  if (
    !events.length ||
    events.some(s => !trimEvent(s) || new TextEncoder().encode(trimEvent(s)).length > 64 || /[\x00-\x1f\x7f,]/.test(s))
  )
    return tr('이벤트 이름은 1~64바이트이며 쉼표·제어 문자·빈 항목을 사용할 수 없습니다.');
}
export function uniqueEvents(events: string[]): string[] {
  const seen = new Set<string>();
  return events.map(trimEvent).filter(s => {
    const key = s.replace(/[A-Z]/g, c => c.toLowerCase());
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function extensionErrors(p: Project): string[] {
  const errors: (string | undefined)[] = [];
  if (p.suppress) {
    errors.push(eventListError(p.suppress.events));
    if (!['startable', 'active', 'both'].includes(p.suppress.when)) errors.push(tr('이벤트 차단 시점을 선택하세요.'));
  }
  return errors.filter((s): s is string => !!s);
}
// Structural checks allow incomplete authored rows to be saved; compilation reports semantic errors.
export function stripExtensions(value: any): unknown {
  const p = value && {
    ...value,
    ...(value.start ? {start: {...value.start}} : {}),
    ...(Array.isArray(value.steps) ? {steps: value.steps.map((s: Step) => ({...s}))} : {}),
    ...(Array.isArray(value.inputs)
      ? {inputs: value.inputs.map((i: unknown) => (i && typeof i === 'object' ? {...i} : i))}
      : {}),
  };
  const fail = () => {
    throw Error(tr('런타임 확장 설정의 형식이 잘못되었습니다.'));
  };
  const events = (v: any) => {
    if (!Array.isArray(v) || v.length > 500 || v.some(s => typeof s !== 'string' || s.length > 1024)) fail();
  };
  const markOk = (m: any) =>
    !!m &&
    Object.keys(m).sort().join() === 'basis,event,fallback,fallbackBasis,seconds' &&
    ['seconds', 'end', 'event'].includes(m.basis) &&
    Number.isFinite(m.seconds) &&
    typeof m.event === 'string' &&
    m.event.length <= 1024 &&
    typeof m.fallback === 'boolean' &&
    ['seconds', 'end'].includes(m.fallbackBasis);
  // An input's game control (runtime 0.12.292): one of keys.ts gameControls, with no key or button.
  for (const i of Array.isArray(p?.inputs) ? p.inputs : [])
    if (i && typeof i === 'object' && i.control !== undefined) {
      if (!isGameControl(i.control) || i.key || i.gamepad) fail();
      delete i.control;
      i.key = 'Num0';
    }
  // Charge (runtime 10-30): an optional loop {maxHold}.
  if (p?.loop !== undefined) {
    const l = p.loop;
    if (!l || typeof l !== 'object' || Object.keys(l).join() !== 'maxHold' || !Number.isFinite(l.maxHold)) fail();
    delete p.loop;
  }
  // Optional one-point slot {at: Mark}.
  if (p?.carryRelease !== undefined) {
    const f = p.carryRelease;
    if (!f || Object.keys(f).join() !== 'at' || !markOk(f.at)) fail();
    delete p.carryRelease;
  }
  if (p?.effects !== undefined) {
    const list = p.effects;
    if (
      !Array.isArray(list) ||
      list.length > 500 ||
      list.some(
        (e: any) =>
          !e ||
          typeof e !== 'object' ||
          Object.keys(e).sort().join() !== 'id,values' ||
          typeof e.id !== 'string' ||
          !e.values ||
          typeof e.values !== 'object' ||
          Array.isArray(e.values) ||
          Object.values(e.values).some(v => typeof v !== 'string' || v.length > 1024)
      )
    )
      fail();
    delete p.effects;
  }
  // The numbers this HKX runs registered functions with (runtime 0.12.281): row/fn key -> op and numbers.
  if (p?.eventValues !== undefined) {
    const all = p.eventValues;
    if (
      !all ||
      typeof all !== 'object' ||
      Array.isArray(all) ||
      Object.keys(all).length > 4096 ||
      Object.entries(all).some(
        ([k, v]: [string, any]) =>
          k.length > 256 ||
          !v ||
          typeof v !== 'object' ||
          Array.isArray(v) ||
          typeof v.op !== 'string' ||
          Object.values(v).some(x => typeof x !== 'string' || x.length > 1024)
      )
    )
      fail();
    delete p.eventValues;
  }
  if (p?.extraEvents !== undefined) {
    events(p.extraEvents);
    delete p.extraEvents;
  }
  if (p?.suppress !== undefined) {
    if (
      !p.suppress ||
      Object.keys(p.suppress).sort().join() !== 'events,when' ||
      !['startable', 'active', 'both'].includes(p.suppress.when)
    )
      fail();
    events(p.suppress.events);
    delete p.suppress;
  }
  if (p) {
    delete p.extraEvents;
    delete p.suppress;
  }
  for (const s of p?.steps ?? []) {
    if (s.recovery !== undefined) {
      const r = s.recovery,
        m = r?.at;
      if (
        !r ||
        Object.keys(r).sort().join() !== 'at,blend,enabled' ||
        r.enabled !== true ||
        !Number.isFinite(r.blend) ||
        r.blend < 0 ||
        r.blend > 5 ||
        !m ||
        Object.keys(m).sort().join() !== 'basis,event,fallback,fallbackBasis,seconds' ||
        !['seconds', 'event'].includes(m.basis) ||
        !Number.isFinite(m.seconds) ||
        m.seconds < 0 ||
        m.seconds > 600 ||
        typeof m.event !== 'string' ||
        m.event.length > 1024 ||
        typeof m.fallback !== 'boolean' ||
        m.fallbackBasis !== 'seconds'
      )
        fail();
      delete s.recovery;
    }
  }
  return p;
}
