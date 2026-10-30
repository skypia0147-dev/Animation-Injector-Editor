import {qteErrors, qteXml, eventQteXml, qteChannelClashes} from './qte.ts';
import {isPairedRig, type PairedRig} from './pairedRigs.ts';
import {defaultCarry, defaultCarryFix, defaultCarryHold, carryErrors, strayCarryRelease} from './carry.ts';
import {XML_FORMAT_VERSION} from './xmlFormat.ts';
import {isGameControl} from './keys.ts';
import {sourceLinks} from './graph/playback.ts';
import {subjectlessKinds} from './graph/conditionExtensions.ts';
import {lowerGraph} from './graph/document.ts';
import type {ActionKind, ActionVariant} from './actionTypes.ts';
import {cardIssues, checkCards} from './cardChecks.ts';
import {writerOf, startXml, sharedXml, rootOrder, linkDestination} from './format6Xml.ts';
import type {ConditionCard, StartCard} from './cards.ts';
import {defaultPairTimeline, pairTrackKeys, pairTimelineEffects} from './pairTimeline.ts';
import type {PairTimeline} from './pairTimeline.ts';
import {cameraReset} from './sharedSettings.ts';
import type {SharedSettings} from './sharedSettings.ts';
import {defaultPackaging, authoringShape, validateParameters} from './authoring.ts';
import type {Packaging, Parameter} from './authoring.ts';
import {clone, createProject, draftSource, keyCode, mark, parseProject, validate, windowMarksOk} from './model.ts';
import type {Project, Mark, Position, Issue, Input} from './model.ts';
import {actionXml, keyAttrs, omitDefaults, windowAttrs} from './compiler.ts';
import {node, documentXml, type Xml} from './xml.ts';
import {runtimeNameUses} from './runtimeNames.ts';
import {
  timedKeys,
  functionKeys,
  registryIssues,
  registryXml,
  eventValuesXml,
  valueErrors,
  functionErrors,
  doAttrs,
  pairRoles,
  eventKey,
} from './eventRegistry.ts';
import type {EventRow} from './eventRegistry.ts';
import {actionView, fixedThird, projectView, viewIssues, views, firstPersonStarts} from './view.ts';
import type {View, FirstPersonStart} from './view.ts';
import {tr} from './i18n/korean.ts';
import {ordinaryEffectOps} from './clipEffects.ts';
import {errorText} from './errorText.ts';
export const operations = [
  'hide',
  'show',
  'spell',
  'stateOn',
  'stateOff',
  'cost',
  'shake',
  'iframeOn',
  'iframeOff',
  'armorOn',
  'armorOff',
  'rotateOn',
  'rotateOff',
  'cancel',
  'timeOn',
  'timeOff',
  'stopVelocity',
  'ragdoll',
  'strike',
  'sound',
  'globalSet',
  'modEvent',
] as const;
/** Keys of a pair's clip-time effect: `at` and a function's (eventRegistry.ts). */
export const effectKeys = timedKeys;
/** A pair's clip-time effect ({at, op, target, from, ...}), or a registered event's function (no `at`). */
export type Effect = {id: string; values: Record<string, string>};
export type Pair = {
  carry?: import('./carry.ts').Carry;
  targetRig?: PairedRig;
  timeline: PairTimeline;
  range: number;
  angle: number;
  lossBlend: number;
  lossEnabled: boolean;
  /** Whether the pair's start turns the two to face each other: false for a pair played from behind. Set from the
   *  HKX's start pose (graph/pairFacing.ts), not by hand. */
  reorientSupport: boolean;
  interruptOnThirdPartyHit: boolean;
  effects: Effect[];
};
/** The player's camera given back after an action (runtime <Effects><Camera>): at its end or on an event after it.
 *  own: this action restores on its own event (reset) instead of the project's (globals.cameraReset). */
export type CameraRestore = {reset: string; restore: 'end' | 'event'; timeout: number; own?: true};
export const defaultCamera = (): CameraRestore => ({reset: '', restore: 'end', timeout: 10});
export type Action = {
  /** Camera restore, any action (10-16: ordinary actions too, runtime 0.12.260; it was a pair's before). The
   *  settings stay when it is switched off. */
  cameraEnabled?: boolean;
  camera?: CameraRestore;
  /** The camera view it plays in (view.ts); absent = the project default. */
  view?: View;
  /** A third-person action the player uses in first person: 'switch' plays it in third person. */
  firstPerson?: FirstPersonStart;
  nodeAuthored?: boolean;
  clipWindows?: Record<string, import('./graph/clipWindows.ts').ClipWindow>;
  cancels: {
    id: string;
    to: string;
    open: Mark;
    close: Mark;
    buffered: boolean;
    blend: number | null;
    /** The id written to the XML (it names the runtime's window events); absent = id. id stays the editor's key. */
    xmlId?: string;
    /** Open for the whole clip (<Window always="true">): open, close and buffered are not written. */
    always?: true;
  }[];
  variants: Partial<Record<ActionKind, ActionVariant>>;
  uid: string;
  config: Project;
  position: Position;
  enterBlendEnabled: boolean;
  exitBlendEnabled: boolean;
  pair: Pair | null;
};
export type Link = {
  /** Through a condition card (XML format 6): the card's uid; `to` is then empty. */
  card?: string;
  blend?: number;
  /** This key transition keeps its own detection window. Otherwise an ordinary HKX's key transitions share the
   *  HKX's window (sourceLinks). Stored only when set. */
  ownWindow?: true;
  id: string;
  from: string;
  to: string;
  partnerTo: string;
  mode: 'input' | 'event';
  input: string;
  event: string;
  window: boolean;
  open: Mark;
  close: Mark;
  buffered: boolean;
  position: Position;
};
/** Node coordinates per graph: layout[graphId][nodeId] = {x, y}. Graph ids: 'root' | state uid | transition id. */
export type Layout = Record<string, Record<string, Position & {text?: string}>>;
export type PreviewAssets = {skeletons: string[]; skins: string[]};
/** HKX registered in the asset browser, including editor-only local preview sources for A1/A2. */
export type AssetRef = {clip: string; localPath: string; preview: PreviewAssets};
export type Workspace = {
  /** The view of actions that do not set one (<AnimationSet view>); absent = third person. */
  view?: View;
  qtes?: import('./qte.ts').QteNode[];
  sharedRules?: import('./graph/sharing.ts').SharedRule[];
  /** The global event registry: every event name the project registers, with its functions. */
  eventRegistry?: EventRow[];
  schema: 9;
  /** Start cards (XML format 6 <Start>), in the document's order among themselves. */
  starts: StartCard[];
  /** Condition cards: a start's, a transition's, a QTE result's, a row's, a True's or False's content, or shared. */
  cards: ConditionCard[];
  /** The root elements' order (start, action and named card uids) as the file had them (format6Xml.ts rootOrder). */
  order: string[];
  layout: Layout;
  assets: AssetRef[];
  globals: SharedSettings;
  sharedInputs: Input[];
  packaging: Packaging;
  parameters: Parameter[];
  id: string;
  name: string;
  actions: Action[];
  links: Link[];
};
export const defaultPair = (): Pair => ({
  targetRig: 'character',
  timeline: defaultPairTimeline(),
  range: 150,
  angle: 60,
  // The survivor's blend out when the partner is lost (OnPartnerLost, 10-20: 0.6 s, what Grapple's pairs use).
  lossBlend: 0.6,
  lossEnabled: true,
  reorientSupport: true,
  interruptOnThirdPartyHit: false,
  effects: [],
});
export function wrap(config: Project, uid = 'a1'): Action {
  return {
    cancels: [],
    variants: {},
    uid,
    config: clone(config),
    position: {x: 120, y: 120},
    enterBlendEnabled: true,
    exitBlendEnabled: true,
    pair: null,
  };
}
export function migrateWorkspace(p: Project): Workspace {
  return {
    schema: 9,
    starts: [],
    cards: [],
    order: [],
    layout: {},
    assets: [],
    globals: {cameraReset: null},
    sharedInputs: [],
    packaging: defaultPackaging(),
    parameters: [],
    id: p.actionId,
    name: p.name,
    actions: [wrap(p)],
    links: [],
  };
}
/** The AnimationSet id of a new project. The runtime names every action after the set (<id>_<action>), so two mods
 *  left with it share it: they still load apart (<id>_2), but each mod should have its own. */
export const DEFAULT_SET_ID = 'MyAnimationSet';
export const emptyWorkspace = (): Workspace => ({
  schema: 9,
  starts: [],
  cards: [],
  order: [],
  layout: {},
  assets: [],
  globals: {cameraReset: null},
  sharedInputs: [],
  packaging: defaultPackaging(),
  parameters: [],
  id: DEFAULT_SET_ID,
  name: tr('새 애니메이션 묶음'),
  actions: [],
  links: [],
});
/** A project name as an AnimationSet id: what the runtime accepts (an English letter first, then letters, digits and
 *  _, at most 64), anything else as _. None when the name has no English letter (a Korean name). */
export function setIdFromName(name: string): string | undefined {
  const id = name
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^[^A-Za-z]+/, '')
    .slice(0, 64)
    .replace(/_+$/, '');
  return id || undefined;
}
/** A new project name. The id follows it while it is the default or the one the old name made; an id the author
 *  wrote stays. */
export function renameProject(w: Workspace, name: string): void {
  const following = w.id === DEFAULT_SET_ID || w.id === setIdFromName(w.name);
  w.name = name;
  if (following) w.id = setIdFromName(name) ?? DEFAULT_SET_ID;
}
const fileName = (clip: string) => (clip.split(/[\\/]/).at(-1) || '').replace(/\.hkx$/i, '');
/** The Action ID an HKX file gives: its name, `_2`, `_3`… when another action has it (compared as the runtime does,
 *  ignoring case); '' when the name has no letter an id can use. */
export function fileActionId(actions: Action[], self: string, clip: string): string {
  const base = setIdFromName(fileName(clip));
  if (!base) return '';
  const taken = new Set(actions.filter(x => x.uid !== self).map(x => x.config.actionId.toLowerCase()));
  let id = base;
  for (let i = 2; taken.has(id.toLowerCase()); i++) id = base.slice(0, 64 - String(i).length - 1) + '_' + i;
  return id;
}
/** An edit that changes an action's first HKX file: its name, Action ID and clip label follow the new file while
 *  they still follow the old one: empty, the new-card default, or what the old file gave. What the author wrote
 *  stays. The runtime names actions after their clips (`<set>_<id>`), so no id is made up: a card with no file yet
 *  has none. Imports and opened projects keep theirs (they do not come through an edit). */
export function followFiles(before: Workspace, next: Workspace): Workspace {
  // Untouched actions are still the document's (editableCopy): nothing changed a file.
  if (Object.getOwnPropertyDescriptor(next, 'actions')?.get) return next;
  const old = new Map(before.actions.map(a => [a.uid, a]));
  const names = ['', tr('새 일반 동작'), tr('새 페어')],
    labels = ['', tr('새 HKX')];
  let changed = false;
  // One at a time: two cards made in one edit (several files dropped) do not take the same id.
  const actions = [...next.actions];
  actions.forEach((a, i) => (actions[i] = follow(a)));
  // Set on the edit's own result (an editableCopy draft keeps its untouched fields the document's).
  if (changed) next.actions = actions;
  return next;
  function follow(a: Action): Action {
    const was = old.get(a.uid);
    const clip = a.config.steps[0]?.clip ?? '',
      oldClip = (was ? was.config.steps[0]?.clip : '') ?? '';
    const steps = a.config.steps.map(s => {
      const previous = was?.config.steps.find(x => x.id === s.id)?.clip ?? '';
      if (s.clip === previous || !s.clip) return s;
      const prior = fileName(previous);
      return [...labels, prior, prior && prior + '.hkx'].includes(s.label) ? {...s, label: fileName(s.clip)} : s;
    });
    const prior = fileName(oldClip),
      priorId = setIdFromName(prior);
    const idFollows =
      clip !== oldClip &&
      (!a.config.actionId || (!!priorId && new RegExp('^' + priorId + '(_\\d+)?$', 'i').test(a.config.actionId)));
    const nameFollows = clip !== oldClip && !!clip && [...names, prior].includes(a.config.name);
    if (!idFollows && !nameFollows && steps.every((s, i) => s === a.config.steps[i])) return a;
    changed = true;
    return {
      ...a,
      config: {
        ...a.config,
        steps,
        name: nameFollows ? fileName(clip) : a.config.name,
        actionId: idFollows ? fileActionId(actions, a.uid, clip) : a.config.actionId,
      },
    };
  }
}
export const uid = (prefix: string, ids: string[]) => {
  let i = 1;
  while (ids.includes(prefix + i)) i++;
  return prefix + i;
};
export function addAction(w: Workspace, kind: 'single' | 'pair' = 'single'): Action {
  const a = wrap(
    createProject(),
    uid(
      'a',
      w.actions.map(a => a.uid)
    )
  );
  // Named after its HKX file (followFiles), never a made-up number.
  a.config.actionId = fileActionId(w.actions, a.uid, a.config.steps[0].clip);
  a.config.name = kind === 'pair' ? tr('새 페어') : tr('새 일반 동작');
  a.position = {x: 100 + (w.actions.length % 3) * 500, y: 80 + Math.floor(w.actions.length / 3) * 220};
  if (kind === 'pair') {
    a.pair = defaultPair();
    a.config.graph = ['RootBehaviorGraph'];
    a.config.cost.enabled = false;
  }
  return a;
}
/** A copy of an action: everything it holds, under a new uid and Action ID, named `name`, beside the original (10-28
 *  review E-18: a copy made field by field missed what came later — vanilla cancel windows, detection windows,
 *  camera restore, blends turned off). What points at the action from outside (starts, cards, links, QTEs) stays the
 *  original's. */
export function duplicateAction(w: Workspace, a: Action, name: string): Action {
  const fresh = addAction(w, a.pair ? 'pair' : 'single');
  const copy = structuredClone(a);
  copy.uid = fresh.uid;
  copy.config.actionId = fileActionId(w.actions, copy.uid, copy.config.steps[0].clip);
  copy.config.name = name;
  copy.position = {x: a.position.x + 45, y: a.position.y + 55};
  return copy;
}
export function addLink(w: Workspace, from: string, to: string): Link {
  const a = w.actions.find(a => a.uid === from),
    b = w.actions.find(a => a.uid === to);
  if (!a || !b || from === to) throw new Error(tr('서로 다른 동작의 핀을 연결하세요.'));
  return {
    id: uid(
      'link',
      w.links.map(l => l.id)
    ),
    from,
    to,
    partnerTo: '',
    mode: 'event',
    input: '',
    event: '',
    window: false,
    open: mark(0.3),
    close: mark(1.5),
    buffered: true,
    position: {x: (a.position.x + b.position.x) / 2 + 220, y: (a.position.y + b.position.y) / 2 + 90},
  };
}
/** An edit's step: `a` takes the place of the action with its uid. In an edit's copy (editableCopy) whose
 *  actions the edit has not touched yet, the other actions stay the document's own records, neither copied nor
 *  compared again, when nothing can change them in place: without shared rules (synchronizeRules copies
 *  settings between members into the edited document). */
/** A vanilla cancel's id in the XML: the one the author gave, else the editor's own (cancel1, …). */
export const cancelXmlId = (c: Action['cancels'][number]) => c.xmlId || c.id;
export function putAction(w: Workspace, a: Action): Workspace {
  const source = draftSource(w),
    untouched = !!Object.getOwnPropertyDescriptor(w, 'actions')?.get;
  const actions = source && untouched && !source.sharedRules?.length ? source.actions : w.actions;
  w.actions = actions.map(x => (x.uid === a.uid ? a : x));
  return w;
}
export function removeAction(w: Workspace, id: string): Workspace {
  if (w.actions.some(a => a.pair?.carry?.putdownAction === id))
    throw new Error(tr('운반 카드의 내려놓기 동작을 먼저 변경하세요.'));
  if (w.parameters.some(p => p.action === id)) throw new Error(tr('이 동작의 제작 매개변수를 먼저 삭제하세요.'));
  if (w.links.some(l => l.from === id || l.to === id || l.partnerTo === id))
    throw new Error(tr('이 동작을 참조하는 연결을 먼저 삭제하세요.'));
  // Starts, rows, Trues and Falses that played it lead nowhere now (the user picks another destination); so do QTE
  // results.
  const gone = (r: import('./cards.ts').Ref) => (r && 'action' in r && r.action === id ? null : r);
  const cards = structuredClone(w.cards).map(c => {
    c.rows = c.rows.map(r => ({...r, to: gone(r.to)}));
    if (c.true !== undefined) c.true = gone(c.true);
    c.false = gone(c.false);
    return c;
  });
  const qtes = w.qtes?.map(q => ({
    ...q,
    results: Object.fromEntries(
      Object.entries(q.results).map(([k, r]) => [
        k,
        {...r, to: r.to === id ? '' : r.to, partnerTo: r.partnerTo === id ? '' : r.partnerTo},
      ])
    ) as typeof q.results,
  }));
  return {
    ...w,
    actions: w.actions.filter(a => a.uid !== id),
    starts: w.starts.map(s => ({...s, to: gone(s.to)})),
    cards,
    order: w.order.filter(u => u !== id),
    ...(qtes ? {qtes} : {}),
  };
}
export function arrange(w: Workspace): Workspace {
  const next = clone(w),
    levels = new Map<string, number>(),
    queue = w.actions.filter(a => !w.links.some(l => l.to === a.uid || l.partnerTo === a.uid)).map(a => a.uid);
  if (!queue.length && w.actions.length) queue.push(w.actions[0].uid);
  queue.forEach(id => levels.set(id, 0));
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const l of w.links.filter(l => l.from === from))
      for (const id of [l.to, l.partnerTo].filter(Boolean))
        if (!levels.has(id)) {
          levels.set(id, levels.get(from)! + 1);
          queue.push(id);
        }
  }
  const rows = new Map<number, number>(),
    links = new Map<number, number>();
  for (const a of next.actions) {
    const level = levels.get(a.uid) ?? 0,
      row = rows.get(level) ?? 0;
    a.position = {x: 80 + level * 680, y: 100 + row * 210};
    rows.set(level, row + 1);
  }
  for (const l of next.links) {
    const level = levels.get(l.from) ?? 0,
      row = links.get(level) ?? 0;
    l.position = {x: 420 + level * 680, y: 100 + row * 210};
    links.set(level, row + 1);
  }
  return next;
}
const idOk = (s: string) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s);
const eventOk = (s: string) => !!s.trim() && s.length <= 256 && !/[|@\x00-\x1f]/.test(s);
const number = (v: number, min = 0, max = 600) => Number.isFinite(v) && v >= min && v <= max;
function exact(value: any, sample: any, path: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(sample).length ||
    Object.keys(value).some(k => !Object.hasOwn(sample, k))
  )
    throw new Error(path + tr(': 알 수 없거나 누락된 필드'));
  for (const [k, v] of Object.entries(sample)) {
    const x = value[k];
    if (v === null || Array.isArray(v) || typeof v === 'object') continue;
    if (
      typeof x !== typeof v ||
      (typeof x === 'number' && !Number.isFinite(x)) ||
      (typeof x === 'string' && (x.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x)))
    )
      throw new Error(path + '.' + k + tr(': 잘못된 형식'));
  }
}
// A function's string values: known keys, bounded text without control characters.
function checkValues(values: any, keys: readonly string[], message: string) {
  if (
    !values ||
    typeof values !== 'object' ||
    Array.isArray(values) ||
    Object.entries(values).some(
      ([k, v]) =>
        !keys.includes(k) || typeof v !== 'string' || v.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
    )
  )
    throw new Error(message);
}
/** Workspace schema: the graph document the editor saves (graph/document.ts). Only this one opens: older projects
 *  are not supported (10-26). */
export const WORKSPACE_SCHEMA = 9;

// parseWorkspace runs fixed phases on the object JSON.parse returned (owned by this parse):
//   1. check*: validation only; throws on the first problem and never changes the document.
//   2. normalizeWorkspace: canonical forms (drafts, action configs, NOT conditions).

/** Phase 1: optional workspace collections. */
function checkCollections(w: any) {
  const {eventRegistry, sharedRules, view} = w;
  if (view !== undefined && !views.includes(view)) throw Error(tr('기본 인칭 형식 오류'));
  if (eventRegistry !== undefined) {
    if (!Array.isArray(eventRegistry) || eventRegistry.length > 4096) throw Error(tr('이벤트 등록 형식 오류'));
    const ids = new Set();
    for (const row of eventRegistry) {
      const {values, ...r} = row ?? {};
      exact(r, {id: '', name: '', functions: []}, tr('이벤트 등록'));
      if (
        values !== undefined &&
        (!Array.isArray(values) || !values.length || values.length > 64 || values.some(v => typeof v !== 'string'))
      )
        throw Error(tr('이벤트 등록 값 형식 오류'));
      if (!r.id || ids.has(r.id) || !Array.isArray(r.functions) || r.functions.length > 64)
        throw Error(tr('이벤트 등록 ID 또는 기능 수 오류'));
      ids.add(r.id);
      const fids = new Set();
      for (const f of r.functions) {
        exact(f, {id: '', values: {}}, tr('등록 기능'));
        if (!f.id || fids.has(f.id)) throw Error(tr('등록 기능 ID 오류'));
        fids.add(f.id);
        checkValues(f.values, functionKeys, tr('알 수 없는 등록 기능 속성'));
      }
    }
  }
  if (
    sharedRules !== undefined &&
    (!Array.isArray(sharedRules) ||
      sharedRules.length > 2000 ||
      sharedRules.some(
        (g: any) =>
          !g ||
          g.kind !== 'link' ||
          !Array.isArray(g.members) ||
          g.members.length > 2000 ||
          g.members.some((m: unknown) => typeof m !== 'string')
      ))
  )
    throw Error(tr('공유 규칙 형식 오류'));
}

/** Phase 1: the workspace shell (everything but actions and links). */
function checkShell(w: any) {
  const {qtes, eventRegistry, sharedRules, view, ...baseWorkspace} = w;
  exact(baseWorkspace, emptyWorkspace(), tr('프로젝트'));
  if (!Array.isArray(w.assets) || w.assets.length > 500) throw new Error(tr('에셋 개수 제한'));
  for (const a of w.assets) {
    exact(a, {clip: '', localPath: '', preview: {skeletons: [], skins: []}}, tr('에셋'));
    exact(a.preview, {skeletons: [], skins: []}, tr('프리뷰 에셋'));
    for (const [kind, paths] of Object.entries(a.preview)) {
      if (
        !Array.isArray(paths) ||
        paths.length > 2 ||
        paths.some(path => typeof path !== 'string' || path.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(path))
      )
        throw new Error(tr('프리뷰 {kind} 경로 형식 오류', {kind}));
    }
  }
  if (!w.layout || typeof w.layout !== 'object' || Array.isArray(w.layout)) throw new Error(tr('레이아웃 형식 오류'));
  for (const [graph, nodes] of Object.entries(w.layout) as [string, any][]) {
    if (!idOk(graph) || !nodes || typeof nodes !== 'object' || Array.isArray(nodes) || Object.keys(nodes).length > 500)
      throw new Error(tr('레이아웃 형식 오류'));
    for (const [node, p] of Object.entries(nodes) as [string, any][]) {
      if (!idOk(node)) throw new Error(tr('레이아웃 형식 오류'));
      exact(p, p.text === undefined ? {x: 0, y: 0} : {x: 0, y: 0, text: ''}, tr('레이아웃 좌표'));
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        (p.text !== undefined && (typeof p.text !== 'string' || p.text.length > 4096))
      )
        throw new Error(tr('레이아웃 좌표 또는 코멘트 형식 오류'));
    }
  }
  exact(w.globals, {cameraReset: null}, tr('공통 설정'));
  if (
    w.globals.cameraReset !== null &&
    (typeof w.globals.cameraReset !== 'string' || w.globals.cameraReset.length > 256)
  )
    throw new Error(tr('카메라 복구 이벤트 형식 오류'));
  if (!Array.isArray(w.sharedInputs) || w.sharedInputs.length > 200) throw new Error(tr('공통 입력 개수 제한'));
  for (const i of w.sharedInputs) {
    // A game control (runtime 0.12.292) is the one optional field.
    const {control, ...rest} = i ?? {};
    exact(rest, {id: '', label: '', key: '', gamepad: 0}, tr('공통 입력'));
    if (control !== undefined && !isGameControl(control))
      throw new Error(tr('공통 입력') + tr(': 알 수 없거나 누락된 필드'));
  }
  authoringShape(w);
  if (!Array.isArray(w.actions) || !Array.isArray(w.links) || w.actions.length > 100 || w.links.length > 500)
    throw new Error(tr('동작/연결 개수 제한'));
}

/** Phase 1: one action. Stored variants are checked by parsing them as their own action.
 *  Returns the parsed config, which normalizeWorkspace stores (parsed once). */
function checkAction(a: any): Project {
  const {clipWindows, nodeAuthored, view, firstPerson, cameraEnabled, camera: cameraSettings, ...baseAction} = a;
  if (cameraEnabled !== undefined && typeof cameraEnabled !== 'boolean') throw Error(tr('카메라 복구 형식 오류'));
  if (cameraSettings !== undefined) {
    const {own, ...camera} = cameraSettings ?? {};
    exact(camera, defaultCamera(), tr('카메라'));
    if (own !== undefined && own !== true) throw Error(tr('카메라: 이 동작만 형식 오류'));
  }
  if (view !== undefined && !views.includes(view)) throw Error(tr('동작 인칭 형식 오류'));
  if (firstPerson !== undefined && !firstPersonStarts.includes(firstPerson)) throw Error(tr('1인칭 시작 형식 오류'));
  if (nodeAuthored !== undefined && typeof nodeAuthored !== 'boolean') throw Error(tr('카드 작성 설정 오류'));
  exact(baseAction, wrap(createProject()), tr('동작'));
  if (clipWindows !== undefined) {
    if (
      !clipWindows ||
      typeof clipWindows !== 'object' ||
      Array.isArray(clipWindows) ||
      Object.keys(clipWindows).length > 500
    )
      throw Error(tr('HKX 감지 구간 형식 오류'));
    for (const [step, value] of Object.entries(clipWindows) as [string, any][]) {
      if (!a.config.steps.some((s: any) => s.id === step)) throw Error(tr('감지 구간의 HKX를 찾지 못했습니다.'));
      exact(value, {open: mark(), close: mark(), buffered: true}, tr('HKX 감지 구간'));
      exact(value.open, mark(), tr('감지 시작'));
      exact(value.close, mark(), tr('감지 종료'));
      if (typeof value.buffered !== 'boolean') throw Error(tr('선입력 형식 오류'));
      if (!windowMarksOk(value.open, value.close)) throw Error(tr('HKX 감지 구간 값을 확인하세요.'));
    }
  }
  for (const e of a.config.effects ?? []) {
    exact(e, {id: '', values: {}}, tr('연출'));
    checkValues(e.values, effectKeys, tr('알 수 없는 연출 속성'));
  }
  if (a.cancels.length > 100) throw Error(tr('캔슬 창은 100개까지 지원합니다.'));
  for (const c of a.cancels) {
    const {xmlId, always, ...base} = c;
    exact(base, {id: '', to: '', open: mark(), close: mark(), buffered: true, blend: null}, tr('캔슬 창'));
    if (xmlId !== undefined && (typeof xmlId !== 'string' || xmlId.length > 64))
      throw Error(tr('캔슬 창 ID 형식 오류'));
    if (always !== undefined && always !== true) throw Error(tr('캔슬 창 항상 열림 형식 오류'));
    exact(c.open, mark(), tr('캔슬 시작'));
    exact(c.close, mark(), tr('캔슬 끝'));
  }
  if (
    !a.variants ||
    typeof a.variants !== 'object' ||
    Array.isArray(a.variants) ||
    Object.keys(a.variants).some(k => !['single', 'pair'].includes(k))
  )
    throw new Error(tr('유형별 보관 설정 오류'));
  for (const [kind, v] of Object.entries(a.variants) as [string, any][]) {
    const {clipWindows: storedWindows, ...baseVariant} = v;
    exact(baseVariant, {config: {}, pair: null}, tr('보관 설정'));
    const saved = parseWorkspace(
      JSON.stringify({
        ...emptyWorkspace(),
        actions: [{...a, variants: {}, config: v.config, pair: v.pair, clipWindows: storedWindows}],
      })
    ).actions[0];
    if ((saved.pair ? 'pair' : saved.config.kind) !== kind) throw new Error(tr('보관 설정 유형 불일치'));
  }
  const config = parseProject(JSON.stringify(a.config));
  exact(a.position, {x: 0, y: 0}, tr('좌표'));
  if (a.pair !== null) {
    const {carry, ...pairBase} = a.pair;
    exact(pairBase, defaultPair(), tr('페어'));
    if (carry !== undefined) {
      exact(carry, defaultCarry(), tr('운반'));
      if (carry.hold !== null) {
        exact(carry.hold, defaultCarryHold(), tr('운반 자세'));
        if (!Array.isArray(carry.hold.bones) || carry.hold.bones.length > 256)
          throw new Error(tr('운반 자세 본 개수 제한'));
        for (const b of carry.hold.bones) exact(b, {name: '', weight: 0}, tr('운반 자세 본'));
      }
      if (carry.fix !== null) {
        exact(carry.fix, defaultCarryFix(), tr('운반 고정'));
        exact(carry.fix.at, mark(), tr('운반 고정 시점'));
      }
    }
    exact(a.pair.timeline, defaultPairTimeline(), tr('페어 타임라인'));
    for (const key of pairTrackKeys) {
      const t = a.pair.timeline[key];
      exact(t, defaultPairTimeline()[key], tr('페어 트랙'));
      exact(t.from, mark(), tr('페어 시작'));
      exact(t.until, mark(), tr('페어 종료'));
    }
    if (!Array.isArray(a.pair.effects) || a.pair.effects.length > 500) throw new Error(tr('연출 개수 제한'));
    for (const e of a.pair.effects) {
      exact(e, {id: '', values: {}}, tr('연출'));
      checkValues(e.values, effectKeys, tr('알 수 없는 연출 속성'));
    }
  }
  return config;
}

/** Phase 1: one link. */
function checkLink(l: any) {
  const sample: Link = {
    id: '',
    from: '',
    to: '',
    partnerTo: '',
    mode: 'event',
    input: '',
    event: '',
    window: false,
    open: mark(),
    close: mark(),
    buffered: true,
    position: {x: 0, y: 0},
  };
  const {blend, ownWindow, card, ...baseLink} = l;
  exact(baseLink, sample, tr('연결'));
  if (card !== undefined && (typeof card !== 'string' || !card)) throw Error(tr('전환 조건 카드 형식 오류'));
  if (ownWindow !== undefined && ownWindow !== true) throw Error(tr('전환 감지 구간 설정 오류'));
  if (blend !== undefined && (typeof blend !== 'number' || !Number.isFinite(blend) || blend < 0 || blend > 5))
    throw Error(tr('연결 블렌드 범위 오류'));
  exact(l.position, sample.position, tr('좌표'));
  for (const t of [l.open, l.close]) exact(t, mark(), tr('시각'));
}

/** Phase 2. Canonical forms; checks that need them (QTE) run on the result. */
function normalizeWorkspace(w: any, configs: Project[]): Workspace {
  w.actions.forEach((a: any, i: number) => (a.config = configs[i]));
  // A target a project kept, hidden, from the condition's previous kind (before the field went with the kind).
  for (const c of w.cards) for (const t of c.tests) if (subjectlessKinds.includes(t.kind)) t.subject = 'self';
  const qerrors = qteErrors(w);
  if (qerrors.length) throw Error(qerrors.join('\n'));
  return w;
}

export function parseWorkspace(text: string): Workspace {
  if (text.length > 2_000_000) throw new Error(tr('프로젝트는 2 MB 이하여야 합니다.'));
  const w = JSON.parse(text);
  // The graph document (graph/document.ts) the editor saves, lowered to the workspace it edits.
  if (w && Array.isArray(w.nodes) && w.schema === WORKSPACE_SCHEMA)
    return parseWorkspace(JSON.stringify(lowerGraph(w)));
  if (!w || typeof w !== 'object' || Array.isArray(w) || w.schema !== WORKSPACE_SCHEMA)
    throw new Error(tr('지원하지 않는 프로젝트 형식입니다. 이 에디터로 저장한 프로젝트만 엽니다.'));
  checkCollections(w);
  checkShell(w);
  const configs = w.actions.map(checkAction);
  for (const l of w.links) checkLink(l);
  checkCards(w);
  return normalizeWorkspace(w, configs);
}
export function validateWorkspace(w: Workspace): Issue[] {
  w = sourceLinks(w);
  const out: Issue[] = [],
    err = (node: string, message: string) => out.push({level: 'error', node, message});
  if (w.id === DEFAULT_SET_ID)
    out.push({
      level: 'warning',
      node: 'project',
      message: tr(
        '내부 ID가 기본값(MyAnimationSet)입니다. 다른 모드와 겹치지 않게 프로젝트 이름을 영문으로 정하거나 내부 ID를 바꾸세요.'
      ),
    });
  out.push(...cardIssues(w));
  for (const i of runtimeNameUses(w)) out.push({level: 'warning', ...i});
  out.push(...registryIssues(w));
  // The numbers an HKX node runs registered functions with (<EventValues>, runtime 0.12.281).
  for (const a of w.actions)
    for (const v of Object.values(a.config.eventValues ?? {})) for (const m of valueErrors(v)) err(a.uid, m);
  out.push(...viewIssues(w));
  for (const i of qteChannelClashes(w)) out.push({level: 'warning', ...i});
  try {
    parseWorkspace(JSON.stringify(w));
  } catch (e) {
    return [{level: 'error', node: 'project', message: errorText(e)}];
  }
  if (w.globals.cameraReset && !eventOk(w.globals.cameraReset))
    err('globals', tr('카메라 복구 이벤트 이름을 확인하세요.'));
  const sharedIds = new Set<string>();
  for (const i of w.sharedInputs) {
    if (
      !idOk(i.id) ||
      sharedIds.has(i.id.toLowerCase()) ||
      !i.label.trim() ||
      (i.control !== undefined
        ? !isGameControl(i.control) || !!i.key || !!i.gamepad
        : (i.key && (!keyCode(i.key) || keyCode(i.key) > 265)) ||
          (!i.key && !i.gamepad) ||
          !number(i.gamepad, 0, 65535) ||
          !Number.isInteger(i.gamepad))
    )
      err('inputs', tr('공통 입력의 ID·키·패드를 확인하세요.'));
    sharedIds.add(i.id.toLowerCase());
    for (const a of w.actions) {
      const local = a.config.inputs.find(x => x.id === i.id);
      if (local && JSON.stringify(local) !== JSON.stringify(i))
        err('inputs', a.config.name + tr(': 공통 입력은 입력 관리에서 변경하세요.'));
    }
  }
  out.push(...validateParameters(w));
  if (!idOk(w.id) || !w.name.trim()) err('project', tr('묶음 이름과 영문 ID가 필요합니다.'));
  if (!w.actions.length) err('project', tr('동작을 하나 이상 추가하세요.'));

  const ids = new Set<string>(),
    uids = new Set<string>();
  for (const a of w.actions) {
    if (
      !idOk(a.uid) ||
      a.uid.length > 48 ||
      uids.has(a.uid) ||
      (a.config.actionId && ids.has(a.config.actionId.toLowerCase()))
    )
      err(a.uid, tr('동작 ID가 중복되었거나 잘못되었습니다.'));
    uids.add(a.uid);
    ids.add(a.config.actionId.toLowerCase());
    for (const e of validate(a.config))
      // Named as the user sees the action (its display name), not by its XML id.
      out.push({...e, node: a.uid, message: (a.config.name.trim() || a.config.actionId) + ': ' + e.message});
    // An ordinary action's clip-time functions (runtime 0.12.274) change the actor playing it.
    if (a.config.effects) {
      if (a.pair) err(a.uid, tr('페어의 시각 기능은 페어 연출에 둡니다.'));
      const seen = new Set<string>();
      for (const e of a.config.effects) {
        if (!idOk(e.id) || seen.has(e.id)) err(a.uid, tr('연출 ID 중복 또는 형식 오류'));
        seen.add(e.id);
        if (!ordinaryEffectOps.includes(e.values.op))
          err(a.uid, e.id + ': ' + tr('일반 동작에서 쓸 수 없는 시각 기능입니다: {op}', {op: e.values.op}));
        if (e.values.target || e.values.from)
          err(a.uid, e.id + ': ' + tr('일반 동작의 시각 기능은 그 동작을 재생하는 액터에게 적용됩니다(대상 없음).'));
        for (const m of functionErrors(e.values, true)) err(a.uid, e.id + ': ' + m);
      }
    }
    if (a.pair?.effects.some(e => e.values.op === 'fireArrow'))
      err(a.uid, tr('활 발사는 플레이어가 재생하는 일반 동작에서만 씁니다.'));
    for (const message of carryErrors(w, a)) err(a.uid, message);
    if (strayCarryRelease(w, a))
      err(
        a.uid,
        tr(
          '대상 놓기는 운반의 내려놓기 동작에만 씁니다. 운반 카드에서 이 동작을 내려놓기 동작으로 고르거나 대상 놓기를 지우세요.'
        )
      );
    // Vanilla cancel ids name the runtime's window events (case-insensitive).
    const cancelIds = new Set<string>();
    for (const c of a.cancels ?? []) {
      const xmlId = cancelXmlId(c);
      if (
        a.pair ||
        !idOk(xmlId) ||
        cancelIds.has(xmlId.toLowerCase()) ||
        !c.to
          .split(',')
          .every(
            s =>
              /^vanilla:(Attack|PowerAttack|Block|Bash|Sprint|Jump|Sneak)$/.test(s.trim()) ||
              (s.trim().startsWith('event:') && eventOk(s.trim().slice(6)))
          ) ||
        (c.blend !== null && !number(c.blend, 0, 5))
      )
        err(a.uid, tr('캔슬 창의 대상·ID·블렌드를 확인하세요.'));
      cancelIds.add(xmlId.toLowerCase());
      if (c.always) continue;
      for (const m of [c.open, c.close])
        if (
          !['seconds', 'end', 'event'].includes(m.basis) ||
          !number(m.seconds) ||
          !['seconds', 'end'].includes(m.fallbackBasis) ||
          (m.basis === 'event' && !eventOk(m.event))
        )
          err(a.uid, tr('캔슬 창 시각이 올바르지 않습니다.'));
      if (c.open.basis === 'seconds' && c.close.basis === 'seconds' && c.open.seconds >= c.close.seconds)
        err(a.uid, tr('캔슬 닫힘은 열림보다 뒤여야 합니다.'));
    }
    // Camera restore: any action (10-16).
    if (
      a.cameraEnabled &&
      a.camera &&
      (!['end', 'event'].includes(a.camera.restore) ||
        !number(a.camera.timeout, 0.1, 60) ||
        (a.camera.reset && !eventOk(a.camera.reset)))
    )
      err(a.uid, tr('카메라 복구 설정을 확인하세요.'));
    const p = a.pair;
    if (!p) continue;
    if (
      a.config.kind !== 'single' ||
      a.config.graph.join() !== 'RootBehaviorGraph' ||
      !!a.config.rotationLocked ||
      Object.values(a.config.slots).some(s => s.enabled) ||
      a.config.cost.enabled
    )
      err(a.uid, tr('페어는 RootBehaviorGraph의 단일 HKX와 역할별 연출을 사용합니다.'));
    if (
      !isPairedRig(p.targetRig ?? 'character') ||
      !number(p.range, 0.001, 10000) ||
      !number(p.angle, 0.001, 360) ||
      (p.lossEnabled && !number(p.lossBlend, 0.01, 5))
    )
      err(a.uid, tr('페어 거리·각도·종료 블렌드 범위를 확인하세요.'));
    for (const key of pairTrackKeys) {
      const t = p.timeline[key];
      if (!(pairRoles as readonly string[]).includes(t.role)) err(a.uid, key + tr(': 페어 트랙 적용 값 오류'));
      for (const m of [t.from, t.until])
        if (m.basis !== 'seconds' || m.fallback || !number(m.seconds))
          err(
            a.uid,
            key + tr(': 페어 트랙은 클립 시각(초)을 사용합니다. 이벤트로 켜고 끄려면 이벤트 등록의 기능을 쓰세요.')
          );
      if (
        t.enabled &&
        key !== 'cost' &&
        t.from.basis === 'seconds' &&
        t.until.basis === 'seconds' &&
        t.from.seconds >= t.until.seconds
      )
        err(a.uid, key + tr(': 종료는 시작보다 뒤여야 합니다.'));
      if (!number(t.stamina, 0, 100000) || !number(t.magicka, 0, 100000)) err(a.uid, key + tr(': 자원 소모 범위 오류'));
    }
    const effects = new Set<string>();
    for (const e of [...p.effects, ...pairTimelineEffects(p)]) {
      if (!idOk(e.id) || effects.has(e.id)) err(a.uid, tr('연출 ID 중복 또는 형식 오류'));
      effects.add(e.id);
      // A pair effect runs at a clip time; an event moment is a registry function (format 3).
      for (const m of functionErrors(e.values, true)) err(a.uid, e.id + ': ' + m);
    }
  }
  const signatures = new Set<string>(),
    linkIds = new Set<string>();
  for (const l of w.links) {
    const a = w.actions.find(a => a.uid === l.from),
      b = w.actions.find(a => a.uid === l.to),
      partner = w.actions.find(a => a.uid === l.partnerTo);
    if (!idOk(l.id) || uids.has(l.id) || linkIds.has(l.id)) err(l.id, tr('연결 ID 중복 또는 형식 오류'));
    linkIds.add(l.id);
    if (!a) {
      err(l.id, tr('유효한 출발·도착 동작을 지정하세요.'));
      continue;
    }
    if (!l.card && (!b || a === b)) {
      err(l.id, tr('전환의 목적지(HKX 또는 조건 카드)를 고르세요.'));
      continue;
    }
    if (
      b &&
      l.blend !== undefined &&
      (!number(l.blend, 0, 5) || a.pair || b.pair || a.config.steps.length !== 1 || b.config.steps.length !== 1)
    )
      err(l.id, tr('경로별 블렌드는 단일 일반 HKX 사이에서만 지원합니다.'));
    if (b && l.partnerTo && (!a.pair || b.pair || !partner || partner.pair))
      err(l.id, tr('양쪽 일반 전환은 페어 출발과 일반/콤보 목적지가 필요합니다.'));
    if (!['input', 'event'].includes(l.mode)) err(l.id, tr('연결 시작 방식 오류'));
    if (l.mode === 'event') {
      if (!eventOk(l.event)) err(l.id, tr('연결 이벤트 이름을 입력하세요.'));
      const s = a.uid + ':event:' + l.event;
      // Two new transitions not named yet are not the same one: each is told to take a name above.
      if (l.event && signatures.has(s)) err(l.id, tr('같은 출발 이벤트의 연결이 중복됩니다.'));
      signatures.add(s);
    } else {
      const input = a.config.inputs.find(i => i.id === l.input);
      // No window: the whole clip (format 4).
      if (!input) err(l.id, tr('키 전환은 출발 동작의 키가 필요합니다.'));
      if (input) {
        for (const s of [
          input.key ? 'key:' + keyCode(input.key) : '',
          input.gamepad ? 'pad:' + input.gamepad : '',
          input.control ? 'control:' + input.control : '',
        ].filter(Boolean)) {
          const key = a.uid + ':' + s;
          if (signatures.has(key)) err(l.id, tr('같은 출발 동작에 같은 입력의 전환이 둘 있습니다.'));
          signatures.add(key);
        }
      }
    }
    if (l.window) {
      for (const m of [l.open, l.close])
        if (
          !['seconds', 'end', 'event'].includes(m.basis) ||
          !number(m.seconds) ||
          (m.basis === 'event' && (!eventOk(m.event) || (m.fallback && !['seconds', 'end'].includes(m.fallbackBasis))))
        )
          err(l.id, tr('동작 연결 창의 시간 또는 이벤트를 확인하세요.'));
      if (l.open.basis === 'end' || (l.open.basis === 'event' && l.open.fallback && l.open.fallbackBasis === 'end'))
        err(l.id, tr('감지 시작은 시작 기준 시간 또는 이벤트를 사용하세요.'));
      if (l.open.basis === 'seconds' && l.close.basis === 'seconds' && l.open.seconds >= l.close.seconds)
        err(l.id, tr('닫힘 시각은 열림보다 뒤여야 합니다.'));
    }
  }
  return out;
}
function cameraNode(w: Workspace, camera: CameraRestore) {
  return node(
    'Camera',
    omitDefaults(
      {reset: cameraReset(w, camera) || undefined, restore: camera.restore, timeout: camera.timeout},
      {restore: 'end', timeout: 10}
    )
  );
}
/** The XML (format 6, runtime 0.12.291): the event registry, then the starts, HKX cards and named condition cards in
 *  the document's order (format6Xml.ts). */
export function compileWorkspace(w: Workspace): string {
  w = sourceLinks(w);
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(e => e.node + ': ' + e.message).join('\n'));
  const x = writerOf(w);
  const root = node('AnimationSet', {
    version: XML_FORMAT_VERSION,
    id: w.id,
    view: projectView(w) !== 'third' ? projectView(w) : undefined,
  });
  // The global event registry comes first: every name the file registers, with its functions, and the QTEs
  // events start (runtime 0.12.248) under their event (a name registered here or one only they use).
  let registry = registryXml(w);
  for (const {event, xml} of eventQteXml(w, x)) {
    registry ??= node('EventRegistry', {}, []);
    let e = registry.children.find(c => c.name === 'Event' && eventKey(c.attrs.name ?? '') === eventKey(event));
    if (!e) registry.children.push((e = node('Event', {name: event}, [])));
    e.children.push(xml);
  }
  if (registry) root.children.push(registry);
  for (const e of rootOrder(w, x)) {
    if (e.kind === 'card') root.children.push(sharedXml(x, e.uid));
    else if (e.kind === 'start') {
      const s = w.starts.find(s => s.uid === e.uid)!;
      // A start that goes nowhere is not written (a warning says so).
      if (s.to) root.children.push(startXml(x, s));
    } else
      root.children.push(
        actionElement(
          w,
          x,
          w.actions.find(a => a.uid === e.uid)!
        )
      );
  }
  return documentXml(root);
}
/** One HKX card: <Action>/<Pair> with its clip and features (format 6, 1.5). */
function actionElement(w: Workspace, x: ReturnType<typeof writerOf>, a: Action): Xml {
  const config = clone(a.config),
    pair = a.pair,
    input = (id: string) => keyAttrs(config.inputs.find(i => i.id === id));
  const out = actionXml(config, a);
  // The view when it is not the file's; pairs and putdowns play in third person whatever it says.
  if (!fixedThird(w, a) && actionView(w, a) !== projectView(w)) out.attrs.view = actionView(w, a);
  if (actionView(w, a) === 'third' && a.firstPerson === 'switch') out.attrs.firstPerson = 'switch';
  out.children.push(...qteXml(w, a, x));
  // A vanilla transition: its id when it is not the one the runtime gives it (cancel1, cancel2, ... by position);
  // no window when it is open for the whole clip.
  (a.cancels ?? []).forEach((c, index) =>
    out.children.push(
      node('Vanilla', {
        id: cancelXmlId(c) === 'cancel' + (index + 1) ? undefined : cancelXmlId(c),
        to: c.to
          .split(',')
          .map(t => t.trim().replace(/^vanilla:/, ''))
          .join(','),
        ...(c.always ? {} : windowAttrs(c.open, c.close, c.buffered)),
        blend: c.blend ?? undefined,
      })
    )
  );
  if (pair) {
    out.name = 'Pair';
    const target = omitDefaults(
      {range: pair.range, angle: pair.angle, rig: pair.targetRig ?? 'character'},
      {range: 150, angle: 60, rig: 'character'}
    );
    if (Object.keys(target).length) out.children.push(node('FindPartner', target));
    if (pair.lossEnabled) out.attrs.lostBlend = String(pair.lossBlend);
    if (!pair.reorientSupport) out.attrs.reorient = 'false';
    const carry = pair.carry;
    if (carry)
      out.children.push(
        node(
          'Carry',
          omitDefaults(
            {
              bone: carry.bone,
              targetRoot: carry.targetRoot,
              putdown: w.actions.find(x => x.uid === carry.putdownAction)!.config.actionId,
              ...input(carry.input),
              target: carry.target,
              part: carry.target === 'physics' && carry.part ? carry.part : undefined,
              weapon: carry.weapon,
            },
            {target: 'pose', weapon: 'sheathed'}
          ),
          [
            ...(carry.fix ? [node('Fix', {at: carry.fix.at.seconds})] : []),
            ...(carry.hold
              ? [
                  node(
                    'Hold',
                    omitDefaults(
                      {blendIn: carry.hold.blendIn, blendOut: carry.hold.blendOut},
                      {blendIn: 0.2, blendOut: 0.2}
                    ),
                    carry.hold.bones.map(b => node('Bone', omitDefaults({name: b.name, weight: b.weight}, {weight: 1})))
                  ),
                ]
              : []),
          ]
        )
      );
    if (pair.interruptOnThirdPartyHit) out.attrs.interruptOnHit = 'true';
    if (a.cameraEnabled && a.camera) out.children.push(cameraNode(w, a.camera));
    for (const e of [...pair.effects, ...pairTimelineEffects(pair)])
      out.children.push(node('Do', doAttrs(e.values, true)));
  } else {
    // An ordinary action's camera restore (runtime 0.12.260) and its clip-time functions (0.12.274).
    if (a.cameraEnabled && a.camera) out.children.push(cameraNode(w, a.camera));
    for (const e of a.config.effects ?? []) out.children.push(node('Do', doAttrs(e.values, true)));
  }
  // The numbers its clip runs registered functions with (runtime 0.12.281).
  const values = eventValuesXml(w, a);
  if (values) out.children.push(values);
  // Transitions: no from, until or buffer is the whole clip.
  for (const l of w.links.filter(l => l.from === a.uid)) {
    const partner = w.actions.find(a => a.uid === l.partnerTo);
    out.children.push(
      linkDestination(
        x,
        node('Transition', {
          partnerTo: partner?.config.actionId,
          ...(l.mode === 'event' ? {event: l.event} : input(l.input)),
          ...(l.window ? windowAttrs(l.open, l.close, l.buffered) : {}),
          blend: l.blend,
        }),
        l.to,
        l.card
      )
    );
  }
  return out;
}
