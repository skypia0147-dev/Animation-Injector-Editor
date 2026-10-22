// What the HKX card's 활 발사 item shows (FireArrowShots.tsx, docs/mockup-fire-arrow-item, 10-22): every moment the
// HKX shoots. The action's own shot (its FireArrow: on the button's release and/or at a clip time, one way for both)
// and the registry's fireArrow on an event the clip's annotations send, which every HKX sending it shares.
import {selectsOnly, type Action, type Workspace} from '../workspace.ts';
import {clipKey, sentEvent, type Annotation} from './annotations.ts';
import {addFunction, eventKey, setFunctions} from '../eventRegistry.ts';
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

/** The item's summary: the moments it shoots ("DodgeShotFire 주석 · 버튼 떼기"). */
export function fireArrowSummary(w: Workspace, a: Action | undefined, sent: SentShotEvent[]): string {
  const f = a?.config.fireArrow;
  if (!f) return '';
  const direct = (damage?: number | string) => ' · ' + tr('바로 {damage}%', {damage: damage ?? 100});
  return (
    [
      ...eventShots(w, sent).map(
        s => tr('{name} 주석', {name: s.name}) + (s.fn.values.mode === 'direct' ? direct(s.fn.values.damage) : '')
      ),
      f.onRelease && f.mode !== 'direct' ? tr('버튼 떼기') : '',
      f.at ? tr('{seconds}초', {seconds: f.at.seconds}) + (f.mode === 'direct' ? direct(f.damage) : '') : '',
    ]
      .filter(Boolean)
      .join(' · ') || tr('발사 없음')
  );
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
export function addEventShot(w: Workspace, name: string): Workspace {
  const next = addFunction(w, name, 'fireArrow');
  const row = next.eventRegistry!.find(r => eventKey(r.name) === eventKey(name))!;
  const added = row.functions.at(-1)!;
  return setFunctions(
    next,
    row.name,
    row.functions.map(fn => (fn === added ? {...fn, values: {op: 'fireArrow'}} : fn))
  );
}
