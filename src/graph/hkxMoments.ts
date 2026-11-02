import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction, uid} from '../workspace.ts';
import {clipEffects, ordinaryEffectOps, setClipEffects} from '../clipEffects.ts';
import {clipKey, sentEvent, type Annotation} from './annotations.ts';
import {
  eventKey,
  functionParts,
  opInfo,
  type EventOp,
  nodeValues,
  registryEntries,
  registryPart,
  runValues,
  senderOnly,
  setFunctions,
  setNodeValues,
  valuePart,
} from '../eventRegistry.ts';
import {commandUsage, parseCommand} from '../annotationCommands.ts';
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
  time: ['timeOn', 'timeOff'],
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
  const time = w.actions.find(x => x.uid === action)!.config.slots.time;
  return toEvent(
    withConfig(w, action, p => {
      p.slots[key].enabled = false;
    }),
    action,
    event,
    // A time scale's multiplier and ease are this action's numbers there.
    key === 'time'
      ? {op: 'timeOn', factor: String(time.factor), ...(time.ease ? {ease: String(time.ease)} : {})}
      : {op: slotOps[key][0]}
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
    {
      op: 'cost',
      stamina: String(c.stamina),
      magicka: String(c.magicka),
      health: String(c.health),
      ...(c.percent ? {measure: 'percent'} : {}),
    }
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
    // A span (runtime 11-02) becomes the range from the event's time: the clip's own way to last that long.
    if (Number(values.duration)) {
      const slot = a.config.slots[key];
      slot.from = {...slot.from, basis: 'seconds', seconds: at, event: '', fallback: false, fallbackBasis: 'seconds'};
      slot.until = {
        ...slot.until,
        basis: 'seconds',
        seconds: Math.round((at + Number(values.duration)) * 1000) / 1000,
        event: '',
        fallback: false,
        fallbackBasis: 'seconds',
      };
    }
    if (key === 'time')
      Object.assign(a.config.slots.time, {
        factor: Number(values.factor ?? a.config.slots.time.factor),
        ease: Number(values.ease ?? 0),
      });
    item = key;
  } else if (op === 'cost' && !a.pair) {
    a.config.cost = {
      ...a.config.cost,
      enabled: true,
      at: {...a.config.cost.at, basis: 'seconds', seconds: at, event: '', fallback: false, fallbackBasis: 'seconds'},
      stamina: Number(values.stamina ?? 0),
      magicka: Number(values.magicka ?? 0),
      health: Number(values.health ?? 0),
      percent: values.measure === 'percent',
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
  /** A window's on function: its off function on an event this HKX sends, else on any registered event (the
   *  runtime waits for it, 11-01), or null (off when the actions that follow end). */
  off?: {event: string; fn: Effect; sent: Sent} | null;
};
export type CommandRow = {
  time: number;
  roles: Set<'initiator' | 'receiver'>;
  text: string; // the payload after "AI."
  values: Record<string, string>; // the function it runs (annotationCommands.ts)
};
/** One function's AI. commands in this HKX (docs/mockup-ai-commands): a window's on with its off ones; the commands
 *  the runtime does not run are an item of their own. */
export type CommandMoment = {
  key: string;
  label: string;
  rows: CommandRow[];
  off: CommandRow[];
  bad: {time: number; text: string; usage?: string}[];
};
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
  const byOp = new Map<string, CommandMoment>();
  const bad: CommandMoment = {key: 'cmd:bad', label: tr('알 수 없는 주석 명령'), rows: [], off: [], bad: []};
  for (const n of annotations) {
    const e = sentEvent(n.text, pair);
    if (!e?.command) continue;
    const values = parseCommand(e.values);
    if (!values) {
      bad.bad.push({time: n.time, text: 'AI.' + e.values, usage: commandUsage(e.values)});
      continue;
    }
    const item = byOp.get(values.op) ?? {
      key: `cmd:${values.op}`,
      label: opInfo[values.op as EventOp].label,
      rows: [],
      off: [],
      bad: [],
    };
    byOp.set(values.op, item);
    // One row per moment and values: a pair's two roles sending the same command are one row (0.12.275).
    const same = item.rows.find(
      r => Math.abs(r.time - n.time) < 0.15 && r.text.toLowerCase() === e.values.toLowerCase()
    );
    if (same) {
      if (e.role) same.roles.add(e.role);
    } else item.rows.push({time: n.time, roles: new Set(e.role ? [e.role] : []), text: e.values, values});
  }
  // A window's off commands show inside its on item, as a registered window's do.
  for (const [on, off] of Object.values(slotOps)) {
    const item = byOp.get(on),
      offs = byOp.get(off);
    if (item && offs) {
      item.off = offs.rows;
      byOp.delete(off);
    }
  }
  commands.push(...byOp.values());
  if (bad.bad.length) commands.push(bad);
  valued();
  // A window's on and off functions are one item (docs/mockup-moment-timing): the off one shows inside its on one.
  const paired = new Set<string>();
  for (const r of registry) {
    const key = slotOfOp(r.fn.values.op);
    if (!key) continue;
    const off = registry.find(x => x.fn.values.op === slotOps[key][1] && !paired.has(x.key));
    if (off) {
      r.off = {event: off.event, fn: off.fn, sent: off.sent};
      paired.add(off.key);
      continue;
    }
    // Another HKX's event may turn it off: the runtime waits for any registered off function.
    const elsewhere = registryEntries(w)
      .map(e => ({name: e.name, fn: e.row?.functions.find(f => f.values.op === slotOps[key][1])}))
      .find(e => e.fn);
    r.off = elsewhere
      ? {event: elsewhere.name, fn: elsewhere.fn!, sent: {name: elsewhere.name, times: [], roles: new Set()}}
      : null;
  }
  return {registry: registry.filter(r => !paired.has(r.key)), commands, read: true};
}
/** A collapsed card's chip (docs/mockup-chip-colors): what it is, its short note, the whole on hover, and whether it
 *  comes from the HKX's annotations (a registered event's function, an AI. command). */
export type Chip = {key: string; title: string; summary: string; tip: string; kind?: 'event' | 'command'};
/** The chips for what the HKX's annotations add (as the open card lists them): each registered function its events
 *  run, noted with its event, and each AI. command item, noted with its values or how many places. */
export function momentChips(m: ReturnType<typeof hkxMoments>): Chip[] {
  return [
    ...m.registry.map(r => {
      const title = opInfo[r.fn.values.op as EventOp]?.label ?? r.fn.values.op;
      return {
        key: r.key,
        title,
        summary: r.event,
        tip: title + ' · ' + (r.off ? r.event + ' → ' + r.off.event : r.event),
        kind: 'event' as const,
      };
    }),
    ...m.commands.map(c => ({
      key: c.key,
      title: c.label,
      summary:
        c.rows.length > 1
          ? tr('{n}곳', {n: c.rows.length})
          : c.rows.length
            ? functionParts(c.rows[0].values).join(' · ')
            : '',
      tip:
        c.label +
        ' · ' +
        [...c.rows, ...c.off]
          .sort((a, b) => a.time - b.time)
          .map(r => 'AI.' + r.text)
          .concat(c.bad.map(b => b.text))
          .join(', '),
      kind: 'command' as const,
    })),
  ];
}
/** A window's off event choices: the events this HKX sends, then the other HKX's of this project (with the action
 *  sending it) and the events registered to turn it off. */
export function offChoices(
  w: Workspace,
  action: Action,
  annotations: Map<string, Annotation[]>,
  off: string
): {here: Sent[]; others: {name: string; from?: string}[]} {
  const here = sentEvents(annotations.get(clipKey(actionClip(w, action))), !!action.pair);
  const taken = new Set(here.map(s => eventKey(s.name)));
  const others: {name: string; from?: string}[] = [];
  const add = (name: string, from?: string) => {
    if (taken.has(eventKey(name))) return;
    taken.add(eventKey(name));
    others.push({name, from});
  };
  for (const a of w.actions)
    if (a.uid !== action.uid)
      for (const s of sentEvents(annotations.get(clipKey(actionClip(w, a))), !!a.pair)) add(s.name, a.config.name);
  for (const e of registryEntries(w)) if (e.row?.functions.some(f => f.values.op === off)) add(e.name);
  return {here, others};
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
