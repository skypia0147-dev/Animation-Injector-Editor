// What the HKX card's 활 발사 item shows (FireArrowShots.tsx, docs/mockup-fire-arrow-once, 10-23): one automatic
// shot, at a clip time (the action's FireArrow at) or on an event the clip's annotations send (the registry's
// fireArrow, which every HKX sending that event shares), changed in place; and the button's release as the drawn
// shot's early release. A clip time and an event together, or two events, shoot twice: the item asks to keep one.
import {putAction, selectsOnly, type Action, type Workspace} from '../workspace.ts';
import {clipKey, sentEvent, type Annotation} from './annotations.ts';
import {addFunction, eventKey, setFunctions} from '../eventRegistry.ts';
import {mark} from '../model.ts';
import {moveFunction} from './hkxMoments.ts';
import {tr} from '../i18n/korean.ts';

export type SentShotEvent = {key: string; name: string; time: number; senders: number};
export type EventShot = {name: string; time: number; fn: {id: string; values: Record<string, string>}; senders: number};

const clipOf = (a: Action) => a.config.steps.find(s => s.id === a.config.entry)?.clip ?? a.config.steps[0]?.clip ?? '';

/** The events an action's clip sends (first time each) and how many of the project's playing actions send them. */
export function sentEvents(w: Workspace, a: Action | undefined, annotations: Map<string, Annotation[]>) {
  if (!a) return [];
  const own = new Map<string, {name: string; time: number}>();
  for (const n of annotations.get(clipKey(clipOf(a))) ?? []) {
    const e = sentEvent(n.text, !!a.pair);
    if (e && !own.has(eventKey(e.name))) own.set(eventKey(e.name), {name: e.name, time: n.time});
  }
  const senders = new Map<string, number>();
  // A selecting action plays no clip of its own: it sends nothing.
  for (const other of w.actions.filter(x => !selectsOnly(x))) {
    const seen = new Set<string>();
    for (const n of annotations.get(clipKey(clipOf(other))) ?? []) {
      const e = sentEvent(n.text, !!other.pair);
      if (e) seen.add(eventKey(e.name));
    }
    for (const key of seen) senders.set(key, (senders.get(key) ?? 0) + 1);
  }
  return [...own].map(([key, e]): SentShotEvent => ({key, ...e, senders: senders.get(key) ?? 1}));
}

/** The registry's fireArrow functions on those events. */
export function eventShots(w: Workspace, sent: SentShotEvent[]): EventShot[] {
  return sent.flatMap(s => {
    const row = w.eventRegistry?.find(r => eventKey(r.name) === s.key);
    return (row?.functions ?? [])
      .filter(f => f.values.op === 'fireArrow')
      .map(fn => ({name: row!.name, time: s.time, fn, senders: s.senders}));
  });
}

/** The item's one automatic shot: a clip time, an event, both or two events (`conflict`: it shoots twice), or none
 *  (an older item that only shoots on the button's release). */
export type FireTiming =
  {kind: 'clip'} | {kind: 'event'; shot: EventShot} | {kind: 'conflict'; shots: EventShot[]} | {kind: 'none'};
export function fireTiming(w: Workspace, a: Action, sent: SentShotEvent[]): FireTiming {
  const at = !!a.config.fireArrow?.at,
    shots = eventShots(w, sent);
  if (at && !shots.length) return {kind: 'clip'};
  if (!at && shots.length === 1) return {kind: 'event', shot: shots[0]};
  if (!at && !shots.length) return {kind: 'none'};
  return {kind: 'conflict', shots};
}

/** The item's summary ("DodgeShotFire 주석 · 당긴 만큼 · 버튼 먼저"). */
export function fireArrowSummary(w: Workspace, a: Action | undefined, sent: SentShotEvent[], read = true): string {
  const f = a?.config.fireArrow;
  if (!a || !f) return '';
  const timing = fireTiming(w, a, sent);
  if (timing.kind === 'conflict') return tr('자동 발사 시점 {n}개', {n: timing.shots.length + (f.at ? 1 : 0)});
  const way = (mode?: string, damage?: number | string) =>
    mode === 'direct' ? tr('바로 발사 {damage}%', {damage: damage ?? 100}) : tr('당긴 만큼');
  const parts =
    timing.kind === 'clip'
      ? [tr('{seconds}초', {seconds: f.at!.seconds}), way(f.mode, f.damage)]
      : timing.kind === 'event'
        ? [tr('{name} 주석', {name: timing.shot.name}), way(timing.shot.fn.values.mode, timing.shot.fn.values.damage)]
        : // Unread annotations may hold an event shot: unknown, not missing.
          [read ? tr('자동 발사 시점 없음') : tr('HKX 주석 미확인')];
  if (f.onRelease && !directShot(w, a, timing)) parts.push(tr('버튼 먼저'));
  return parts.join(' · ');
}
/** Whether the item's automatic shot is direct (no draw: the button's early release does not apply). */
export function directShot(_w: Workspace, a: Action, timing: FireTiming) {
  return timing.kind === 'event'
    ? timing.shot.fn.values.mode === 'direct'
    : timing.kind === 'clip' && a.config.fireArrow?.mode === 'direct';
}

/** One event shot's values changed, or (no values) the shot removed from its event. */
export function setEventShot(w: Workspace, shot: EventShot, values?: Record<string, string>): Workspace {
  const row = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(shot.name));
  if (!row) return w;
  return setFunctions(
    w,
    row.name,
    values
      ? row.functions.map(fn => (fn.id === shot.fn.id ? {...fn, values} : fn))
      : row.functions.filter(fn => fn.id !== shot.fn.id)
  );
}

/** The player's shot on an event the clip sends (the registry's fireArrow, registering the event if needed). */
export function addEventShot(w: Workspace, name: string, values: Record<string, string> = {op: 'fireArrow'}) {
  const next = addFunction(w, name, 'fireArrow');
  const row = next.eventRegistry!.find(r => eventKey(r.name) === eventKey(name))!;
  const added = row.functions.at(-1)!;
  return setFunctions(
    next,
    row.name,
    row.functions.map(fn => (fn === added ? {...fn, values} : fn))
  );
}

const withFire = (w: Workspace, action: string, fire: NonNullable<Action['config']['fireArrow']>) => {
  const a = w.actions.find(x => x.uid === action)!;
  return putAction(w, {...a, config: {...a.config, fireArrow: fire}});
};
/** The shot's way as an event function's values (the direct shot's damage written only when not 100). */
const wayValues = (mode?: string, damage?: number | string): Record<string, string> =>
  mode === 'direct'
    ? {mode: 'direct', ...(damage !== undefined && String(damage) !== '100' ? {damage: String(damage)} : {})}
    : {};
/** The clip time becomes an event shot on `name` (global: every HKX sending it shoots), keeping the shot's way. */
export function fireToEvent(w: Workspace, action: string, name: string): Workspace {
  const f = w.actions.find(x => x.uid === action)!.config.fireArrow!;
  const next = withFire(w, action, {at: null, onRelease: f.mode === 'direct' ? false : f.onRelease});
  return addEventShot(next, name, {op: 'fireArrow', ...wayValues(f.mode, f.damage)});
}
/** The event shot leaves its event (global) and shoots at `seconds` of this clip, keeping its way. */
export function fireToClip(w: Workspace, action: string, shot: EventShot, seconds: number): Workspace {
  const f = w.actions.find(x => x.uid === action)!.config.fireArrow!,
    v = shot.fn.values,
    direct = v.mode === 'direct',
    damage = direct && v.damage !== undefined && v.damage !== '100' ? Number(v.damage) : undefined;
  return withFire(setEventShot(w, shot), action, {
    at: mark(Math.round(seconds * 1000) / 1000),
    onRelease: direct ? false : f.onRelease,
    ...(direct ? {mode: 'direct' as const} : {}),
    ...(damage !== undefined ? {damage} : {}),
  });
}
/** The event shot moves to another event this clip sends (global for both events). */
export const fireToOtherEvent = (w: Workspace, shot: EventShot, to: string) =>
  moveFunction(w, shot.name, shot.fn.id, to);
/** Two timings (a clip time and an event, or two events): keep one, the others removed. */
export function keepFireTiming(w: Workspace, action: string, keep: 'clip' | EventShot, shots: EventShot[]) {
  let next = shots.filter(s => keep === 'clip' || s.fn.id !== keep.fn.id).reduce((n, s) => setEventShot(n, s), w);
  if (keep !== 'clip') {
    const {mode: _, damage: __, ...rest} = next.actions.find(x => x.uid === action)!.config.fireArrow!;
    next = withFire(next, action, {...rest, at: null});
  }
  return next;
}
