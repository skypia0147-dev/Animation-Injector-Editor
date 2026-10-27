import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction, uid} from '../workspace.ts';
import {clipEffects, ordinaryEffectOps, setClipEffects} from '../clipEffects.ts';
import {clipKey, sentEvent, type Annotation} from './annotations.ts';
import {
  eventKey,
  nodeValues,
  registryEntries,
  registryPart,
  runValues,
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

// ── an event's function, edited from the card (10-27): which event, or back to the clip ──────────
// The registry is global: a function on an event runs for every HKX that sends it. Moving it moves it for all of
// them; the card says which of this project's HKX send the event too.
/** This project's other actions whose HKX is seen sending `event`. */
export function otherSenders(w: Workspace, action: Action, event: string, annotations: Map<string, Annotation[]>) {
  return w.actions.filter(
    a =>
      a.uid !== action.uid &&
      sentEvents(annotations.get(clipKey(actionClip(w, a))), !!a.pair).some(s => eventKey(s.name) === eventKey(event))
  );
}
const rowOf = (w: Workspace, event: string) => w.eventRegistry?.find(r => eventKey(r.name) === eventKey(event));
const sameAct = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(registryPart(a)) === JSON.stringify(registryPart(b));
/** Moves a registered function from `from` to `to`, every node's numbers with it; an equal function already on `to`
 *  takes them. The emptied event stays registered (its name may be what lets its annotation be sent). Returns the
 *  function's id on `to`. */
export function moveFunction(w: Workspace, from: string, fnId: string, to: string): {w: Workspace; fn?: string} {
  const src = rowOf(w, from),
    fn = src?.functions.find(f => f.id === fnId);
  if (!src || !fn || eventKey(from) === eventKey(to)) return {w, fn: fn?.id};
  const dst0 = rowOf(w, to),
    same = dst0?.functions.find(f => sameAct(f.values, fn.values));
  const target = same ?? {
    id: uid(
      'fn',
      (dst0?.functions ?? []).map(f => f.id)
    ),
    values: {...fn.values},
  };
  const carried = w.actions
    .map(a => ({uid: a.uid, values: nodeValues(a, src, fn)}))
    .filter((x): x is {uid: string; values: Record<string, string>} => !!x.values);
  let next = same ? w : setFunctions(w, dst0?.name ?? to, [...(dst0?.functions ?? []), target]);
  next = setFunctions(
    next,
    src.name,
    src.functions.filter(f => f.id !== fnId)
  );
  const dst = rowOf(next, to)!;
  for (const c of carried) next = setNodeValues(next, c.uid, dst, target, c.values);
  return {w: next, fn: target.id};
}
/** Sets where a window's on function on `event` turns off: an event (its off function there) or the action's end. */
export function setOffEvent(
  w: Workspace,
  key: SlotKey,
  current: {event: string; fn: string} | null | undefined,
  to: string | null
): Workspace {
  let next = w;
  if (current) {
    const row = rowOf(next, current.event);
    if (row)
      next = setFunctions(
        next,
        row.name,
        row.functions.filter(f => f.id !== current.fn)
      );
  }
  if (to) {
    const row = rowOf(next, to),
      off = slotOps[key][1];
    if (!row?.functions.some(f => f.values.op === off))
      next = setFunctions(next, row?.name ?? to, [
        ...(row?.functions ?? []),
        {
          id: uid(
            'fn',
            (row?.functions ?? []).map(f => f.id)
          ),
          values: {op: off},
        },
      ]);
  }
  return next;
}
/** Why a registered function cannot go back to this action's clip, or '' when it can. */
export function clipBlocked(action: Action, op: string, shared: Action[]): string {
  if (shared.length)
    return tr('{names}도 이 이벤트를 보내 이 기능을 씁니다. 클립으로 옮기면 그 HKX에서 빠지므로 등록에서 정리하세요.', {
      names: shared.map(a => a.config.name).join(', '),
    });
  if (action.pair) return op === 'fireArrow' || slotOfOp(op) ? tr('페어의 클립 시각 기능이 아닙니다.') : '';
  return slotOfOp(op) || op === 'cost' || ordinaryEffectOps.includes(op)
    ? ''
    : tr('일반 동작의 클립 시각 기능이 아닙니다.');
}
/** A registered function back on this action's clip at `at` seconds: a window or a cost is the action's own slot
 *  again (its clip times kept from before), any other a clip-time function with this node's numbers. The function
 *  and a window's off function leave the registry. Returns the card item id to open. */
export function eventToClip(
  w: Workspace,
  action: string,
  event: string,
  fnId: string,
  at: number,
  off?: {event: string; fn: string} | null
): {w: Workspace; item?: string} {
  const row = rowOf(w, event),
    fn = row?.functions.find(f => f.id === fnId),
    a0 = w.actions.find(x => x.uid === action);
  if (!row || !fn || !a0) return {w};
  const values = runValues(a0, row, fn),
    op = values.op,
    key = slotOfOp(op);
  let next = setFunctions(
    w,
    row.name,
    row.functions.filter(f => f.id !== fnId)
  );
  if (key && off) next = setOffEvent(next, key, off, null);
  const a = structuredClone(next.actions.find(x => x.uid === action)!);
  let item: string;
  if (key && !a.pair) {
    a.config.slots[key].enabled = true;
    item = key;
  } else if (op === 'cost' && !a.pair) {
    a.config.cost = {
      ...a.config.cost,
      enabled: true,
      at: {...a.config.cost.at, basis: 'seconds', seconds: at, event: '', fallback: false, fallbackBasis: 'seconds'},
      stamina: Number(values.stamina ?? 0),
      magicka: Number(values.magicka ?? 0),
    };
    item = 'cost';
  } else {
    const effects = clipEffects(a);
    const id = uid(
      'effect',
      effects.map(e => e.id)
    );
    setClipEffects(a, [...effects, {id, values: {...values, at: fmt(at)}}]);
    item = 'effect:' + id;
  }
  return {w: putAction(next, a), item};
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
  if (!action) return {registry, commands, read: !!annotations};
  // Values this HKX holds for a registered function it is not seen sending (its HKX not read, or the annotation
  // gone) still show, so they can be read and changed: an event's 활 발사 is only this (runtime 0.12.302).
  const valued = () => {
    for (const row of w.eventRegistry ?? [])
      for (const fn of row.functions) {
        const key = `reg:${eventKey(row.name)}:${fn.id}`;
        if (nodeValues(action, row, fn) && !registry.some(r => r.key === key))
          registry.push({key, event: row.name, fn, sent: {name: row.name, times: [], roles: new Set()}});
      }
  };
  if (!annotations) {
    valued();
    return {registry, commands, read: false};
  }
  const pair = !!action.pair;
  const entries = new Map(registryEntries(w).map(e => [eventKey(e.name), e]));
  for (const sent of sentEvents(annotations, pair))
    for (const fn of entries.get(eventKey(sent.name))?.row?.functions ?? []) {
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
  valued();
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
