import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction, uid} from '../workspace.ts';
import {clipEffects, setClipEffects} from '../clipEffects.ts';
import {sentEvent, type Annotation} from './annotations.ts';
import {
  eventKey,
  registryEntries,
  registryPart,
  senderOnly,
  setFunctions,
  setNodeValues,
  valuePart,
} from '../eventRegistry.ts';
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

// ── clip time → event (a registered function's numbers are the node's, runtime 0.12.281) ──────────
/** Registers `values` on `event` (what it acts with) and gives this action its numbers there. */
function toEvent(w: Workspace, action: string, event: string, values: Record<string, string>): Workspace {
  const row0 = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(event)),
    fns = row0?.functions ?? [];
  const fn = {
    id: uid(
      'fn',
      fns.map(f => f.id)
    ),
    values: registryPart(values),
  };
  const next = setFunctions(w, row0?.name ?? event, [...fns, fn]);
  const row = next.eventRegistry!.find(r => eventKey(r.name) === eventKey(event))!;
  const own = valuePart(values);
  return Object.keys(own).length > 1 ? setNodeValues(next, action, row, fn, own) : next;
}
/** A clip-time function becomes a registered function of `event` (it then runs for every animation that sends it,
 *  on the sender); its numbers stay this action's. */
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
  return toEvent(putAction(w, a), action, event, values);
}

// ── an action's windows and cost → the registry (docs/mockup-moment-timing) ───────────────────────
/** The registry's on/off functions of an ordinary action's windows (the runtime runs a window at clip times only:
 *  on an event it is the registry's, global). */
export const slotOps = {
  rotate: ['rotateOn', 'rotateOff'],
  iframe: ['iframeOn', 'iframeOff'],
  armor: ['armorOn', 'armorOff'],
} as const;
export type SlotKey = keyof typeof slotOps;
export const slotOfOp = (op: string) => (Object.keys(slotOps) as SlotKey[]).find(k => slotOps[k][0] === op);
const withConfig = (w: Workspace, action: string, f: (p: Action['config']) => void) => {
  const a = structuredClone(w.actions.find(x => x.uid === action)!);
  f(a.config);
  return putAction(w, a);
};
/** A window becomes the registry's on function on `event` (it then turns off when the action ends). */
export function slotToEvent(w: Workspace, action: string, key: SlotKey, event: string): Workspace {
  return toEvent(
    withConfig(w, action, p => {
      p.slots[key].enabled = false;
    }),
    action,
    event,
    {op: slotOps[key][0]}
  );
}
/** The action's cost becomes the registry's cost on `event`, its amounts this action's numbers there. */
export function costToEvent(w: Workspace, action: string, event: string): Workspace {
  const c = w.actions.find(x => x.uid === action)!.config.cost;
  return toEvent(
    withConfig(w, action, p => {
      p.cost.enabled = false;
    }),
    action,
    event,
    {op: 'cost', stamina: String(c.stamina), magicka: String(c.magicka)}
  );
}

export type RegistryMoment = {
  key: string;
  event: string;
  fn: Effect;
  sent: Sent;
  /** A window's on function: its off function on an event this HKX sends, or null (off when the action ends). */
  off?: {event: string; fn: Effect; sent: Sent} | null;
};
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
    for (const fn of entries.get(eventKey(sent.name))?.row?.functions ?? []) {
      // An action with a 활 발사 item shows its event shot there (FireArrowShots.tsx), not a second time here.
      if (fn.values.op === 'fireArrow' && action.config.fireArrow) continue;
      registry.push({
        key: `reg:${eventKey(sent.name)}:${fn.id}`,
        event: entries.get(eventKey(sent.name))!.name,
        fn,
        sent,
      });
    }
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
  // A window's on and off functions are one item (docs/mockup-moment-timing): the off one shows inside its on one.
  const paired = new Set<string>();
  for (const r of registry) {
    const key = slotOfOp(r.fn.values.op);
    if (!key) continue;
    const off = registry.find(x => x.fn.values.op === slotOps[key][1] && !paired.has(x.key));
    r.off = off ? {event: off.event, fn: off.fn, sent: off.sent} : null;
    if (off) paired.add(off.key);
  }
  return {registry: registry.filter(r => !paired.has(r.key)), commands, read: true};
}

// ── the clip bar (MomentFields.tsx TimeRuler): dragging like the timeline ─────────────────────────
/** What a press on the bar holds: the moment, a window's start or end, or the whole window. */
export type RulerGrab = 'at' | 'from' | 'until' | 'move';
/** The part of the bar a press at `t` seconds takes; `near` is how close (seconds) an end must be to be held. */
export function rulerGrab(t: number, span: [number, number] | undefined, near: number): RulerGrab {
  if (!span) return 'at';
  const [from, until] = span,
    toFrom = Math.abs(t - from),
    toUntil = Math.abs(t - until);
  if (Math.min(toFrom, toUntil) <= near) return toFrom <= toUntil ? 'from' : 'until';
  if (t > from && t < until) return 'move';
  return t <= from ? 'from' : 'until';
}
/** The values a drag gives, within the clip, to the hundredth: a window keeps from ≤ until, and moved whole keeps
 *  its length. `origin.t` is where the press began. */
export function rulerDrag(
  grab: RulerGrab,
  origin: {t: number; at: number; from: number; until: number},
  t: number,
  length: number
): {at: number; from: number; until: number} {
  const snap = (x: number) => Math.round(Math.min(length, Math.max(0, x)) * 100) / 100;
  const {at, from, until} = origin;
  if (grab === 'at') return {at: snap(t), from, until};
  if (grab === 'from') return {at, from: Math.min(snap(t), until), until};
  if (grab === 'until') return {at, from, until: Math.max(snap(t), from)};
  const d = Math.min(Math.max(t - origin.t, -from), length - until);
  return {at, from: snap(from + d), until: snap(until + d)};
}
