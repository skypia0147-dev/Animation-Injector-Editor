// The global event registry (runtime 0.12.222, XML format 3): one list per project of event names
// and the functions each runs. The runtime runs a registered name's functions whenever any actor's
// graph sends it, in any animation. docs/계획-전역이벤트등록.md (runtime repo) §3, §5.
import {clone, mark} from './model.ts';
import type {Issue, Mark} from './model.ts';
import type {Effect, Workspace} from './workspace.ts';
import {cameraReset} from './sharedSettings.ts';
import {node, shapeXml, type Xml} from './xml.ts';
import {vanillaEvents} from './vanillaEvents.ts';
import {animId} from './graph/blends.ts';
import {tr} from './i18n/korean.ts';

/** A function is an Effect: `values` holds op and the op's settings (strings, like XML). A registered event's
 *  function changes the actor that sent the event (runtime 0.12.273); only a pair's clip-time effect also holds
 *  a target. */
export type EventRow = {id: string; name: string; functions: Effect[]};

export const eventOps = [
  'hide',
  'show',
  'spell',
  'stateOn',
  'stateOff',
  'cost',
  'shake',
  'stopVelocity',
  'timeOn',
  'timeOff',
  'iframeOn',
  'iframeOff',
  'armorOn',
  'armorOff',
  'rotateOn',
  'rotateOff',
  'cancel',
  'fireArrow',
  'ragdoll',
] as const;
export type EventOp = (typeof eventOps)[number];
/** Whom a pair's clip-time effect changes (runtime 0.12.275): both actors play the clip, so no one sends it.
 *  Absent = both. A registered event's function changes its sender and an ordinary action's the actor playing
 *  it: neither holds one. */
export const pairRoles = ['both', 'initiator', 'receiver', 'player'] as const;
export const pairRoleLabels: Record<string, string> = {
  get both() {
    return tr('둘 다');
  },
  get initiator() {
    return tr('가해자');
  },
  get receiver() {
    return tr('피해자');
  },
  get player() {
    return tr('플레이어인 쪽');
  },
};
/** An older pair effect's target and sender filter as the role they reached (with every role a sender). */
export function pairRole(target?: string, from?: string): string {
  const t = target || 'sender',
    f = from || 'any';
  if ((pairRoles as readonly string[]).includes(t)) return t;
  if (f === 'initiator') return t === 'sender' ? 'initiator' : 'receiver';
  if (f === 'receiver') return t === 'sender' ? 'receiver' : 'initiator';
  if (f === 'player' && t === 'sender') return 'player';
  return 'both';
}
/** A pair clip-time effect's values in the 0.12.275 shape: a role (none for both or a player-only op), no `from`. */
export function pairEffectValues(values: Record<string, string>) {
  const role = pairRole(values.target, values.from);
  delete values.from;
  if (role === 'both' || opInfo[values.op as EventOp]?.player) delete values.target;
  else values.target = role;
  return values;
}
type OpInfo = {label: string; lasting?: EventOp; player?: boolean; fields: string[]};
export const opInfo: Record<EventOp, OpInfo> = {
  hide: {
    get label() {
      return tr('무기 숨김');
    },
    lasting: 'show',
    fields: [],
  },
  show: {
    get label() {
      return tr('무기 표시');
    },
    fields: [],
  },
  spell: {
    get label() {
      return tr('주문 적용');
    },
    fields: ['plugin', 'form'],
  },
  stateOn: {
    get label() {
      return tr('상태 켜기');
    },
    lasting: 'stateOff',
    fields: ['plugin', 'form'],
  },
  stateOff: {
    get label() {
      return tr('상태 끄기');
    },
    fields: ['plugin', 'form'],
  },
  cost: {
    get label() {
      return tr('자원 소모');
    },
    fields: ['stamina', 'magicka'],
  },
  shake: {
    get label() {
      return tr('카메라 흔들림');
    },
    player: true,
    fields: ['strength', 'duration'],
  },
  stopVelocity: {
    get label() {
      return tr('잔여 속도 제거');
    },
    fields: [],
  },
  timeOn: {
    get label() {
      return tr('시간 배율');
    },
    lasting: 'timeOff',
    player: true,
    fields: ['factor'],
  },
  timeOff: {
    get label() {
      return tr('시간 배율 복구');
    },
    player: true,
    fields: [],
  },
  iframeOn: {
    get label() {
      return tr('피해 면역');
    },
    lasting: 'iframeOff',
    fields: [],
  },
  iframeOff: {
    get label() {
      return tr('피해 면역 해제');
    },
    fields: [],
  },
  armorOn: {
    get label() {
      return tr('스태거 면역');
    },
    lasting: 'armorOff',
    fields: [],
  },
  armorOff: {
    get label() {
      return tr('스태거 면역 해제');
    },
    fields: [],
  },
  rotateOn: {
    get label() {
      return tr('회전 허용');
    },
    lasting: 'rotateOff',
    fields: [],
  },
  rotateOff: {
    get label() {
      return tr('회전 허용 해제');
    },
    fields: [],
  },
  cancel: {
    get label() {
      return tr('페어 취소');
    },
    fields: [],
  },
  fireArrow: {
    get label() {
      return tr('활 발사');
    },
    player: true,
    // How the arrow leaves the bow (runtime 0.12.268): drawn (absent) or direct, and the direct shot's damage %.
    fields: ['mode', 'damage'],
  },
  ragdoll: {
    get label() {
      return tr('래그돌');
    },
    // The engine's ragdoll from a point beside the actor (runtime 0.12.278, docs/mockup-ragdoll): a direction and
    // a force; a pair's role first leaves the pair's physics hold, and its get-up is watched.
    fields: ['direction', 'force'],
  },
};
export const settingKeys = [
  'plugin',
  'form',
  'direction',
  'force',
  'stamina',
  'magicka',
  'strength',
  'duration',
  'factor',
  'delay',
  'mode',
  'damage',
] as const;
/** Every key a registered event's function may hold; a pair's clip-time effect adds `at`, `target` and `from`. */
export const functionKeys = ['op', ...settingKeys];
export const timedKeys = ['at', 'op', 'target', ...settingKeys];
/** Target and sender filter of a registered event's function are gone (runtime 0.12.273): it changes the sender. */
export function senderOnly(values: Record<string, string>) {
  delete values.target;
  delete values.from;
  return values;
}
/** Retired settings an older file or project may still hold: a shake's `parameters` (runtime 0.12.274: an
 *  annotation's own numbers are AI.CamShake|strength|duration). */
export function dropRetired(values: Record<string, string>) {
  delete values.parameters;
  // A function's own space condition is gone (runtime 0.12.275): a space split is a condition branch.
  delete values.space;
  delete values.minSpace;
  delete values.maxSpace;
  return values;
}
export const settingLabels: Record<string, string> = {
  get plugin() {
    return tr('플러그인');
  },
  get form() {
    return tr('폼 ID');
  },
  get direction() {
    return tr('방향');
  },
  get force() {
    return tr('힘');
  },
  get stamina() {
    return tr('스태미나');
  },
  get magicka() {
    return tr('매지카');
  },
  get strength() {
    return tr('세기');
  },
  get duration() {
    return tr('시간(초)');
  },
  get factor() {
    return tr('배율');
  },
  get delay() {
    return tr('지연(초)');
  },
  get mode() {
    return tr('발사 방식');
  },
  get damage() {
    return tr('피해 %');
  },
};
/** A fireArrow's ways (runtime 0.12.268): the value written for each and what the menu says. */
export const arrowModes = (): [string, string][] => [
  ['', tr('당긴 만큼')],
  ['direct', tr('바로 발사')],
];
/** A ragdoll's directions (runtime 0.12.278) and each one's default force, as FH_Grapple's GrapplePush had them. */
export const ragdollDirections = ['down', 'up', 'forward', 'backward', 'left', 'right'] as const;
export const ragdollForce: Record<string, number> = {down: 1, up: 2, forward: 5, backward: 5, left: 5, right: 5};
export const ragdollLabels: Record<string, string> = {
  get down() {
    return tr('아래');
  },
  get up() {
    return tr('위');
  },
  get forward() {
    return tr('앞');
  },
  get backward() {
    return tr('뒤');
  },
  get left() {
    return tr('왼쪽');
  },
  get right() {
    return tr('오른쪽');
  },
};
const booleanKeys = new Set<string>();
export const isBooleanSetting = (key: string) => booleanKeys.has(key);
const commonFields = ['delay'];
export const fieldsOf = (op: string) => [...(opInfo[op as EventOp]?.fields ?? []), ...commonFields];
const numberRanges: Record<string, [number, number]> = {
  delay: [0, 60],
  stamina: [0, 100000],
  magicka: [0, 100000],
  strength: [0, 10],
  duration: [0, 30],
  factor: [0.05, 5],
  damage: [1, 1000],
  force: [0, 20],
};
export const settingRange = (key: string) => numberRanges[key];
export const settingDefault: Record<string, string> = {
  strength: '1',
  duration: '0.5',
  factor: '1',
  direction: 'down',
  delay: '0',
  damage: '100',
};

// ── The numbers on the HKX nodes (runtime 0.12.281, docs/mockup-event-node-values) ────────────────
// The registry says which functions an event runs and what they act with; each HKX node that sends the event
// holds the numbers they run with there. An event from an animation without a node runs with the defaults.
const spellOps = ['spell', 'stateOn', 'stateOff'];
/** What a registered function acts with, set in the registry: a spell's plugin and form, a ragdoll's direction. */
export const registryFields = (op: string): string[] =>
  spellOps.includes(op) ? ['plugin', 'form'] : op === 'ragdoll' ? ['direction'] : [];
/** The numbers a registered function runs with, set on each HKX node that sends its event (delay included). */
export const valueFields = (op: string) => fieldsOf(op).filter(k => !registryFields(op).includes(k));
/** Functions the runtime runs only with a node's numbers: a cost's amount and a time scale's factor. */
export const needsValues = (op: string) => op === 'cost' || op === 'timeOn';
/** The numbers an older registry function still holds (the runtime refuses them there since 0.12.281). */
export const registryNumbers = (values: Record<string, string>) =>
  valueFields(values.op).filter(k => values[k] !== undefined && values[k] !== '');
const pick = (values: Record<string, string>, keys: string[]) =>
  Object.fromEntries(keys.filter(k => values[k] !== undefined && values[k] !== '').map(k => [k, values[k]]));
/** A registry function's own part: op and what it acts with. */
export const registryPart = (values: Record<string, string>) => pick(values, ['op', ...registryFields(values.op)]);
/** A node's part of a function: op and its numbers. */
export const valuePart = (values: Record<string, string>) => pick(values, ['op', ...valueFields(values.op)]);
/** Where a node keeps a registry function's numbers: by row and function id, which a rename keeps. */
export const valueKey = (row: EventRow, fn: Effect) => `${row.id}/${fn.id}`;
type Valued = {config: {eventValues?: Record<string, Record<string, string>>}};
/** A node's numbers for a registry function, or undefined (the defaults). */
export function nodeValues(a: Valued | undefined, row: EventRow, fn: Effect): Record<string, string> | undefined {
  const v = a?.config.eventValues?.[valueKey(row, fn)];
  return v && v.op === fn.values.op ? v : undefined;
}
/** The function a node runs: the registry's part with the node's numbers. */
export const runValues = (a: Valued | undefined, row: EventRow, fn: Effect) => ({
  ...registryPart(fn.values),
  ...valuePart(nodeValues(a, row, fn) ?? {op: fn.values.op}),
});
/** Sets (or, with no values, clears) one node's numbers for a registry function. */
export function setNodeValues(
  w: Workspace,
  action: string,
  row: EventRow,
  fn: Effect,
  values?: Record<string, string>
): Workspace {
  const next = clone(w),
    a = next.actions.find(x => x.uid === action);
  if (!a) return w;
  const all = {...(a.config.eventValues ?? {})};
  if (values) all[valueKey(row, fn)] = valuePart({...values, op: fn.values.op});
  else delete all[valueKey(row, fn)];
  if (Object.keys(all).length) a.config.eventValues = all;
  else delete a.config.eventValues;
  return next;
}
/** Drops the numbers of functions the registry no longer has (or that now run another op). */
function pruneValues(w: Workspace) {
  const live = new Map<string, string>();
  for (const row of w.eventRegistry ?? []) for (const f of row.functions) live.set(valueKey(row, f), f.values.op);
  const prune = (a: Valued | undefined) => {
    const all = a?.config.eventValues;
    if (!all) return;
    for (const [k, v] of Object.entries(all)) if (live.get(k) !== v.op) delete all[k];
    if (!Object.keys(all).length) delete a!.config.eventValues;
  };
  for (const a of w.actions) prune(a);
  for (const d of w.drafts ?? []) prune(d.value as Valued | undefined);
}
/** Values pair with an event's functions by op, in order (runtime EventValuesMatch.h): a node that gives numbers to
 *  a later function of an op writes the earlier ones of that op too, with their defaults. */
export function eventValuesXml(w: Workspace, a: Valued): Xml | undefined {
  const events: Xml[] = [];
  for (const row of w.eventRegistry ?? []) {
    const given = row.functions.map(f => nodeValues(a, row, f));
    if (!given.some(Boolean)) continue;
    const last = new Map<string, number>();
    given.forEach((v, i) => v && last.set(row.functions[i].values.op, i));
    const dos = row.functions.flatMap((f, i) =>
      i <= (last.get(f.values.op) ?? -1) ? [node('Do', doAttrs(valuePart(given[i] ?? {op: f.values.op})))] : []
    );
    events.push(node('Event', {name: row.name}, dos));
  }
  return events.length ? node('EventValues', {}, events) : undefined;
}
/** An action's <EventValues>, matched to the registry's functions by op in order; values for an event or a function
 *  the registry does not hold are dropped, as the runtime drops them. */
export function readEventValues(n: Xml, rows: EventRow[], a: Valued) {
  shapeXml(n, [], ['Event']);
  const out: Record<string, Record<string, string>> = {};
  for (const e of n.children) {
    shapeXml(e, ['name'], ['Do']);
    const row = rows.find(r => eventKey(r.name) === eventKey(e.attrs.name ?? ''));
    const seen = new Map<string, number>();
    for (const d of e.children) {
      shapeXml(d, ['op', ...valueKeysAll]);
      const values = {...d.attrs};
      if (!values.op) throw Error(tr('EventValues Do.op: 필수 값'));
      const errors = valueErrors(values);
      if (errors.length) throw Error(`EventValues Do(${values.op}): ${errors[0]}`);
      const i = seen.get(values.op) ?? 0;
      seen.set(values.op, i + 1);
      const fn = row?.functions.filter(f => f.values.op === values.op)[i];
      if (row && fn) out[valueKey(row, fn)] = valuePart(values);
    }
  }
  if (Object.keys(out).length) a.config.eventValues = out;
}
const valueKeysAll = ['delay', 'stamina', 'magicka', 'strength', 'duration', 'factor', 'mode', 'damage', 'force'];
/** Errors of a node's numbers for one function. */
export function valueErrors(v: Record<string, string>): string[] {
  const out: string[] = [];
  if (!eventOps.includes(v.op as EventOp)) out.push(tr('기능을 선택하세요.'));
  const allowed = new Set(valueFields(v.op));
  for (const k of valueKeysAll)
    if (v[k] !== undefined && v[k] !== '' && !allowed.has(k))
      out.push(tr('{key}은(는) 이 기능의 수치가 아닙니다.', {key: settingLabels[k] ?? k}));
  if (v.mode !== undefined && v.mode !== '' && !['drawn', 'direct'].includes(v.mode))
    out.push(tr('발사 방식은 활 발사의 당긴 만큼 또는 바로 발사입니다.'));
  if (v.damage !== undefined && v.damage !== '' && v.mode !== 'direct')
    out.push(tr('피해 %는 바로 발사에서만 씁니다.'));
  for (const [k, [min, max]] of Object.entries(numberRanges))
    if (
      v[k] !== undefined &&
      v[k] !== '' &&
      !(Number.isFinite(Number(v[k])) && Number(v[k]) >= min && Number(v[k]) <= max)
    )
      out.push(`${settingLabels[k]}: ${min}~${max}`);
  if (v.op === 'cost' && !Number(v.stamina) && !Number(v.magicka)) out.push(tr('스태미나나 매지카를 넣으세요.'));
  if (v.op === 'timeOn' && !(v.factor ?? '').trim()) out.push(tr('배율을 넣으세요.'));
  return out;
}
/** Moves an older registry's numbers to the nodes whose HKX send each event (runtime 0.12.281). A node keeps the
 *  numbers it already has; with no sender the numbers are dropped (the event then runs with the defaults). */
export function numbersToNodes(w: Workspace, senders: (event: string) => string[], only?: string): Workspace {
  let next = w;
  for (const row of w.eventRegistry ?? []) {
    if (only !== undefined && eventKey(row.name) !== eventKey(only)) continue;
    for (const f of row.functions) {
      if (!registryNumbers(f.values).length) continue;
      for (const uid of senders(eventKey(row.name))) {
        const a = next.actions.find(x => x.uid === uid);
        if (a && !nodeValues(a, row, f)) next = setNodeValues(next, uid, row, f, valuePart(f.values));
      }
    }
  }
  return withRows(next, rows => {
    for (const row of rows) {
      if (only !== undefined && eventKey(row.name) !== eventKey(only)) continue;
      for (const f of row.functions) f.values = registryPart(f.values);
    }
  });
}

const eventNameOk = (s: string) => !!s.trim() && s.length <= 256 && !/[|@\x00-\x1f]/.test(s);
export const eventKey = (name: string) => name.toLowerCase();
/** A registered function on a vanilla behavior event name runs across the whole game. An annotation
 *  "Name.payload" (SoundPlay.WPNSwingFx, StartAnimatedCamera.Camera3rd [Cam3]) is the vanilla event Name
 *  with a payload. */
export const vanillaName = (name: string) =>
  vanillaEvents.has(eventKey(name)) || vanillaEvents.has(eventKey(name.split('.')[0]));

/** The attributes of one <Do>. Defaults (target sender, from any) and settings the op does not use are left out. */
export function doAttrs(values: Record<string, string>, timed = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (timed) out.at = values.at ?? '0';
  out.op = values.op;
  if (timed && values.target && values.target !== 'both') out.target = values.target;
  const used = new Set(fieldsOf(values.op));
  for (const k of settingKeys) if (used.has(k) && values[k] !== undefined && values[k] !== '') out[k] = values[k];
  // Only a direct shot has a damage, and 100% is the runtime's default.
  if (out.mode !== 'direct' || out.damage === '100') delete out.damage;
  if (out.mode !== 'direct') delete out.mode;
  return out;
}
/** Chip text: the op and only what differs from the defaults. */
export function functionSummary(values: Record<string, string>): string {
  return [opInfo[values.op as EventOp]?.label ?? values.op, ...functionParts(values)].join(' · ');
}
/** A function's settings without its name (a card item already titled by it): the defaults left out. */
export function functionParts(values: Record<string, string>): string[] {
  const parts: string[] = [];
  if (values.target && values.target !== 'both') parts.push(pairRoleLabels[values.target] ?? values.target);
  if (values.form) parts.push(values.form);
  if (values.op === 'cost')
    parts.push(
      [values.stamina && tr('스태미나 ') + values.stamina, values.magicka && tr('매지카 ') + values.magicka]
        .filter(Boolean)
        .join(' ') || '0'
    );
  if (values.op === 'timeOn' && values.factor) parts.push('×' + values.factor);
  if (values.op === 'shake' && (values.strength || values.duration))
    parts.push(tr('세기 {s} · {d}초', {s: values.strength || '1', d: values.duration || '0.5'}));
  if (values.op === 'fireArrow' && values.mode === 'direct')
    parts.push(tr('바로 발사 · 피해 {damage}%', {damage: values.damage || '100'}));
  if (values.op === 'ragdoll') {
    const d = values.direction || 'down';
    parts.push(ragdollLabels[d] ?? d, tr('힘 {f}', {f: values.force || String(ragdollForce[d] ?? 1)}));
  }
  if (values.delay && Number(values.delay)) parts.push(tr('지연 ') + values.delay + tr('초'));
  return parts;
}
export const lastingOp = (op: string) => !!opInfo[op as EventOp]?.lasting;

const nextId = (prefix: string, used: Iterable<string>) => {
  const ids = new Set(used);
  let i = 1;
  while (ids.has(prefix + i)) i++;
  return prefix + i;
};
const sameFunction = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(doAttrs(a)) === JSON.stringify(doAttrs(b));

/** Adds a name (first spelling wins, case ignored) and, if given, a function unless an equal one is there. */
export function registerIn(rows: EventRow[], name: string, values?: Record<string, string>): EventRow {
  let row = rows.find(r => eventKey(r.name) === eventKey(name));
  if (!row) {
    row = {
      id: nextId(
        'event',
        rows.map(r => r.id)
      ),
      name,
      functions: [],
    };
    rows.push(row);
  }
  if (values && !row.functions.some(f => sameFunction(f.values, values)))
    row.functions.push({
      id: nextId(
        'fn',
        row.functions.map(f => f.id)
      ),
      values: {...values},
    });
  return row;
}

// ── Older documents ─────────────────────────────────────────────────────────────────────────────
// role/source became target/from (runtime D5). Old roles: other = the sender's partner, target = the
// pair's target actor (the receiver). Old sources sender/both accepted either pair actor: any.
const ROLE: Record<string, string> = {other: 'partner', target: 'receiver'};
const SOURCE: Record<string, string> = {sender: 'any', both: 'any', target: 'receiver'};
export const liftTarget = (v: string) => ROLE[v] ?? v;
export const liftFrom = (v: string) => SOURCE[v] ?? v;
function liftKeys(values: Record<string, string>) {
  if ('role' in values) {
    values.target = liftTarget(values.role);
    delete values.role;
  }
  if ('source' in values) {
    values.from = liftFrom(values.source);
    delete values.source;
  }
}
const slotOps = {
  rotate: ['rotateOn', 'rotateOff'],
  iframe: ['iframeOn', 'iframeOff'],
  armor: ['armorOn', 'armorOff'],
  cost: ['cost'],
} as const;
const isMark = (m: any): m is Mark => !!m && typeof m === 'object' && typeof m.basis === 'string';
/**
 * Moves every event-moment function of an older document into the registry (format 3 has them only
 * there): pair effects named by an event, event-timed pair tracks, action windows and costs whose both
 * moments are events, the event shot, extra graph registrations, the project event list and the
 * per-action event lists. Renames role/source values. Idempotent; runs on the raw parsed JSON.
 */
export function liftToRegistry(w: any) {
  if (!w || typeof w !== 'object') return;
  const rows: EventRow[] = Array.isArray(w.eventRegistry) ? w.eventRegistry : [];
  // What a function acts with goes to the registry; its numbers stay the owning action's (runtime 0.12.281).
  const register = (name: unknown, values?: Record<string, string>, owner?: any) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const v = values && senderOnly({...values}),
      part = v && registryPart(v);
    const row = registerIn(rows, name.trim(), part);
    const own = v && valuePart(v);
    if (!part || !own || Object.keys(own).length < 2 || !owner?.config || typeof owner.config !== 'object') return;
    const fn = row.functions.find(f => JSON.stringify(doAttrs(f.values)) === JSON.stringify(doAttrs(part)));
    if (fn) owner.config.eventValues = {...(owner.config.eventValues ?? {}), [valueKey(row, fn)]: own};
  };
  // A function saved with a target or a sender filter changes its sender now (runtime 0.12.273); payload
  // spellings and shake parameters are gone (0.12.274: AI.CamShake annotations carry the numbers).
  for (const row of rows) {
    if (row && typeof row === 'object') delete (row as {values?: unknown}).values;
    for (const f of row?.functions ?? []) if (f?.values) dropRetired(senderOnly(f.values));
  }
  const visit = (a: any) => {
    if (!a || typeof a !== 'object') return;
    const p = a.config;
    if (p && typeof p === 'object') {
      if (Array.isArray(p.extraEvents)) {
        p.extraEvents.forEach((n: unknown) => register(n));
        delete p.extraEvents;
      }
      if (Array.isArray(p.events) && p.events.length) {
        p.events.forEach((n: unknown) => register(n));
        p.events = [];
      }
      if (p.fireArrow && typeof p.fireArrow === 'object' && !('onRelease' in p.fireArrow)) {
        const m = p.fireArrow.at;
        if (isMark(m) && m.basis === 'event') {
          register(m.event, {op: 'fireArrow'});
          p.fireArrow = {at: null, onRelease: true};
        } else p.fireArrow = {at: isMark(m) ? m : null, onRelease: true};
      }
      for (const key of ['rotate', 'iframe', 'armor'] as const) {
        const s = p.slots?.[key];
        if (!s?.enabled || !isMark(s.from) || !isMark(s.until) || s.from.basis !== 'event' || s.until.basis !== 'event')
          continue;
        register(s.from.event, {op: slotOps[key][0]});
        register(s.until.event, {op: slotOps[key][1]});
        s.enabled = false;
        s.from = mark();
        s.until = mark(0, 'end');
      }
      if (p.cost?.enabled && isMark(p.cost.at) && p.cost.at.basis === 'event') {
        register(
          p.cost.at.event,
          {
            op: 'cost',
            stamina: String(p.cost.stamina ?? 0),
            magicka: String(p.cost.magicka ?? 0),
          },
          a
        );
        p.cost.enabled = false;
        p.cost.at = mark(0.05);
      }
    }
    const pair = a.pair;
    if (pair && typeof pair === 'object') {
      if (Array.isArray(pair.effects))
        pair.effects = pair.effects.filter((e: any) => {
          const v = e?.values;
          if (!v || typeof v !== 'object') return true;
          liftKeys(v);
          if (v.name !== undefined && v.at === undefined) {
            register(v.name, (({name, ...rest}) => rest)(v), a);
            return false;
          }
          delete v.name;
          return true;
        });
      for (const [key, t] of Object.entries(pair.timeline ?? {}) as [string, any][]) {
        if (!t || typeof t !== 'object') continue;
        if (typeof t.role === 'string') t.role = liftTarget(t.role);
        if (typeof t.source === 'string') t.source = liftFrom(t.source);
        const ops = slotOps[key as keyof typeof slotOps];
        if (!ops || !t.enabled || !isMark(t.from) || !isMark(t.until)) continue;
        const ends = key === 'cost' ? [t.from] : [t.from, t.until];
        if (!ends.some(m => m.basis === 'event')) continue;
        // An event moment moves to the registry; a clip-time moment stays as a clip-time effect.
        ends.forEach((m, i) => {
          const values: Record<string, string> = {
            op: ops[i],
            target: t.role,
            from: t.source,
            ...(key === 'cost' ? {stamina: String(t.stamina), magicka: String(t.magicka)} : {}),
          };
          if (m.basis === 'event') register(m.event, values, a);
          else {
            pair.effects = Array.isArray(pair.effects) ? pair.effects : [];
            pair.effects.push({
              id: nextId(
                `timeline_${key}_`,
                pair.effects.map((e: any) => e?.id)
              ),
              values: {...values, at: String(m.seconds)},
            });
            pair.effectsEnabled = true;
          }
        });
        t.enabled = false;
        t.from = mark(key === 'cost' ? 0.05 : 0);
        t.until = mark(0.8);
      }
    }
    for (const v of Object.values(a.variants ?? {})) visit(v);
  };
  for (const a of Array.isArray(w.actions) ? w.actions : []) visit(a);
  for (const d of Array.isArray(w.drafts) ? w.drafts : []) visit(d?.value);
  // After the renames above: a pair's clip-time effect names a role and no sender filter (0.12.275); an ordinary
  // action's names none.
  const roles = (a: any) => {
    if (!a || typeof a !== 'object') return;
    for (const e of Array.isArray(a.pair?.effects) ? a.pair.effects : [])
      if (e?.values && typeof e.values === 'object') pairEffectValues(dropRetired(e.values));
    for (const e of Array.isArray(a.config?.effects) ? a.config.effects : [])
      if (e?.values && typeof e.values === 'object') senderOnly(dropRetired(e.values));
    for (const t of Object.values(a.pair?.timeline ?? {}) as any[])
      if (t && typeof t === 'object' && 'role' in t) {
        t.role = pairRole(t.role, t.source);
        t.source = 'any';
      }
    for (const v of Object.values(a.variants ?? {})) roles(v);
  };
  for (const a of Array.isArray(w.actions) ? w.actions : []) roles(a);
  for (const d of Array.isArray(w.drafts) ? w.drafts : []) roles(d?.value);
  if (Array.isArray(w.eventCatalog)) {
    w.eventCatalog.forEach((n: unknown) => register(n));
    delete w.eventCatalog;
  }
  // Spell rules grouped name-triggered pair spells; the registry holds those now.
  delete w.spellGroups;
  if (rows.length) w.eventRegistry = rows;
  else delete w.eventRegistry;
}

// ── Checks ──────────────────────────────────────────────────────────────────────────────────────
/** Errors of one function's values (a registry function, or a pair clip-time effect with `timed`). */
export function functionErrors(v: Record<string, string>, timed = false): string[] {
  const out: string[] = [];
  if (!eventOps.includes(v.op as EventOp)) out.push(tr('기능을 선택하세요.'));
  if (timed && v.op === 'fireArrow') out.push(tr('시간 기준 활 발사는 동작의 활 발사에서 지정합니다.'));
  if (v.target !== undefined && !(timed && (pairRoles as readonly string[]).includes(v.target)))
    out.push(tr('적용 값이 잘못되었습니다.'));
  if (v.from !== undefined) out.push(tr('반응 조건은 없어졌습니다.'));
  if (v.mode !== undefined && v.mode !== '' && !(v.op === 'fireArrow' && ['drawn', 'direct'].includes(v.mode)))
    out.push(tr('발사 방식은 활 발사의 당긴 만큼 또는 바로 발사입니다.'));
  if (v.damage !== undefined && v.damage !== '' && v.mode !== 'direct')
    out.push(tr('피해 %는 바로 발사에서만 씁니다.'));
  if (
    v.direction !== undefined &&
    !(v.op === 'ragdoll' && (ragdollDirections as readonly string[]).includes(v.direction))
  )
    out.push(tr('방향은 래그돌의 아래·위·앞·뒤·왼쪽·오른쪽입니다.'));
  if (v.force !== undefined && v.force !== '' && v.op !== 'ragdoll') out.push(tr('힘은 래그돌에서만 씁니다.'));
  if (['spell', 'stateOn', 'stateOff'].includes(v.op)) {
    if (!v.plugin || /[\\/:]/.test(v.plugin)) out.push(tr('플러그인 파일 이름을 입력하세요.'));
    if (!/^(?:0x)?[\da-f]{1,8}$/i.test(v.form ?? '')) out.push(tr('16진수 폼 ID를 입력하세요.'));
  }
  for (const [k, [min, max]] of Object.entries(numberRanges))
    if (
      v[k] !== undefined &&
      v[k] !== '' &&
      !(Number.isFinite(Number(v[k])) && Number(v[k]) >= min && Number(v[k]) <= max)
    )
      out.push(`${settingLabels[k]}: ${min}~${max}`);
  for (const k of booleanKeys)
    if (v[k] !== undefined && !['true', 'false'].includes(v[k]))
      out.push(tr('{v0}: 켬/끔 값 오류', {v0: settingLabels[k]}));
  if (timed && !(v.at !== undefined && v.at.trim() !== '' && Number(v.at) >= 0 && Number(v.at) <= 600))
    out.push(tr('시각은 0~600초입니다.'));
  return out;
}
const numbersText = () =>
  tr(
    '등록에 수치가 있습니다. 런타임 0.12.281부터 수치는 이 이벤트를 보내는 HKX 노드에서 넣습니다. 이벤트 등록에서 「수치를 노드로 옮기기」를 누르세요.'
  );
/** An older file's registry numbers: an error to save, not to open (the registry node moves them to the nodes, which
 *  needs the HKX annotations the open does not have). */
export const registryNumbersIssue = (i: Issue) => i.node === 'eventRegistry' && i.message.endsWith(numbersText());
export function registryIssues(w: Workspace): Issue[] {
  const out: Issue[] = [],
    rows = w.eventRegistry ?? [];
  const seen = new Set<string>();
  if (rows.length > 4096)
    out.push({level: 'error', node: 'eventRegistry', message: tr('이벤트 등록은 4096개까지입니다.')});
  const registered = new Set(rows.flatMap(r => r.functions.map(f => f.values.op)));
  for (const r of rows) {
    const where = (m: string) => `${r.name || tr('(이름 없음)')}: ${m}`;
    if (!eventNameOk(r.name))
      out.push({level: 'error', node: 'eventRegistry', message: where(tr('이벤트 이름이 잘못되었습니다.'))});
    if (seen.has(eventKey(r.name)))
      out.push({
        level: 'error',
        node: 'eventRegistry',
        message: where(tr('같은 이벤트가 두 번 등록되었습니다(대소문자 무시).')),
      });
    seen.add(eventKey(r.name));
    if (r.functions.length > 64)
      out.push({level: 'error', node: 'eventRegistry', message: where(tr('기능은 64개까지입니다.'))});
    for (const f of r.functions)
      for (const m of functionErrors(f.values)) out.push({level: 'error', node: 'eventRegistry', message: where(m)});
    if (r.functions.some(f => registryNumbers(f.values).length))
      out.push({level: 'error', node: 'eventRegistry', message: where(numbersText())});
    if (r.functions.length && vanillaName(r.name))
      out.push({
        level: 'warning',
        node: 'eventRegistry',
        message: where(
          tr(
            '바닐라·흔한 이벤트 이름입니다. 등록한 기능이 게임 전체 애니메이션에서 실행됩니다. 모드 고유 접두어를 권장합니다.'
          )
        ),
      });
    const ops = new Map<string, string>();
    for (const f of r.functions) {
      const attrs = JSON.stringify(doAttrs(f.values));
      if (ops.has(f.values.op) && ops.get(f.values.op) !== attrs)
        out.push({
          level: 'warning',
          node: 'eventRegistry',
          message: where(tr('{v0}을(를) 다른 설정으로 두 번 실행합니다.', {v0: opInfo[f.values.op as EventOp]?.label})),
        });
      ops.set(f.values.op, attrs);
    }
    for (const f of r.functions) {
      const off = opInfo[f.values.op as EventOp]?.lasting;
      if (off && !registered.has(off))
        out.push({
          level: 'warning',
          node: 'eventRegistry',
          message: where(
            tr(
              '켜 두는 기능({label})의 짝 기능({label1})이 등록되지 않았습니다. 동작 종료·사망·래그돌·불러오기 때만 해제됩니다.',
              {label: opInfo[f.values.op as EventOp].label, label1: opInfo[off].label}
            )
          ),
        });
    }
  }
  return out;
}

// ── XML ─────────────────────────────────────────────────────────────────────────────────────────
export function registryXml(w: Workspace): Xml | undefined {
  const rows = w.eventRegistry ?? [];
  if (!rows.length) return undefined;
  return node(
    'EventRegistry',
    {},
    rows.map(r =>
      node(
        'Event',
        {name: r.name},
        // The numbers are the nodes' (<EventValues>, runtime 0.12.281): an older function's are not written.
        r.functions.map(f => node('Do', doAttrs(registryPart(f.values))))
      )
    )
  );
}
const eventDoAttrs = functionKeys;
/** One <Do> of a registered event, or (`timed`) of a pair's <Effects>. */
export function readDo(n: Xml, timed: boolean): Record<string, string> {
  // An older file's event function with a target or sender filter opens as one changing its sender (0.12.273).
  if (!timed) senderOnly(n.attrs);
  dropRetired(n.attrs);
  // An older file's clip-time target and sender filter become the role they reached (0.12.275).
  if (timed && (n.attrs.from !== undefined || n.attrs.target !== undefined)) {
    const role = pairRole(n.attrs.target, n.attrs.from);
    delete n.attrs.from;
    if (role === 'both') delete n.attrs.target;
    else n.attrs.target = role;
  }
  if (n.attrs.releasePhysics !== undefined)
    throw Error(tr('Do.releasePhysics는 없어졌습니다(런타임 0.12.278): 래그돌은 래그돌 기능(op="ragdoll")을 씁니다.'));
  shapeXml(n, timed ? timedKeys : eventDoAttrs);
  const values = {...n.attrs};
  if (!values.op) throw Error(tr('Do.op: 필수 값'));
  if (values.op === 'lock' || values.op === 'unlock')
    throw Error(tr('Do({op}): 조작 잠금(lock·unlock)은 없어졌습니다(런타임 0.12.238).', {op: values.op}));
  if (values.form) values.form = values.form.replace(/^0x/i, '');
  const errors = functionErrors(values, timed);
  if (errors.length) throw Error(`Do(${values.op}): ${errors[0]}`);
  return values;
}
export function readRegistry(r: Xml, rows: EventRow[]) {
  shapeXml(r, [], ['Event']);
  const names = new Set<string>();
  for (const e of r.children) {
    shapeXml(e, ['name', 'values'], ['Do', 'QTE']);
    const name = e.attrs.name ?? '';
    if (!eventNameOk(name)) throw Error(tr('Event.name: 이벤트 이름이 잘못되었습니다: ') + name);
    if (names.has(eventKey(name))) throw Error(tr('같은 이벤트를 두 번 등록했습니다: ') + name);
    names.add(eventKey(name));
    // An event that only starts QTEs (runtime 0.12.248) is no registry row: its QTE cards carry it (qte.ts
    // readEventQtes), and writing them back gives the same <Event>.
    const dos = e.children.filter(d => d.name === 'Do');
    // An older file's payload spellings (values) are dropped: AI.CamShake annotations carry numbers (0.12.274).
    if (!dos.length && e.children.some(d => d.name === 'QTE')) continue;
    registerIn(rows, name);
    for (const d of dos) registerIn(rows, name, readDo(d, false));
  }
}

// ── Uses: where this project refers to an event by name ─────────────────────────────────────────
/** An event moment of the project that may name an event (or fall back to a clip time). */
export type EventSlot = {
  key: string;
  label: string;
  node: string;
  mark: Mark;
  allowEnd: boolean;
  /** The action whose clip the moment belongs to, the clip when it is one clip's, and the label as that
   *  action's own card shows it (without the action's name). */
  owner?: string;
  step?: string;
  local?: string;
};
const outcomeLabels: Record<string, string> = {
  get success() {
    return tr('성공');
  },
  get failure() {
    return tr('실패');
  },
  get perfect() {
    return tr('완벽');
  },
};
const playNode = (w: Workspace, uid: string, step?: string) => {
  const a = w.actions.find(a => a.uid === uid);
  return animId(uid, 'clip_' + (step ?? a?.config.entry ?? ''));
};
/** Every moment that accepts an event in format 3. `mark` points into `w`: mutate a clone. */
export function eventSlots(w: Workspace): EventSlot[] {
  const out: EventSlot[] = [];
  for (const a of w.actions) {
    const p = a.config,
      name = p.name || p.actionId,
      hkx = playNode(w, a.uid),
      first = out.length;
    out.push({
      key: `${a.uid}|exit`,
      label: tr('종료 시점 · {name}', {name}),
      node: hkx,
      mark: p.exit,
      allowEnd: true,
      local: tr('종료 시점'),
    });
    if (p.recovery.enabled)
      out.push({
        key: `${a.uid}|recovery`,
        label: tr('이동키 취소 · {name}', {name}),
        node: hkx,
        mark: p.recovery.at,
        allowEnd: false,
        local: tr('이동키 취소'),
      });
    for (const s of p.steps)
      if (s.recovery)
        out.push({
          key: `${a.uid}|recovery:${s.id}`,
          label: tr('이동키 취소 · {name} · {label}', {name, label: s.label}),
          node: playNode(w, a.uid, s.id),
          mark: s.recovery.at,
          allowEnd: false,
          step: s.id,
          local: tr('이동키 취소'),
        });
    for (const [step, win] of Object.entries(a.clipWindows ?? {})) {
      const node = playNode(w, a.uid, step);
      out.push({
        key: `${a.uid}|clipWindow:${step}:open`,
        label: tr('감지 창 시작 · {name} {step}', {name, step}),
        node,
        mark: win.open,
        allowEnd: false,
        step,
        local: tr('감지 창 시작'),
      });
      out.push({
        key: `${a.uid}|clipWindow:${step}:close`,
        label: tr('감지 창 끝 · {name} {step}', {name, step}),
        node,
        mark: win.close,
        allowEnd: true,
        step,
        local: tr('감지 창 끝'),
      });
    }
    for (const c of a.cancels) {
      out.push({
        key: `${a.uid}|cancel:${c.id}:open`,
        label: tr('바닐라 전환 시작 · {name}', {name}),
        node: hkx,
        mark: c.open,
        allowEnd: false,
        local: tr('바닐라 전환 시작'),
      });
      out.push({
        key: `${a.uid}|cancel:${c.id}:close`,
        label: tr('바닐라 전환 끝 · {name}', {name}),
        node: hkx,
        mark: c.close,
        allowEnd: true,
        local: tr('바닐라 전환 끝'),
      });
    }
    if (p.carryRelease)
      out.push({
        key: `${a.uid}|carryRelease`,
        label: tr('대상 놓기 · {name}', {name}),
        node: hkx,
        mark: p.carryRelease.at,
        allowEnd: false,
        local: tr('대상 놓기'),
      });
    for (const slot of out.slice(first)) slot.owner = a.uid;
  }
  for (const l of w.links)
    if (l.window) {
      const from = w.actions.find(a => a.uid === l.from)?.config.name ?? l.from,
        to = w.actions.find(a => a.uid === l.to)?.config.name ?? l.to,
        node = `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`;
      out.push({
        key: `link:${l.id}|open`,
        label: tr('연결 감지 시작 · {from}→{to}', {from, to}),
        node,
        mark: l.open,
        allowEnd: false,
        owner: l.from,
        local: tr('연결 감지 시작 · → {to}', {to}),
      });
      out.push({
        key: `link:${l.id}|close`,
        label: tr('연결 감지 끝 · {from}→{to}', {from, to}),
        node,
        mark: l.close,
        allowEnd: true,
        owner: l.from,
        local: tr('연결 감지 끝 · → {to}', {to}),
      });
    }
  for (const q of w.qtes ?? [])
    out.push({
      key: `qte:${q.id}|at`,
      label: tr('QTE 시작 · {v0}', {v0: qteName(w, q)}),
      node: 'qte:' + q.id,
      mark: q.at,
      allowEnd: false,
      owner: q.owner,
      step: q.step || undefined,
      local: qteLocal(tr('QTE 시작'), q),
    });
  return out;
}
const actionName = (w: Workspace, uid: string) => {
  const c = w.actions.find(a => a.uid === uid)?.config;
  return c ? c.name || c.actionId : uid;
};
// A QTE keeping its default name "QTE" is named by its action alone.
const ownQteName = (q: {name: string}) => (q.name.trim().toUpperCase() === 'QTE' ? '' : q.name.trim());
const qteName = (w: Workspace, q: {owner: string; name: string}) =>
  [actionName(w, q.owner), ownQteName(q)].filter(Boolean).join(' · ');
const qteLocal = (kind: string, q: {name: string}) => [kind, ownQteName(q)].filter(Boolean).join(' · ');
/** One reference to an event: `name` is its spelling there, `slot` an eventSlots key when it can fall back
 *  to a time, `owner`/`step` the action (and clip) whose playback uses it. */
export type EventUse = {
  name: string;
  label: string;
  node: string;
  slot?: string;
  owner?: string;
  step?: string;
  local?: string;
};
/** The uses an action's own clip card lists: only that action's (and, for one clip's, that clip's), by
 *  their card label, repeats merged ("×2"). */
export function ownUseLabels(uses: EventUse[], owner: string, step: string | undefined): string[] {
  const own = uses.filter(u => u.owner === owner && (!u.step || !step || u.step === step));
  return groupUses(own, u => u.local ?? u.label).map(g => g.text);
}
/** Uses with the same label, in first-seen order; `text` adds the count ("×21") when repeated. */
export type UseGroup = {label: string; text: string; uses: EventUse[]};
export function groupUses(uses: EventUse[], labelOf = (u: EventUse) => u.label): UseGroup[] {
  const groups = new Map<string, EventUse[]>();
  for (const u of uses) {
    const label = labelOf(u);
    groups.set(label, [...(groups.get(label) ?? []), u]);
  }
  return [...groups].map(([label, list]) => ({
    label,
    text: list.length > 1 ? `${label} ×${list.length}` : label,
    uses: list,
  }));
}
/** Every use of each event name (lowercase key): moments naming it and the fixed event references. */
export function eventUses(w: Workspace): Map<string, EventUse[]> {
  const uses = new Map<string, EventUse[]>();
  const add = (name: string | null | undefined, use: Omit<EventUse, 'name'>) => {
    if (!name) return;
    const list = uses.get(eventKey(name)) ?? [];
    list.push({name, ...use});
    uses.set(eventKey(name), list);
  };
  for (const s of eventSlots(w))
    if (s.mark.basis === 'event')
      add(s.mark.event, {label: s.label, node: s.node, slot: s.key, owner: s.owner, step: s.step, local: s.local});
  for (const a of w.actions) {
    const p = a.config,
      name = p.name || p.actionId;
    if (p.start.mode === 'event')
      add(p.start.event, {
        label: tr('시작 트리거 · {name}', {name}),
        node: `start:${a.uid}|markerReceive`,
        owner: a.uid,
        local: tr('시작 트리거'),
      });
    if (a.cameraEnabled && a.camera?.restore === 'event')
      add(cameraReset(w, a.camera), {
        label: tr('카메라 복구 · {name}', {name}),
        node: playNode(w, a.uid),
        owner: a.uid,
        local: tr('페어 카메라 복구'),
      });
  }
  for (const l of w.links)
    if (l.mode === 'event') {
      const from = w.actions.find(a => a.uid === l.from)?.config.name ?? l.from,
        to = w.actions.find(a => a.uid === l.to)?.config.name ?? l.to;
      add(l.event, {
        label: tr('전환 수신 · {from} → {to}', {from, to}),
        node: `link:${l.id}|markerReceive`,
        owner: l.from,
        local: tr('전환 수신 · → {to}', {to}),
      });
    }
  for (const q of w.qtes ?? []) {
    const owner = {node: 'qte:' + q.id, owner: q.owner, step: q.step || undefined};
    add(q.stopEvent, {label: tr('QTE 중지 · {v0}', {v0: qteName(w, q)}), ...owner, local: qteLocal(tr('QTE 중지'), q)});
    for (const [outcome, r] of Object.entries(q.results))
      if (r.mode === 'event') {
        const kind = tr('QTE {v0} 시 보냄', {v0: outcomeLabels[outcome] ?? outcome});
        add(r.event, {label: `${kind} · ${qteName(w, q)}`, ...owner, local: qteLocal(kind, q)});
      }
  }
  return uses;
}
/** Points one event moment at `name`, or ('' ) back at its clip time. */
export function bindSlot(w: Workspace, key: string, name: string): Workspace {
  const next = clone(w),
    slot = eventSlots(next).find(s => s.key === key);
  if (!slot) throw Error(tr('항목을 찾지 못했습니다.'));
  const m = slot.mark;
  if (name) {
    // The clip time it had is kept for a switch back (an event moment waits for its event only).
    if (m.basis !== 'event') m.fallbackBasis = m.basis === 'end' ? 'end' : 'seconds';
    m.fallback = false;
    m.basis = 'event';
    m.event = name;
  } else {
    m.basis = slot.allowEnd && m.fallbackBasis === 'end' ? 'end' : 'seconds';
    m.event = '';
    m.fallback = false;
  }
  return next;
}

// ── The registry node's rows ────────────────────────────────────────────────────────────────────
/** A row of the registry node: a stored registration, or a name the project only refers to. */
export type RegistryEntry = {name: string; row?: EventRow; uses: EventUse[]};
export function registryEntries(w: Workspace): RegistryEntry[] {
  const uses = eventUses(w),
    out: RegistryEntry[] = [],
    seen = new Set<string>();
  for (const row of w.eventRegistry ?? []) {
    seen.add(eventKey(row.name));
    out.push({name: row.name, row, uses: uses.get(eventKey(row.name)) ?? []});
  }
  const referenced = [...uses.entries()]
    .filter(([key]) => !seen.has(key))
    .map(([, list]) => ({name: list[0].name, uses: list}))
    .sort((a, b) => a.name.localeCompare(b.name));
  out.push(...referenced);
  return out;
}

// ── Edits ───────────────────────────────────────────────────────────────────────────────────────
const withRows = (w: Workspace, fn: (rows: EventRow[]) => void): Workspace => {
  const next = clone(w),
    rows = next.eventRegistry ?? [];
  fn(rows);
  next.eventRegistry = rows.length ? rows : undefined;
  if (!next.eventRegistry) delete next.eventRegistry;
  pruneValues(next);
  return next;
};
export function addEventRow(w: Workspace, name: string): Workspace {
  if (!eventNameOk(name)) throw Error(tr('이벤트 이름이 잘못되었습니다.'));
  if ((w.eventRegistry ?? []).some(r => eventKey(r.name) === eventKey(name)))
    throw Error(tr('이미 등록된 이벤트입니다.'));
  return withRows(w, rows => registerIn(rows, name));
}
export const newEventName = (w: Workspace) =>
  nextId('NewEvent', [...(w.eventRegistry ?? []).map(r => r.name), ...eventUses(w).keys()]);
export function removeEventRow(w: Workspace, id: string): Workspace {
  const row = w.eventRegistry?.find(r => r.id === id);
  if (!row) return w;
  const used = eventUses(w).get(eventKey(row.name)) ?? [];
  if (used.length)
    throw Error(tr('용도에서 쓰는 이벤트입니다. 먼저 참조를 바꾸세요: ') + used.map(u => u.label).join(', '));
  return withRows(w, rows =>
    rows.splice(
      rows.findIndex(r => r.id === id),
      1
    )
  );
}
/** Renames a registration and every reference to it (case ignored). */
export function renameEvent(w: Workspace, oldName: string, name: string): Workspace {
  if (!eventNameOk(name)) throw Error(tr('이벤트 이름이 잘못되었습니다.'));
  const clash = registryEntries(w).some(
    e => eventKey(e.name) === eventKey(name) && eventKey(e.name) !== eventKey(oldName)
  );
  if (clash) throw Error(tr('이미 있는 이벤트 이름입니다.'));
  const next = clone(w),
    key = eventKey(oldName);
  for (const r of next.eventRegistry ?? []) if (eventKey(r.name) === key) r.name = name;
  for (const s of eventSlots(next)) if (s.mark.basis === 'event' && eventKey(s.mark.event) === key) s.mark.event = name;
  const same = (v: string | undefined) => !!v && eventKey(v) === key;
  for (const a of next.actions) {
    if (same(a.config.start.event)) a.config.start.event = name;
    if (a.camera && same(a.camera.reset)) a.camera.reset = name;
  }
  if (same(next.globals.cameraReset ?? undefined)) next.globals.cameraReset = name;
  for (const l of next.links) if (same(l.event)) l.event = name;
  for (const q of next.qtes ?? []) {
    if (same(q.stopEvent)) q.stopEvent = name;
    for (const r of Object.values(q.results)) if (r.mode === 'event' && same(r.event)) r.event = name;
  }
  return next;
}
export function setFunctions(w: Workspace, name: string, functions: Effect[]): Workspace {
  return withRows(w, rows => {
    const row = registerIn(rows, name);
    row.functions = functions;
  });
}
export function addFunction(w: Workspace, name: string, op: EventOp = 'spell'): Workspace {
  return withRows(w, rows => {
    const row = registerIn(rows, name);
    row.functions.push({
      id: nextId(
        'fn',
        row.functions.map(f => f.id)
      ),
      values: {op},
    });
  });
}
