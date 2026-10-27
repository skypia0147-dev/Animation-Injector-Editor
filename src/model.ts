import {extensionErrors, stripExtensions, type Suppression} from './runtimeExtensions.ts';
import {keyCodes, gameControlLabel, isGameControl, type GameControl} from './keys.ts';
export type Position = {x: number; y: number};
export type Mark = {
  basis: 'seconds' | 'end' | 'event';
  seconds: number;
  event: string;
  fallback: boolean;
  fallbackBasis: 'seconds' | 'end';
};
import {tr} from './i18n/korean.ts';
import {errorText} from './errorText.ts';
/** A key and button, or a game control (control, runtime 0.12.292) instead of both. */
export type Input = {id: string; label: string; key: string; gamepad: number; control?: GameControl};
export type Step = {
  id: string;
  label: string;
  clip: string;
  recovery?: Project['recovery'];
  localPath: string;
  attack: string;
  position: Position;
};
export type RangeSlot = {enabled: boolean; from: Mark; until: Mark};
export type Project = {
  schema: 2;
  kind: 'single';
  name: string;
  actionId: string;
  entry: string;
  inputs: Input[];
  events: string[];
  /** Where it may play: on the ground only (deny), the ground and the air (allow, XML air="both"), the air only. */
  air: 'deny' | 'allow' | 'only';
  /** Vanilla events blocked while it plays (XML format 6 <Action block>; `when` is always 'active'). A start's own
   *  block is the start card's (cards.ts StartCard). */
  suppress?: Suppression;
  /** Putdown Action of a carry: when the carried target is released as a ragdoll. */
  carryRelease?: {at: Mark};
  /** Clip-time functions on the actor playing it (runtime 0.12.274, clipEffects.ts): values as a pair effect's,
   *  without target or from. Absent = none. */
  effects?: {id: string; values: Record<string, string>}[];
  /** The numbers this HKX runs the registry's functions with when its clip sends their event (runtime 0.12.281,
   *  <EventValues>, docs/mockup-event-node-values), by registry row and function id (eventRegistry.ts valueKey):
   *  op and that op's numbers. Absent = the defaults. */
  eventValues?: Record<string, Record<string, string>>;
  attack: string;
  enterBlend: number;
  exitBlend: number;
  exit: Mark;
  graph: string[];
  rotationLocked?: boolean;
  slots: Record<'rotate' | 'iframe' | 'armor', RangeSlot>;
  recovery: {enabled: boolean; at: Mark; blend: number};
  cost: {enabled: boolean; at: Mark; stamina: number; magicka: number};
  trigger: Position;
  steps: Step[];
};
export type Issue = {level: 'error' | 'warning'; node: string; message: string};
/** A deep copy of plain data: records, arrays and primitives, which documents are made of. A recursive copy is
 *  about four times faster than structuredClone on a large project, and every edit copies the document.
 *  Anything else (a Map, a Date, a class instance) is copied by structuredClone. A record reached twice
 *  becomes two copies. */
export const clone = <T>(v: T): T => copyPlain(v) as T;
/** A copy of `source` for an edit function to change, whose top-level fields are copied (clone) when the
 *  function first reads or sets them. `finish(result)`: when the function returned the copy, the fields it
 *  never touched become the source's own values, unchanged and shared, so the history does not compare
 *  them (Grapple's QTEs are 60% of the document, and most edits never read them). Anything that reads every
 *  field (a spread, JSON, clone) copies every field, like clone. */
const draftSources = new WeakMap<object, object>();
/** The document an edit's copy (editableCopy) was made from: read only, never changed. */
export const draftSource = <T extends object>(draft: T) => draftSources.get(draft) as T | undefined;
export function editableCopy<T extends object>(source: T): {copy: T; finish: (result: T) => T} {
  const copy = {} as T,
    record = copy as Record<string, unknown>,
    original = source as Record<string, unknown>;
  const settle = (key: string, value: unknown) =>
    Object.defineProperty(record, key, {value, writable: true, enumerable: true, configurable: true});
  const keys = Object.keys(original);
  for (const key of keys)
    Object.defineProperty(record, key, {
      enumerable: true,
      configurable: true,
      get() {
        const value = clone(original[key]);
        settle(key, value);
        return value;
      },
      set(value) {
        settle(key, value);
      },
    });
  draftSources.set(copy, source);
  const finish = (result: T) => {
    if (result === copy)
      for (const key of keys) if (Object.getOwnPropertyDescriptor(record, key)?.get) settle(key, original[key]);
    return result;
  };
  return {copy, finish};
}
function copyPlain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = copyPlain(v[i]);
    return out;
  }
  const prototype = Object.getPrototypeOf(v);
  if (prototype !== Object.prototype && prototype !== null) return structuredClone(v);
  const record = v as Record<string, unknown>,
    out: Record<string, unknown> = {};
  for (const key in record)
    if (Object.hasOwn(record, key)) {
      const value = copyPlain(record[key]);
      // An own "__proto__" (JSON.parse makes one) stays a key; assigning it would set the prototype.
      if (key === '__proto__')
        Object.defineProperty(out, key, {value, writable: true, enumerable: true, configurable: true});
      else out[key] = value;
    }
  return out;
}
export const keys = Object.keys(keyCodes);
export const fullBodyGraph = 'FullBodyPlayerIdles_Behavior';
export const graphs = [fullBodyGraph, '1HM_Behavior', 'MT_RootBehavior', 'MagicBehavior', 'RootBehaviorGraph'];
export const mark = (seconds = 0, basis: Mark['basis'] = 'seconds'): Mark => ({
  basis,
  seconds,
  event: '',
  fallback: false,
  fallbackBasis: basis === 'end' ? 'end' : 'seconds',
});
const range = (until = 0.3, enabled = false): RangeSlot => ({enabled, from: mark(), until: mark(until)});
const idPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 1024 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const num = (v: unknown, max = 600, min = 0): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const eventValid = (v: string) => text(v) && !!v.trim() && v.length <= 256 && !/[|@\r\n\t]/.test(v);
/** A path the game can open: printable ASCII (letters, digits and the symbols Windows allows in names).
 *  The engine reads animation files through narrow code-page paths, so a Korean name is never found;
 *  the runtime's declaration check (XmlV2 clip) and the desktop backend apply the same rule. */
export const hkxPathOk = (path: string) => /^[\x20-\x7e]*$/.test(path) && !/[*?"<>|]/.test(path);
export const keyCode = (key: string): number =>
  /^code:\d+$/.test(key)
    ? Number(key.slice(5))
    : (keyCodes[keys.find(k => k.toLowerCase() === key.toLowerCase()) ?? ''] ?? 0);
export const inputLabel = (p: Project, id: string) => {
  const i = p.inputs.find(i => i.id === id);
  return i
    ? `${i.label} · ${i.control ? gameControlLabel(i.control) : i.key || tr('패드 ') + i.gamepad}`
    : tr('입력 미지정');
};
/** A new action: one HKX (ground only); a start card starts it (cards.ts). */
export function createProject(): Project {
  return {
    schema: 2,
    kind: 'single',
    name: 'Single Action',
    actionId: 'EditorSingle',
    entry: 'A1',
    inputs: [],
    events: [],
    air: 'deny',
    attack: '',
    enterBlend: 0.1,
    exitBlend: 0.2,
    exit: mark(0.05, 'end'),
    graph: [fullBodyGraph],
    rotationLocked: false,
    slots: {rotate: range(), iframe: range(), armor: range()},
    recovery: {enabled: false, at: mark(0.9), blend: 0.15},
    cost: {enabled: false, at: mark(0.05), stamina: 0, magicka: 0},
    trigger: {x: 40, y: 150},
    steps: [
      {
        id: 'A1',
        label: tr('단일 동작'),
        clip: 'Animations\\MyMod\\Action.hkx',
        localPath: '',
        attack: '',
        position: {x: 360, y: 140},
      },
    ],
  };
}
// Strict structural validation keeps unknown fields and hidden timing data from being discarded.
function shape(p: unknown): asserts p is Project {
  const template = createProject();
  template.events = [''];
  template.inputs = [{id: 'use', label: 'use', key: 'Num0', gamepad: 0}];
  function visit(value: any, sample: any, path: string) {
    if (Array.isArray(sample)) {
      const max = path === 'events' ? 500 : 100;
      if (!Array.isArray(value) || value.length > max) throw new Error(tr('{path}: 목록 형식 또는 크기 오류', {path}));
      for (const v of value) visit(v, sample[0], path + '[]');
      return;
    }
    if (sample !== null && typeof sample === 'object') {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== Object.keys(sample).length ||
        Object.keys(value).some(k => !Object.hasOwn(sample, k))
      )
        throw new Error(tr('{path}: 알 수 없거나 누락된 필드', {path}));
      for (const k of Object.keys(sample)) visit(value[k], sample[k], path ? path + '.' + k : k);
      return;
    }
    if (
      typeof value !== typeof sample ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value === 'string' && !text(value))
    )
      throw new Error(tr('{path}: 값 형식 오류', {path}));
  }
  visit(stripExtensions(p), template, '');
  const v = p as Project;
  if (v.schema !== 2 || v.kind !== 'single' || !['deny', 'allow', 'only'].includes(v.air))
    throw new Error(tr('지원하지 않는 설정 값입니다.'));
  for (const m of marks(v))
    if (
      !['seconds', 'end', 'event'].includes(m.basis) ||
      !['seconds', 'end'].includes(m.fallbackBasis) ||
      !num(m.seconds)
    )
      throw new Error(tr('시각 형식이 잘못되었습니다.'));
  for (const pos of [v.trigger, ...v.steps.map(s => s.position)])
    if (!num(pos.x, 1e6, -1e6) || !num(pos.y, 1e6, -1e6)) throw new Error(tr('좌표 범위가 잘못되었습니다.'));
}
export function parseProject(contents: string): Project {
  if (contents.length > 2_000_000) throw new Error(tr('프로젝트가 2 MB 제한을 넘었습니다.'));
  const p = JSON.parse(contents);
  shape(p);
  return p;
}
/** A key window (an HKX's detection window or a transition's own): it opens at a clip time or an event and
 *  closes at the end or an event; an event's fallback is a time of the same kind. */
export function windowMarksOk(open: Mark, close: Mark) {
  const ok = (m: Mark, allowed: Mark['basis'][], fallback: Mark['fallbackBasis']) =>
    allowed.includes(m.basis) &&
    num(m.seconds) &&
    (m.basis !== 'event' || (eventValid(m.event) && (!m.fallback || m.fallbackBasis === fallback)));
  return ok(open, ['seconds', 'event'], 'seconds') && ok(close, ['end', 'event'], 'end');
}
export function marks(p: Project): Mark[] {
  return [
    p.exit,
    p.recovery.at,
    ...p.steps.flatMap(s => (s.recovery ? [s.recovery.at] : [])),
    p.cost.at,
    ...(p.carryRelease ? [p.carryRelease.at] : []),
    ...Object.values(p.slots).flatMap(s => [s.from, s.until]),
  ];
}
export function eventNames(p: Project): string[] {
  return [...new Set([...p.events, ...marks(p).map(m => m.event)].filter(Boolean))].sort();
}
export function addEvent(p: Project, name: string): Project {
  if (!eventValid(name) || eventNames(p).includes(name))
    throw new Error(tr('이벤트 이름이 잘못되었거나 이미 있습니다.'));
  return {...p, events: [...p.events, name]};
}
export function renameEvent(p: Project, oldName: string, newName: string): Project {
  if (!eventValid(newName) || eventNames(p).some(n => n === newName && n !== oldName))
    throw new Error(tr('이벤트 이름이 잘못되었거나 이미 있습니다.'));
  const next = clone(p);
  next.events = next.events.map(n => (n === oldName ? newName : n));
  for (const m of marks(next)) if (m.event === oldName) m.event = newName;
  return next;
}
export function removeEvent(p: Project, name: string): Project {
  if (marks(p).some(m => m.event === name)) throw new Error(tr('설정에서 참조하는 이벤트는 삭제할 수 없습니다.'));
  return {...p, events: p.events.filter(e => e !== name)};
}
export function validate(p: Project): Issue[] {
  const out: Issue[] = [];
  const error = (node: string, message: string) => out.push({level: 'error', node, message});
  try {
    shape(p && p.rotationLocked === undefined ? {...p, rotationLocked: false} : p);
  } catch (e) {
    return [{level: 'error', node: 'project', message: errorText(e)}];
  }
  if (!p.name.trim() || !idPattern.test(p.actionId)) error('project', tr('이름과 영문 동작 ID를 입력하세요.'));
  if (!p.graph.length || p.graph.some(g => !graphs.includes(g)) || new Set(p.graph).size !== p.graph.length)
    error('project', tr('지원 그래프를 하나 이상 선택하세요.'));
  if (p.attack && !eventValid(p.attack)) error('project', tr('공격 데이터 이름이 잘못되었습니다.'));
  if (!num(p.enterBlend, 5) || !num(p.exitBlend, 5)) error('project', tr('블렌드(0~5)를 확인하세요.'));
  if (!num(p.recovery.blend, 5) || !num(p.cost.stamina, 100000) || !num(p.cost.magicka, 100000))
    error('project', tr('리커버리 블렌드 또는 자원 소모 범위를 확인하세요.'));
  const inputIds = new Set<string>();
  for (const i of p.inputs) {
    if (!idPattern.test(i.id) || inputIds.has(i.id.toLowerCase()) || !i.label.trim())
      error('inputs', tr('입력 ID/표시명이 잘못되었거나 중복입니다.'));
    inputIds.add(i.id.toLowerCase());
    if (
      i.control !== undefined
        ? !isGameControl(i.control) || i.key || i.gamepad
        : (i.key && (!keyCode(i.key) || keyCode(i.key) > 265)) ||
          (!i.key && !i.gamepad) ||
          !num(i.gamepad, 65535) ||
          !Number.isInteger(i.gamepad)
    )
      error('inputs', tr('{label}: 유효한 키 또는 게임패드를 지정하세요.', {label: i.label}));
  }
  if (p.events.some(e => !eventValid(e)) || new Set(p.events).size !== p.events.length)
    error('events', tr('이벤트 목록에 잘못되거나 중복된 이름이 있습니다.'));
  const checkMark = (m: Mark, node: string, allowed: Mark['basis'][], fallback: Mark['fallbackBasis']) => {
    if (!allowed.includes(m.basis))
      error(
        node,
        m.basis === 'event'
          ? tr('이 위치는 클립 시각만 씁니다. 이벤트로 실행하려면 이벤트 등록에 기능을 등록하세요.')
          : tr('이 위치에서 지원하지 않는 시간 기준입니다.')
      );
    if (m.basis === 'event' && (!eventValid(m.event) || (m.fallback && m.fallbackBasis !== fallback)))
      error(node, tr('이벤트 이름 또는 대체 시각 기준을 확인하세요.'));
  };
  checkMark(p.exit, 'project', ['end', 'event'], 'end');
  // Windows and costs run at clip times; an event moment is a registry function (format 3).
  for (const [name, s] of Object.entries(p.slots))
    if (s.enabled) {
      checkMark(s.from, 'project', ['seconds'], 'seconds');
      checkMark(s.until, 'project', ['seconds', 'end'], 'end');
      if (s.from.basis === 'seconds' && s.until.basis === 'seconds' && s.from.seconds > s.until.seconds)
        error('project', tr('{name}: 종료가 시작보다 빠릅니다.', {name}));
    }
  if (p.recovery.enabled) checkMark(p.recovery.at, 'project', ['seconds', 'event'], 'seconds');
  for (const s of p.steps)
    if (s.recovery) {
      if (!s.recovery.enabled || !num(s.recovery.blend, 5)) error(s.id, tr('HKX 이동키 취소 설정이 잘못되었습니다.'));
      checkMark(s.recovery.at, s.id, ['seconds', 'event'], 'seconds');
    }
  if (p.cost.enabled) checkMark(p.cost.at, 'project', ['seconds'], 'seconds');
  if (p.carryRelease) checkMark(p.carryRelease.at, 'project', ['seconds', 'event'], 'seconds');
  if (p.steps.length !== 1)
    error('project', tr('동작은 HKX 하나입니다. 다음 HKX는 다른 동작으로 만들어 전환으로 이으세요.'));
  const stepIds = new Set<string>();
  for (const s of p.steps) {
    if (!idPattern.test(s.id) || s.id.toLowerCase() === 'next' || stepIds.has(s.id.toLowerCase()))
      error(s.id, tr('클립 ID가 잘못되었거나 중복입니다.'));
    stepIds.add(s.id.toLowerCase());
    if (!s.label.trim()) error(s.id, tr('클립 표시명을 입력하세요.'));
    const path = s.clip.replaceAll('\\', '/');
    if (!path.toLowerCase().endsWith('.hkx') || path.includes(':') || path.split('/').some(v => v === '' || v === '..'))
      error(s.id, tr('캐릭터 폴더 기준 상대 HKX 경로를 입력하세요.'));
    else if (!hkxPathOk(s.clip))
      error(
        s.id,
        tr('HKX 경로는 영문·숫자·일반 기호만 씁니다. 한글 등은 게임이 파일을 찾지 못하니 파일·폴더 이름을 바꾸세요.')
      );
    if (s.attack && !eventValid(s.attack)) error(s.id, tr('클립 공격 데이터 이름이 잘못되었습니다.'));
  }
  if (!p.steps.some(s => s.id === p.entry)) error('trigger', tr('시작 클립을 선택하세요.'));
  for (const message of extensionErrors(p)) error('project', message);
  return out;
}
export const timingLabel = (m: Mark) =>
  m.basis === 'event'
    ? m.event || tr('이벤트 미지정')
    : m.basis === 'end'
      ? m.seconds
        ? tr('끝 − {seconds}초', {seconds: m.seconds})
        : tr('클립 끝')
      : tr('{seconds}초', {seconds: m.seconds});
/** The action shot's summary: its clip time and/or the button-release shot. */
