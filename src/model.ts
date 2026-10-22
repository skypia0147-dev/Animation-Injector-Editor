import {extensionErrors, stripExtensions, type Suppression} from './runtimeExtensions.ts';
import {keyCodes} from './keys.ts';
export type Position = {x: number; y: number};
export type Mark = {
  basis: 'seconds' | 'end' | 'event';
  seconds: number;
  event: string;
  fallback: boolean;
  fallbackBasis: 'seconds' | 'end';
};
import {t} from './i18n/index.ts';
import {tr} from './i18n/korean.ts';
export type Input = {id: string; label: string; key: string; gamepad: number};
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
  start: {
    mode: 'input' | 'event' | 'none';
    input: string;
    event: string;
    actor: 'both' | 'player' | 'npc';
    onKeyUp: boolean;
  };
  air: 'deny' | 'allow' | 'only';
  cooldown: number;
  suppress?: Suppression;
  /** The action's own shot: at a clip time (`at`, seconds) and/or on the attack button's release; neither keeps
   *  the HKX card's item for the event shots without writing a <FireArrow> (10-22).
   *  A shot on an event is a registry function (fireArrow). `mode` 'direct' (runtime 0.12.268): no draw, a full
   *  draw's speed and range, `damage` percent of its damage (absent = 100), one arrow taken; it has no release shot. */
  fireArrow?: {at: Mark | null; onRelease: boolean; mode?: 'direct'; damage?: number};
  /** Putdown Action of a carry: when the carried target is released as a ragdoll. */
  carryRelease?: {at: Mark};
  /** Clip-time functions on the actor playing it (runtime 0.12.274, clipEffects.ts): values as a pair effect's,
   *  without target or from. Absent = none. */
  effects?: {id: string; values: Record<string, string>}[];
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
  return i ? `${i.label} · ${i.key || tr('패드 ') + i.gamepad}` : tr('입력 미지정');
};
export const startLabel = (p: Project) =>
  p.start.mode === 'input'
    ? inputLabel(p, p.start.input)
    : p.start.mode === 'event'
      ? p.start.event || tr('이벤트 미지정')
      : tr('외부 연결 전용');
/** A new action: one HKX, started by its own key (format 4 defaults: no cooldown, ground only). */
export function createProject(): Project {
  return {
    schema: 2,
    kind: 'single',
    name: 'Single Action',
    actionId: 'EditorSingle',
    entry: 'A1',
    inputs: [{id: 'use', label: tr('사용'), key: 'Num0', gamepad: 0}],
    events: [],
    start: {mode: 'input', input: 'use', event: '', actor: 'both', onKeyUp: false},
    air: 'deny',
    cooldown: 0,
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
/** Combos went with XML format 4 (runtime 0.12.233): an action is one HKX, and the next one is another action
 *  joined by a transition. A project saved with a combo (or a schema 1 file, which was one) cannot open. */
export const comboGone = (name: string) =>
  new Error(
    tr(
      '{name}: 콤보는 없어졌습니다(XML 형식 4). HKX마다 동작을 만들고 전환으로 이으세요. 이 프로젝트는 이전 에디터로 열어 XML을 확인한 뒤 다시 만드세요.',
      {name}
    )
  );
/** A saved action's settings before the shape check: a combo is refused; a single action drops the combo
 *  fields it carried (an empty transition list). */
export function dropCombo(p: any, name = tr('프로젝트')) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return;
  if (
    p.kind === 'combo' ||
    (Array.isArray(p.transitions) && p.transitions.length) ||
    (Array.isArray(p.steps) && p.steps.length > 1)
  )
    throw comboGone(typeof p.name === 'string' && p.name ? p.name : name);
  delete p.transitions;
}
/** Removed in runtime 0.12.238, unused by every installed declaration: the control lock (the Lock window,
 *  the lock/unlock functions), Carry weapon="keep" with weaponShow, and External. A project that uses one
 *  cannot open; an unused one is dropped. */
export const removedGone = (name: string, what: string) =>
  new Error(
    tr('{name}: {what}은(는) 없어졌습니다(런타임 0.12.238). 이 프로젝트는 이전 에디터로 열어 그 설정을 끈 뒤 여세요.', {
      name,
      what,
    })
  );
/** A saved action's settings: the lock window. */
export function dropLock(p: any, name = tr('프로젝트')) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return;
  if (p.slots?.lock?.enabled) throw removedGone(typeof p.name === 'string' && p.name ? p.name : name, tr('조작 잠금'));
  if (p.slots && typeof p.slots === 'object') delete p.slots.lock;
  delete p.lockMove;
  delete p.lockLook;
}
// Strict structural validation keeps unknown fields and hidden timing data from being discarded.
function shape(p: unknown): asserts p is Project {
  const template = createProject();
  template.events = [''];
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
  if (
    v.schema !== 2 ||
    v.kind !== 'single' ||
    !['input', 'event', 'none'].includes(v.start.mode) ||
    !['both', 'player', 'npc'].includes(v.start.actor) ||
    !['deny', 'allow', 'only'].includes(v.air)
  )
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
/** Motion is the HKX's AMR annotations only (runtime 0.12.231). A project saved before drops its declared
 *  motion (curve, keys, none/annotation), its start direction and its per-clip directions; a directional
 *  action keeps its entry clip as a single action (one action per direction replaces it). */
export function dropMotion(p: any) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return;
  for (const k of ['motion', 'motionKeys', 'distance', 'duration', 'ease']) delete p[k];
  if (p.start && typeof p.start === 'object') for (const k of ['movement', 'strict', 'direction']) delete p.start[k];
  if (Array.isArray(p.steps))
    for (const s of p.steps)
      if (s && typeof s === 'object') {
        delete s.motion;
        delete s.direction;
      }
  if (p.kind === 'directional') {
    p.kind = 'single';
    if (Array.isArray(p.steps) && p.steps.length) {
      const entry = p.steps.find((s: any) => s?.id === p.entry) ?? p.steps[0];
      p.steps = [entry];
      p.entry = entry?.id;
    }
  }
}
export function parseProject(contents: string): Project {
  if (contents.length > 2_000_000) throw new Error(tr('프로젝트가 2 MB 제한을 넘었습니다.'));
  const p = JSON.parse(contents);
  if (p?.schema === 1) throw comboGone(tr('프로젝트'));
  if (p && p.rotationLocked === undefined) p.rotationLocked = false;
  dropMotion(p);
  dropCombo(p);
  dropLock(p);
  dropSafety(p);
  shape(p);
  return p;
}
/** The maximum play time (Advanced safety) left the editor (10-23, docs/mockup-playback-settings): the runtime
 *  ends a play at its HKX's length and keeps its own default for an HKX it cannot read. A saved value is dropped. */
export function dropSafety(p: any) {
  if (p && typeof p === 'object' && !Array.isArray(p)) delete p.safety;
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
    ...(p.fireArrow?.at ? [p.fireArrow.at] : []),
    ...(p.carryRelease ? [p.carryRelease.at] : []),
    ...Object.values(p.slots).flatMap(s => [s.from, s.until]),
  ];
}
export function eventNames(p: Project): string[] {
  return [...new Set([...p.events, p.start.event, ...marks(p).map(m => m.event)].filter(Boolean))].sort();
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
  if (next.start.event === oldName) next.start.event = newName;
  for (const m of marks(next)) if (m.event === oldName) m.event = newName;
  return next;
}
export function removeEvent(p: Project, name: string): Project {
  if (p.start.event === name || marks(p).some(m => m.event === name))
    throw new Error(tr('설정에서 참조하는 이벤트는 삭제할 수 없습니다.'));
  return {...p, events: p.events.filter(e => e !== name)};
}
export function removeInput(p: Project, id: string): Project {
  if (p.start.input === id) throw new Error(tr('시작에서 참조하는 입력은 삭제할 수 없습니다.'));
  return {...p, inputs: p.inputs.filter(i => i.id !== id)};
}
/** `selecting`: the workspace's selectsOnly(action), whose clip is never played nor written (runtime 0.12.244). */
export function validate(p: Project, selecting = false): Issue[] {
  const out: Issue[] = [];
  const error = (node: string, message: string) => out.push({level: 'error', node, message});
  try {
    shape(p && p.rotationLocked === undefined ? {...p, rotationLocked: false} : p);
  } catch (e) {
    return [{level: 'error', node: 'project', message: String(e)}];
  }
  if (!p.name.trim() || !idPattern.test(p.actionId)) error('project', tr('이름과 영문 동작 ID를 입력하세요.'));
  if (!p.graph.length || p.graph.some(g => !graphs.includes(g)) || new Set(p.graph).size !== p.graph.length)
    error('project', tr('지원 그래프를 하나 이상 선택하세요.'));
  if (p.attack && !eventValid(p.attack)) error('project', tr('공격 데이터 이름이 잘못되었습니다.'));
  if (!num(p.enterBlend, 5) || !num(p.exitBlend, 5) || !num(p.cooldown))
    error('project', tr('블렌드(0~5)와 재사용 간격을 확인하세요.'));
  if (!num(p.recovery.blend, 5) || !num(p.cost.stamina, 100000) || !num(p.cost.magicka, 100000))
    error('project', tr('리커버리 블렌드 또는 자원 소모 범위를 확인하세요.'));
  const inputIds = new Set<string>();
  for (const i of p.inputs) {
    if (!idPattern.test(i.id) || inputIds.has(i.id.toLowerCase()) || !i.label.trim())
      error('inputs', tr('입력 ID/표시명이 잘못되었거나 중복입니다.'));
    inputIds.add(i.id.toLowerCase());
    if (
      (i.key && (!keyCode(i.key) || keyCode(i.key) > 265)) ||
      (!i.key && !i.gamepad) ||
      !num(i.gamepad, 65535) ||
      !Number.isInteger(i.gamepad)
    )
      error('inputs', tr('{label}: 유효한 키 또는 게임패드를 지정하세요.', {label: i.label}));
  }
  const input = (id: string, node: string) => {
    if (!p.inputs.some(i => i.id === id)) error(node, tr('정의된 입력을 선택하세요.'));
  };
  if (p.start.mode === 'input') input(p.start.input, 'trigger');
  if (p.start.mode === 'event' && !eventValid(p.start.event)) error('trigger', tr('시작 이벤트 이름을 입력하세요.'));
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
  if (p.fireArrow?.mode === 'direct') {
    if (!p.fireArrow.at)
      error(
        'project',
        tr('활 발사: 바로 발사는 시각 발사가 필요합니다. 이벤트로 쏘려면 이벤트 등록의 활 발사를 쓰세요.')
      );
    if (p.fireArrow.damage !== undefined && !num(p.fireArrow.damage, 1000, 1))
      error('project', tr('활 발사: 피해는 1~1000%입니다.'));
  }
  // Neither its own shot is fine (10-22): the item stays for the HKX's event shots and no FireArrow is written.
  if (p.fireArrow?.at) checkMark(p.fireArrow.at, 'project', ['seconds'], 'seconds');
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
    if (selecting) {
      // A selecting action plays no clip of its own: an empty or leftover path is never written.
    } else if (
      !path.toLowerCase().endsWith('.hkx') ||
      path.includes(':') ||
      path.split('/').some(v => v === '' || v === '..')
    )
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
    ? (m.event || tr('이벤트 미지정')) + (m.fallback ? tr(' · 대체값 있음') : '')
    : m.basis === 'end'
      ? m.seconds
        ? tr('끝 − {seconds}초', {seconds: m.seconds})
        : tr('클립 끝')
      : tr('{seconds}초', {seconds: m.seconds});
/** The action shot's summary: its clip time and/or the button-release shot. */
export const fireArrowLabel = (f: NonNullable<Project['fireArrow']>) =>
  [
    f.mode === 'direct' ? tr('바로 발사 · 피해 {damage}%', {damage: f.damage ?? 100}) : '',
    f.at ? timingLabel(f.at) + tr(' 발사') : '',
    f.onRelease && f.mode !== 'direct' ? tr('버튼 떼기 발사') : '',
  ]
    .filter(Boolean)
    .join(' · ') || tr('발사 없음');
