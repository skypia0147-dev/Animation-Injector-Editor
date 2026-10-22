import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction, uid} from '../workspace.ts';
import {clipEffects, ordinaryEffectOps, setClipEffects} from '../clipEffects.ts';
import {sentEvent, type Annotation} from './annotations.ts';
import {eventKey, registryEntries, senderOnly, setFunctions} from '../eventRegistry.ts';
import {parseCommand} from '../annotationCommands.ts';
import {stepSource} from '../view.ts';
import {tr} from '../i18n/korean.ts';

// What an HKX card's moments are made of besides its clip-time functions (10-23, docs/mockup-inline-moments): the
// registered functions of the events its HKX sends, its AI. annotation commands, and the moves between a clip
// time and an event. Pure, for MomentFields.tsx and its tests.

/** The HKX this action plays (one per action). */
export const actionClip = (w: Workspace, a: Action) => {
  const step = a.config.steps.find(s => s.id === a.config.entry) ?? a.config.steps[0];
  return step ? stepSource(w, a, step).clip : '';
};
export const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** An event this clip sends, with its times and the pair roles that send it. */
export type Sent = {name: string; times: number[]; roles: Set<'initiator' | 'receiver'>};
export function sentEvents(list: Annotation[] | undefined, pair: boolean): Sent[] {
  const out = new Map<string, Sent>();
  for (const n of list ?? []) {
    const e = sentEvent(n.text, pair);
    // A command is no event to register; "name|value" is never sent (runtime 0.12.274).
    if (!e || e.command || e.values) continue;
    const s = out.get(eventKey(e.name)) ?? {name: e.name, times: [], roles: new Set()};
    s.times.push(n.time);
    if (e.role) s.roles.add(e.role);
    out.set(eventKey(e.name), s);
  }
  return [...out.values()];
}

// ── clip time ↔ event ─────────────────────────────────────────────────────────────────────────────
/** A clip-time function becomes the registered function of `event` (it then runs for every animation that sends
 *  it, on the sender). */
export function clipToEvent(w: Workspace, action: string, effect: string, event: string): Workspace {
  const a = structuredClone(w.actions.find(x => x.uid === action)!);
  const e = clipEffects(a).find(x => x.id === effect);
  if (!e) return w;
  setClipEffects(
    a,
    clipEffects(a).filter(x => x.id !== effect)
  );
  const values = senderOnly({...e.values});
  delete values.at;
  const next = putAction(w, a),
    row = next.eventRegistry?.find(r => eventKey(r.name) === eventKey(event)),
    fns = row?.functions ?? [];
  return setFunctions(next, row?.name ?? event, [
    ...fns,
    {
      id: uid(
        'fn',
        fns.map(f => f.id)
      ),
      values,
    },
  ]);
}
/** A registered function leaves the registry and becomes this action's clip-time function at `at`. */
export function eventToClip(w: Workspace, action: string, event: string, fn: string, at: number): Workspace {
  const row = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(event)),
    f = row?.functions.find(x => x.id === fn);
  if (!row || !f) return w;
  const next = setFunctions(
    w,
    row.name,
    row.functions.filter(x => x.id !== fn)
  );
  const a = structuredClone(next.actions.find(x => x.uid === action)!),
    list = clipEffects(a);
  setClipEffects(a, [
    ...list,
    {
      id: uid(
        'effect',
        list.map(e => e.id)
      ),
      values: {...f.values, at: fmt(at)},
    },
  ]);
  return putAction(next, a);
}
/** A registered function moves to another event. */
export function moveFunction(w: Workspace, from: string, fn: string, to: string): Workspace {
  if (eventKey(from) === eventKey(to)) return w;
  const row = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(from)),
    f = row?.functions.find(x => x.id === fn);
  if (!row || !f) return w;
  let next = setFunctions(
    w,
    row.name,
    row.functions.filter(x => x.id !== fn)
  );
  const target = next.eventRegistry?.find(r => eventKey(r.name) === eventKey(to)),
    fns = target?.functions ?? [];
  next = setFunctions(next, target?.name ?? to, [
    ...fns,
    {
      ...f,
      id: uid(
        'fn',
        fns.map(x => x.id)
      ),
    },
  ]);
  return next;
}
/** Whether a function can run at a clip time of this action (an ordinary action's own list, a pair's but the shot). */
export const clipCapable = (a: Action, op: string) => (a.pair ? op !== 'fireArrow' : ordinaryEffectOps.includes(op));

export type RegistryMoment = {key: string; event: string; fn: Effect; sent: Sent};
export type CommandRow = {time: number; roles: Set<'initiator' | 'receiver'>; strength: number; duration: number};
export type CommandMoment = {key: string; label: string; rows: CommandRow[]; bad: {time: number; text: string}[]};
/** Pure (tests): what useHkxMoments shows for an action and its clip's annotations. */
export function hkxMoments(w: Workspace, action: Action | undefined, annotations: Annotation[] | undefined) {
  const registry: RegistryMoment[] = [],
    commands: CommandMoment[] = [];
  if (!action || !annotations) return {registry, commands, read: !!annotations};
  const pair = !!action.pair;
  const entries = new Map(registryEntries(w).map(e => [eventKey(e.name), e]));
  for (const sent of sentEvents(annotations, pair))
    for (const fn of entries.get(eventKey(sent.name))?.row?.functions ?? [])
      registry.push({
        key: `reg:${eventKey(sent.name)}:${fn.id}`,
        event: entries.get(eventKey(sent.name))!.name,
        fn,
        sent,
      });
  const shake: CommandMoment = {key: 'cmd:CamShake', label: tr('카메라 흔들림'), rows: [], bad: []};
  for (const n of annotations) {
    const e = sentEvent(n.text, pair);
    if (!e?.command) continue;
    const c = parseCommand(e.values);
    if (!c) {
      shake.bad.push({time: n.time, text: 'AI.' + e.values});
      continue;
    }
    // One row per moment and numbers: a pair's two roles sending the same command run it once (0.12.275).
    const same = shake.rows.find(
      r => Math.abs(r.time - n.time) < 0.15 && r.strength === c.strength && r.duration === c.duration
    );
    if (same) {
      if (e.role) same.roles.add(e.role);
    } else
      shake.rows.push({
        time: n.time,
        roles: new Set(e.role ? [e.role] : []),
        strength: c.strength,
        duration: c.duration,
      });
  }
  if (shake.rows.length || shake.bad.length) commands.push(shake);
  return {registry, commands, read: true};
}
