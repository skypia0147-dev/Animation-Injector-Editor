import type {Action, Workspace} from '../workspace.ts';
import type {Mark} from '../model.ts';
import type {FlatNode} from './flat.ts';
import {timelineRows} from '../timeline/model.ts';
import {eventKey} from '../eventRegistry.ts';
import {cameraReset} from '../sharedSettings.ts';

// Where an item stands in an HKX card's feature list (10-23, user decision): whole-play items and the start blend
// first, then everything that happens at a moment by when it happens (its clip time, or when its event comes: an
// item keeps its place whether it is on the clip or an event), the end blend last. Pure, for ChecklistCard.tsx.

/** group 0: whole play and the start blend · 1: at a moment, by `t` seconds (unknown last) · 2: the end blend. */
export type Place = {group: 0 | 1 | 2; t: number};
const WHOLE: Place = {group: 0, t: 0};
const at = (t: number): Place => ({group: 1, t});

/** When a mark happens in this clip: a clip time, a time before the end (with the clip's length), or when its event
 *  comes (its first time in the clip's annotations; else the time used when it does not come). */
export function markTime(m: Mark, eventTimes: Map<string, number>, length?: number): number {
  if (m.basis === 'event') return eventTimes.get(eventKey(m.event)) ?? Infinity;
  if (m.basis === 'end') return length !== undefined ? Math.max(0, length - m.seconds) : Infinity;
  return m.seconds;
}

/** The place of an action's item. `blend` is a blend item's role; `eventTimes` the events this clip sends (event key
 *  -> first time); `length` the clip's length when read. */
export function itemPlace(
  w: Workspace,
  a: Action,
  n: FlatNode,
  blend: 'enter' | 'exit' | undefined,
  eventTimes: Map<string, number>,
  length?: number
): Place {
  if (n.kind === 'blend') return blend === 'exit' ? {group: 2, t: 0} : WHOLE;
  if (n.kind === 'fireArrow') {
    const f = a.config.fireArrow;
    if (f?.at) return at(f.at.seconds);
    // An event shot: when the first event this clip sends that the registry shoots on comes.
    const shots = [...eventTimes].filter(([key]) =>
      w.eventRegistry?.some(r => eventKey(r.name) === key && r.functions.some(fn => fn.values.op === 'fireArrow'))
    );
    return at(Math.min(Infinity, ...shots.map(([, t]) => t)));
  }
  if (n.kind === 'cameraRestore') {
    // At the action's end, or when its reset event comes.
    const c = a.camera;
    return at(c?.restore === 'event' ? (eventTimes.get(eventKey(cameraReset(w, c) ?? '')) ?? Infinity) : Infinity);
  }
  if (n.kind === 'carryRelease')
    return at(a.config.carryRelease ? markTime(a.config.carryRelease.at, eventTimes, length) : Infinity);
  if (n.kind === 'carryFix') return at(a.pair?.carry?.fix ? a.pair.carry.fix.at.seconds : Infinity);
  if (n.notify) {
    // 회전 · 전 구간 금지 holds the whole play.
    if (n.notify === 'rotate' && !a.pair && a.config.rotationLocked) return WHOLE;
    const row = timelineRows(w, a).find(r => r.id === n.notify);
    return row ? at(markTime(row.from, eventTimes, length)) : WHOLE;
  }
  return WHOLE;
}
/** Orders entries by place, keeping their given order within a place (Array.prototype.sort is stable). */
export const byPlace = <T extends {place: Place}>(list: T[]) =>
  [...list].sort(
    (a, b) => a.place.group - b.place.group || (a.place.t === b.place.t ? 0 : a.place.t < b.place.t ? -1 : 1)
  );
