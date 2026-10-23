// What the HKX card's 활 발사 item shows (FireArrowShots.tsx, docs/mockup-fire-arrow-once, 10-23): one automatic
// shot, at a clip time (the action's FireArrow at) or on an event the clip's annotations send (the registry's
// fireArrow, run with this node's way and damage: runtime 0.12.281, docs/mockup-event-node-values); and the button's
// release as the drawn shot's early release. A clip time and an event together, or two events, shoot twice.
import {putAction, selectsOnly, type Action, type Effect, type Workspace} from '../workspace.ts';
import {clipKey, sentEvent, type Annotation} from './annotations.ts';
import {addFunction, eventKey, nodeValues, runValues, setNodeValues, type EventRow} from '../eventRegistry.ts';
import {tr} from '../i18n/korean.ts';

export type SentShotEvent = {key: string; name: string; time: number; senders: number};
export type EventShot = {name: string; time: number; row: EventRow; fn: Effect; senders: number};

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
      .map(fn => ({name: row!.name, time: s.time, row: row!, fn, senders: s.senders}));
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

/** This node's way of an event shot: its mode and damage (the registry holds none). */
export const shotWay = (a: Action, shot: EventShot) => runValues(a, shot.row, shot.fn);

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
        ? [
            tr('{name} 주석', {name: timing.shot.name}),
            way(shotWay(a, timing.shot).mode, shotWay(a, timing.shot).damage),
          ]
        : // Unread annotations may hold an event shot: unknown, not missing.
          [read ? tr('자동 발사 시점 없음') : tr('HKX 주석 미확인')];
  if (f.onRelease && !directShot(w, a, timing)) parts.push(tr('버튼 먼저'));
  return parts.join(' · ');
}
/** Whether the item's automatic shot is direct (no draw: the button's early release does not apply). */
export function directShot(_w: Workspace, a: Action, timing: FireTiming) {
  return timing.kind === 'event'
    ? shotWay(a, timing.shot).mode === 'direct'
    : timing.kind === 'clip' && a.config.fireArrow?.mode === 'direct';
}

/** This node's way of an event shot (mode, damage): other nodes sending the event keep theirs. */
export function setShotWay(w: Workspace, action: string, shot: EventShot, values: Record<string, string>) {
  const a = w.actions.find(x => x.uid === action),
    kept = {...(a && nodeValues(a, shot.row, shot.fn)), ...values};
  delete kept.mode;
  delete kept.damage;
  if (values.mode === 'direct') {
    kept.mode = 'direct';
    if (values.damage !== undefined && values.damage !== '100') kept.damage = values.damage;
  }
  return setNodeValues(w, action, shot.row, shot.fn, Object.keys(kept).some(k => k !== 'op') ? kept : undefined);
}

const withFire = (w: Workspace, action: string, fire: NonNullable<Action['config']['fireArrow']>) => {
  const a = w.actions.find(x => x.uid === action)!;
  return putAction(w, {...a, config: {...a.config, fireArrow: fire}});
};
/** The clip time becomes a shot on `name` (the registry's fireArrow there, which every HKX sending it shoots), this
 *  node keeping its way and damage. */
export function fireToEvent(w: Workspace, action: string, name: string): Workspace {
  const f = w.actions.find(x => x.uid === action)!.config.fireArrow!;
  let next = withFire(w, action, {at: null, onRelease: f.mode === 'direct' ? false : f.onRelease});
  next = addFunction(next, name, 'fireArrow');
  const row = next.eventRegistry!.find(r => eventKey(r.name) === eventKey(name))!;
  const shot = {name: row.name, time: 0, row, fn: row.functions.at(-1)!, senders: 1};
  return f.mode === 'direct'
    ? setShotWay(next, action, shot, {mode: 'direct', ...(f.damage !== undefined ? {damage: String(f.damage)} : {})})
    : next;
}
/** A clip time beside an event shot shoots twice: the clip time goes (the event is the registry's). */
export function dropClipTime(w: Workspace, action: string): Workspace {
  const {mode: _, damage: __, ...rest} = w.actions.find(x => x.uid === action)!.config.fireArrow!;
  return withFire(w, action, {...rest, at: null});
}
