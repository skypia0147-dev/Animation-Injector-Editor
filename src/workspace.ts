import {qteErrors, qteXml, eventQteXml} from './qte.ts';
import {isPairedRig, type PairedRig} from './pairedRigs.ts';
import {repairEmptyPlaybacks} from './graph/deletePlayback.ts';
import {defaultCarry, defaultCarryFix, defaultCarryHold, carryErrors, strayCarryRelease} from './carry.ts';
import {XML_FORMAT_VERSION} from './xmlFormat.ts';
import {lowerDisconnected} from './graph/disconnect.ts';
import {sourceLinks} from './graph/playback.ts';
import {checkFlows, flowXml, lowerFlowDrafts, foldNotConditions, unpairableRoutes} from './graph/conditions.ts';
import {checkFans} from './graph/conditionFans.ts';
import {lowerGraph} from './graph/document.ts';
import type {ActionKind, ActionVariant} from './actionTypes.ts';
import {lowerBlends} from './graph/blends.ts';
import type {BlendNode} from './graph/blends.ts';
import type {DraftNode} from './graph/drafts.ts';
import {defaultPairTimeline, pairTrackKeys, pairTimelineEffects} from './pairTimeline.ts';
import type {PairTimeline} from './pairTimeline.ts';
import {inferredCamera, cameraReset} from './sharedSettings.ts';
import type {SharedSettings} from './sharedSettings.ts';
import {defaultPackaging, authoringShape, validateParameters} from './authoring.ts';
import type {Packaging, Parameter} from './authoring.ts';
import {
  clone,
  createProject,
  draftSource,
  dropCombo,
  dropMotion,
  dropLock,
  dropSafety,
  removedGone,
  keyCode,
  mark,
  parseProject,
  validate,
  windowMarksOk,
} from './model.ts';
import type {Project, Mark, Position, Issue, Input} from './model.ts';
import {actionXml, keyAttrs, omitDefaults, windowAttrs} from './compiler.ts';
import {node, documentXml} from './xml.ts';
import {runtimeNameUses} from './runtimeNames.ts';
import {
  timedKeys,
  functionKeys,
  liftToRegistry,
  registryIssues,
  registryXml,
  functionErrors,
  doAttrs,
  pairRoles,
  eventKey,
} from './eventRegistry.ts';
import type {EventRow} from './eventRegistry.ts';
import {actionView, fixedThird, projectView, viewIssues, views, firstPersonStarts} from './view.ts';
import type {View, FirstPersonStart} from './view.ts';
import {tr} from './i18n/korean.ts';
import {liftStartLimits, takeStartChecks} from './startLimits.ts';
import {ordinaryEffectOps} from './clipEffects.ts';
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
  target: 'nearest' | 'combatTarget';
  /** Whether the pair's start turns the two to face each other: false for a pair played from behind. Set from the
   *  HKX's start pose (graph/pairFacing.ts), not by hand. */
  reorientSupport: boolean;
  effectsEnabled: boolean;
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
  flow?: import('./graph/conditions.ts').BranchFlow;
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
  disconnections?: import('./graph/disconnect.ts').Disconnection[];
  sharedOutputPose?: boolean;
  conditionTables?: string[];
  sharedRules?: import('./graph/sharing.ts').SharedRule[];
  /** The global event registry: every event name the project registers, with its functions. */
  eventRegistry?: EventRow[];
  drafts?: DraftNode[];
  blends?: BlendNode[];
  schema: 7;
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
  target: 'nearest',
  reorientSupport: true,
  effectsEnabled: false,
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
    schema: 7,
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
export const emptyWorkspace = (): Workspace => ({
  schema: 7,
  layout: {},
  assets: [],
  globals: {cameraReset: null},
  sharedInputs: [],
  packaging: defaultPackaging(),
  parameters: [],
  id: 'MyAnimationSet',
  name: tr('새 애니메이션 묶음'),
  actions: [],
  links: [],
});
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
  a.config.actionId = uid(
    'CustomAction',
    w.actions.map(a => a.config.actionId)
  );
  a.config.name = kind === 'pair' ? tr('새 페어') : tr('새 일반 동작');
  a.config.start.mode = 'none';
  a.position = {x: 100 + (w.actions.length % 3) * 500, y: 80 + Math.floor(w.actions.length / 3) * 220};
  if (kind === 'pair') {
    a.pair = defaultPair();
    a.config.graph = ['RootBehaviorGraph'];
    a.config.cost.enabled = false;
  }
  return a;
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
  const owned = (s: string) =>
    s === id || s.startsWith(`anim:${id}:`) || s.startsWith(`start:${id}|`) || s.startsWith(`transition:${id}:`);
  return {
    ...w,
    actions: w.actions.filter(a => a.uid !== id),
    ...(w.blends ? {blends: w.blends.filter(b => !owned(b.source) && !owned(b.target))} : {}),
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
/** Workspace schema. Saved files are schema 8, the graph document (graph/document.ts). */
export const WORKSPACE_SCHEMA = 7;

// parseWorkspace runs fixed phases on the object JSON.parse returned (owned by this parse):
//   1. fieldsBeforeMigration: defaults the migration checks rely on; they compare old actions
//      and pairs against today's shapes (wrap(createProject()), defaultPair()).
//   2. MIGRATIONS[n]: schema n -> n + 1, one step each, up to WORKSPACE_SCHEMA.
//   3. fieldsAddedInSchema7: fields added while the schema stayed at 7. A new optional field
//      gets its default here (or in phase 1 if an action/pair field), and nowhere else.
//   4. check*: validation only; throws on the first problem and never changes the document.
//   5. normalizeWorkspace: canonical forms (drafts, action configs, NOT conditions).

/** Phase 1. Action and pair fields that older schemas lack but today's shapes contain. */
/** Camera restore moved from a pair's settings to the action (10-16): a project saved before keeps it. */
function liftCamera(w: any) {
  if (!Array.isArray(w?.actions)) return;
  for (const a of w.actions) {
    const pair = a?.pair;
    if (!pair || typeof pair !== 'object' || !('cameraEnabled' in pair || 'camera' in pair)) continue;
    if (pair.cameraEnabled === true) a.cameraEnabled = true;
    if (pair.camera !== undefined && (pair.cameraEnabled === true || pair.camera?.reset)) a.camera = pair.camera;
    delete pair.cameraEnabled;
    delete pair.camera;
  }
}
function fieldsBeforeMigration(w: any) {
  if (!Array.isArray(w?.actions)) return;
  for (const a of w.actions) {
    if (a && a.cancels === undefined) a.cancels = [];
    if (a?.pair && typeof a.pair === 'object') {
      if (a.pair.targetRig === undefined) a.pair.targetRig = 'character';
      // The per-pair end position is gone (runtime 0.12.255): it applies to every pair, set in the runtime INI.
      delete a.pair.keepRootPosition;
      // The vanilla sync values are fixed (runtime 0.12.259): the alignment wait, its tolerance, motion from the root.
      delete a.pair.getToMarkTime;
      delete a.pair.markErrorThreshold;
      delete a.pair.applyMotionFromRoot;
    }
  }
}

/** Phase 2. Each step checks the document at schema n and returns it at schema n + 1. */
const MIGRATIONS: Record<number, (w: any) => any> = {
  3: w => {
    exact(w, {schema: 3, id: '', name: '', actions: [], links: []}, tr('구형 프로젝트'));
    w.schema = 4;
    w.packaging = defaultPackaging();
    w.parameters = [];
    return w;
  },
  4: w => {
    exact(w, {schema: 4, packaging: {}, parameters: [], id: '', name: '', actions: [], links: []}, tr('구형 프로젝트'));
    w.schema = 5;
    w.globals = {cameraReset: inferredCamera(Array.isArray(w.actions) ? w.actions : [])};
    w.sharedInputs = [];
    return w;
  },
  5: w => {
    exact(
      w,
      {
        schema: 5,
        globals: {},
        sharedInputs: [],
        packaging: {},
        parameters: [],
        id: '',
        name: '',
        actions: [],
        links: [],
      },
      tr('구형 프로젝트')
    );
    if (!Array.isArray(w.actions)) throw new Error(tr('동작 형식 오류'));
    for (const a of w.actions) {
      const {variants, ...legacyAction} = wrap(createProject());
      exact(a, legacyAction, tr('구형 동작'));
      a.variants = {};
      if (a.pair) {
        // A schema 5 pair still carries its camera restore (lifted to the action after the migrations, liftCamera).
        const {timeline, ...current} = defaultPair(),
          legacy = {
            ...current,
            ...('cameraEnabled' in a.pair ? {cameraEnabled: false} : {}),
            ...('camera' in a.pair ? {camera: defaultCamera()} : {}),
          };
        exact(a.pair, legacy, tr('구형 페어'));
        a.pair.timeline = defaultPairTimeline();
      }
    }
    w.schema = 6;
    return w;
  },
  // Schema 7 stores node coordinates per graph. Output format is no longer a preference.
  6: w => {
    w.schema = 7;
    w.layout = {};
    return w;
  },
};

// Own numeric keys only: "constructor" or "3" must never select a step.
const migratable = (schema: unknown): schema is number =>
  typeof schema === 'number' && Object.hasOwn(MIGRATIONS, schema);

/** Phase 3. Editor additions made while the schema stayed at 7. */
function fieldsAddedInSchema7(w: any) {
  // Format 3 (runtime 0.12.222): event functions live in the global registry.
  liftToRegistry(w);
  // 시작 제한 (runtime 0.12.276): an action's state checks move into a condition branch.
  liftStartLimits(w);
  // Motion is the HKX's AMR annotations only (runtime 0.12.231): declared motion and directions are dropped,
  // and a directional action keeps its entry clip (with that clip's detection window) as a single action.
  const withoutMotion = (a: any) => {
    if (!a || typeof a !== 'object') return;
    dropMotion(a.config);
    if (a.variants && typeof a.variants === 'object' && !Array.isArray(a.variants)) {
      delete a.variants.directional;
      for (const v of Object.values(a.variants) as any[]) dropMotion(v?.config);
    }
    if (a.clipWindows && typeof a.clipWindows === 'object' && Array.isArray(a.config?.steps))
      for (const step of Object.keys(a.clipWindows))
        if (!a.config.steps.some((s: any) => s?.id === step)) delete a.clipWindows[step];
  };
  if (Array.isArray(w?.actions)) w.actions.forEach(withoutMotion);
  if (Array.isArray(w?.drafts)) for (const d of w.drafts) withoutMotion(d?.value);
  // Combos went with XML format 4 (runtime 0.12.233): a saved combo cannot open, a single action drops the
  // empty combo fields, and a combo kept as a switched-away variant is dropped.
  const withoutCombo = (a: any) => {
    if (!a || typeof a !== 'object') return;
    dropCombo(a.config);
    if (a.variants && typeof a.variants === 'object' && !Array.isArray(a.variants)) {
      delete a.variants.combo;
      for (const v of Object.values(a.variants) as any[]) dropCombo(v?.config);
    }
  };
  if (Array.isArray(w?.actions)) w.actions.forEach(withoutCombo);
  if (Array.isArray(w?.drafts)) for (const d of w.drafts) withoutCombo(d?.value);
  // A mod package is its XML and HKX only (2026-09-30): the project switch it never wrote, and the
  // author, version and license that fed documents it no longer writes, are dropped.
  if (w?.packaging && typeof w.packaging === 'object' && !Array.isArray(w.packaging))
    for (const key of ['includeProject', 'author', 'version', 'license', 'licenseText']) delete w.packaging[key];
  if (w.assets === undefined) w.assets = [];
  if (Array.isArray(w.assets))
    for (const asset of w.assets)
      if (asset && typeof asset === 'object' && asset.preview === undefined) asset.preview = {skeletons: [], skins: []};
  if (Array.isArray(w.drafts))
    for (const d of w.drafts)
      if (d && typeof d === 'object') {
        d.from ??= '';
        d.to ??= '';
      }
  if (Array.isArray(w.actions))
    for (const a of w.actions)
      if (a?.pair?.carry && typeof a.pair.carry === 'object') {
        delete a.pair.carry.alignStart;
        // The putdown pair became a one-actor putdown Action (0.12.187): the old pair is not a valid
        // putdown, so the reference is cleared and the carry card asks for an Action.
        if ('releaseAction' in a.pair.carry) {
          delete a.pair.carry.releaseAction;
          a.pair.carry.putdownAction ??= '';
        }
        // Carry stages 2-3 (target handling, carrier hold pose).
        a.pair.carry.target ??= 'pose';
        a.pair.carry.part ??= '';
        if (a.pair.carry.hold === undefined) a.pair.carry.hold = null;
        // The hold pose's `time` served HKX hold poses, which were dropped (runtime 0.12.206).
        if (a.pair.carry.hold && 'time' in a.pair.carry.hold) delete a.pair.carry.hold.time;
        // The fix moment (runtime 0.12.190).
        if (a.pair.carry.fix === undefined) a.pair.carry.fix = null;
        // Carrying with a drawn weapon (runtime 0.12.192); weapon="keep" and weaponShow went in 0.12.238.
        a.pair.carry.weapon ??= 'sheathed';
        if (a.pair.carry.weapon === 'keep' || a.pair.carry.weaponShow)
          throw removedGone(
            a.config?.name || a.config?.actionId || tr('프로젝트'),
            tr('무기를 든 채 운반(keep·weaponShow)')
          );
        delete a.pair.carry.weaponShow;
      }
  // The control lock went in runtime 0.12.238: a lock window, a pair's lock track or a lock function that
  // is on cannot open; an unused one is dropped.
  const withoutLock = (a: any) => {
    if (!a || typeof a !== 'object') return;
    dropLock(a.config);
    dropSafety(a.config);
    if (a.variants && typeof a.variants === 'object' && !Array.isArray(a.variants))
      for (const v of Object.values(a.variants) as any[]) {
        dropLock(v?.config);
        dropSafety(v?.config);
      }
    const timeline = a.pair?.timeline;
    if (timeline && typeof timeline === 'object') {
      if (timeline.lock?.enabled) throw removedGone(a.config?.name || tr('프로젝트'), tr('조작 잠금'));
      delete timeline.lock;
      for (const track of Object.values(timeline) as any[])
        if (track && typeof track === 'object') {
          delete track.move;
          delete track.look;
        }
    }
  };
  if (Array.isArray(w?.actions)) w.actions.forEach(withoutLock);
  if (Array.isArray(w?.drafts)) {
    for (const d of w.drafts) withoutLock(d?.value);
    w.drafts = w.drafts.filter((d: any) => d?.kind !== 'notify:lock');
  }
  const lockFunction = (o: any): boolean =>
    Array.isArray(o)
      ? o.some(lockFunction)
      : !!o && typeof o === 'object' && (o.op === 'lock' || o.op === 'unlock' || Object.values(o).some(lockFunction));
  if (
    lockFunction(w?.eventRegistry) ||
    (Array.isArray(w?.actions) && w.actions.some((a: any) => lockFunction(a?.pair?.effects)))
  )
    throw removedGone(tr('프로젝트'), tr('조작 잠금 기능(lock·unlock)'));
}

/** Phase 4: optional workspace collections. */
function checkCollections(w: any) {
  const {drafts, eventRegistry, sharedRules, conditionTables, sharedOutputPose, disconnections, view} = w;
  if (view !== undefined && !views.includes(view)) throw Error(tr('기본 인칭 형식 오류'));
  if (
    disconnections !== undefined &&
    (!Array.isArray(disconnections) ||
      disconnections.length > 10000 ||
      disconnections.some(
        (c: any) =>
          !c ||
          typeof c.source !== 'string' ||
          typeof c.target !== 'string' ||
          typeof c.pin !== 'string' ||
          !Array.isArray(c.bindings) ||
          c.bindings.length > 20000 ||
          c.bindings.some(
            (e: any) =>
              !e ||
              typeof e.source !== 'string' ||
              typeof e.target !== 'string' ||
              typeof e.pin !== 'string' ||
              (e.targetPin !== undefined && typeof e.targetPin !== 'string')
          )
      ))
  )
    throw Error(tr('연결 해제 정보 형식 오류'));
  if (sharedOutputPose !== undefined && typeof sharedOutputPose !== 'boolean')
    throw Error(tr('공통 출력 포즈 형식 오류'));
  if (
    conditionTables !== undefined &&
    (!Array.isArray(conditionTables) ||
      conditionTables.length > 500 ||
      conditionTables.some((s: unknown) => typeof s !== 'string'))
  )
    throw Error(tr('조건 표 형식 오류'));
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
          !['effect', 'link', 'camera', 'state', 'feature', 'node'].includes(g.kind) ||
          !Array.isArray(g.members) ||
          g.members.length > 2000 ||
          g.members.some((m: unknown) => typeof m !== 'string')
      ))
  )
    throw Error(tr('공유 규칙 형식 오류'));
  if (drafts !== undefined) {
    if (!Array.isArray(drafts) || drafts.length > 500) throw Error(tr('독립 카드 목록 오류'));
    const ids = new Set();
    for (const d of drafts) {
      exact(d, {id: '', kind: '', owner: '', value: {}, local: '', notify: '', from: '', to: ''}, tr('독립 카드'));
      if (!/^draft:\d+$/.test(d.id) || ids.has(d.id)) throw Error(tr('독립 카드 ID 오류'));
      ids.add(d.id);
      // The draft action itself is validated when normalizeWorkspace parses it.
    }
  }
}

/** Phase 4: the workspace shell (everything but actions and links). */
function checkShell(w: any) {
  const {
    blends,
    drafts,
    qtes,
    eventRegistry,
    sharedRules,
    conditionTables,
    sharedOutputPose,
    disconnections,
    view,
    ...baseWorkspace
  } = w;
  exact(baseWorkspace, emptyWorkspace(), tr('프로젝트'));
  if (blends !== undefined) {
    if (!Array.isArray(blends) || blends.length > 2000) throw Error(tr('블렌드 목록 형식 오류'));
    const ids = new Set();
    for (const b of blends) {
      exact(b, {id: '', source: '', target: '', seconds: 0}, tr('블렌드'));
      if (!b.id || ids.has(b.id) || b.seconds < 0 || b.seconds > 5) throw Error(tr('블렌드 ID 또는 시간 오류'));
      ids.add(b.id);
    }
  }
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
  for (const i of w.sharedInputs) exact(i, {id: '', label: '', key: '', gamepad: 0}, tr('공통 입력'));
  authoringShape(w);
  if (!Array.isArray(w.actions) || !Array.isArray(w.links) || w.actions.length > 100 || w.links.length > 500)
    throw new Error(tr('동작/연결 개수 제한'));
}

/** Phase 4: one action. Stored variants are checked by parsing them as their own action.
 *  Returns the parsed config, which normalizeWorkspace stores (parsed once). */
function checkAction(a: any): Project {
  const {clipWindows, nodeAuthored, flow, view, firstPerson, cameraEnabled, camera: cameraSettings, ...baseAction} = a;
  if (cameraEnabled !== undefined && typeof cameraEnabled !== 'boolean') throw Error(tr('카메라 복구 형식 오류'));
  if (cameraSettings !== undefined) {
    const {own, ...camera} = cameraSettings ?? {};
    exact(camera, defaultCamera(), tr('카메라'));
    if (own !== undefined && own !== true) throw Error(tr('카메라: 이 동작만 형식 오류'));
  }
  if (view !== undefined && !views.includes(view)) throw Error(tr('동작 인칭 형식 오류'));
  if (firstPerson !== undefined && !firstPersonStarts.includes(firstPerson)) throw Error(tr('1인칭 시작 형식 오류'));
  if (
    flow !== undefined &&
    (!flow ||
      typeof flow.entry !== 'string' ||
      (flow.detached !== undefined && typeof flow.detached !== 'boolean') ||
      (flow.selects !== undefined && flow.selects !== true) ||
      !checkFans(flow) ||
      !Array.isArray(flow.tests) ||
      flow.tests.some(
        (t: any) =>
          !t ||
          typeof t.id !== 'string' ||
          typeof t.kind !== 'string' ||
          (t.negate !== undefined && typeof t.negate !== 'boolean') ||
          typeof t.subject !== 'string' ||
          typeof t.minimum !== 'number' ||
          [t.pass, t.fail].some(
            e =>
              e !== undefined &&
              (!e ||
                typeof e !== 'object' ||
                Object.keys(e).length !== 1 ||
                !(typeof e.node === 'string' || typeof e.action === 'string'))
          )
      ))
  )
    throw Error(tr('조건 분기 형식 오류'));
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

/** Phase 4: one link. */
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
  const {blend, ownWindow, ...baseLink} = l;
  exact(baseLink, sample, tr('연결'));
  if (ownWindow !== undefined && ownWindow !== true) throw Error(tr('전환 감지 구간 설정 오류'));
  if (blend !== undefined && (typeof blend !== 'number' || !Number.isFinite(blend) || blend < 0 || blend > 5))
    throw Error(tr('연결 블렌드 범위 오류'));
  exact(l.position, sample.position, tr('좌표'));
  for (const t of [l.open, l.close]) exact(t, mark(), tr('시각'));
}

/** Phase 5. Canonical forms; checks that need them (QTE) run on the result. */
/** Features no longer share settings (10-23, docs/mockup-card-cleanup ⑥): a group of them is dissolved on open, each
 *  member keeping the values it has. Shared connections (keys, event receivers, conditions) stay. */
export function keptSharing<T extends {kind: string; members: string[]}>(rules: T[], blendIds: Iterable<string>): T[] {
  const blends = new Set(blendIds);
  const feature = (m: string) =>
    blends.has(m) ||
    m.startsWith('notify:') ||
    /\|(stateCondition|suppress|cameraRestore|fireArrow|carryRelease|carryFix)$/.test(m);
  return rules.filter(
    g => !['effect', 'feature', 'camera', 'state'].includes(g.kind) && !(g.kind === 'node' && g.members.some(feature))
  );
}
function dissolveFeatureSharing(w: any) {
  if (!Array.isArray(w.sharedRules)) return;
  w.sharedRules = keptSharing(
    w.sharedRules,
    (w.blends ?? []).map((b: any) => b.id)
  );
  if (!w.sharedRules.length) delete w.sharedRules;
}
function normalizeWorkspace(w: any, configs: Project[]): Workspace {
  dissolveFeatureSharing(w);
  if (Array.isArray(w.drafts))
    for (const d of w.drafts)
      d.value = parseWorkspace(JSON.stringify({...emptyWorkspace(), actions: [d.value]})).actions[0];
  w.actions.forEach((a: any, i: number) => (a.config = configs[i]));
  const qerrors = qteErrors(w);
  if (qerrors.length) throw Error(qerrors.join('\n'));
  return foldNotConditions(w);
}

export function parseWorkspace(text: string): Workspace {
  if (text.length > 2_000_000) throw new Error(tr('프로젝트는 2 MB 이하여야 합니다.'));
  let w = JSON.parse(text);
  if (w && typeof w === 'object') delete w.xmlVersion;
  if (w?.schema === 8) return repairEmptyPlaybacks(parseWorkspace(JSON.stringify(lowerGraph(w))));
  fieldsBeforeMigration(w);
  // Schemas 1-2 (and unversioned files) are single-action projects. Their state checks move into a branch of the
  // action they become (runtime 0.12.276).
  if (!migratable(w?.schema) && w?.schema !== WORKSPACE_SCHEMA) {
    const raw = JSON.parse(text),
      checks = takeStartChecks(raw);
    const single = migrateWorkspace(parseProject(JSON.stringify(raw)));
    if (single.actions[0]) Object.assign(single.actions[0].config, checks);
    return liftStartLimits(single);
  }
  while (w.schema !== WORKSPACE_SCHEMA) w = MIGRATIONS[w.schema](w);
  fieldsAddedInSchema7(w);
  liftCamera(w);
  checkCollections(w);
  checkShell(w);
  const configs = w.actions.map(checkAction);
  for (const l of w.links) checkLink(l);
  return normalizeWorkspace(w, configs);
}
export function validateWorkspace(w: Workspace): Issue[] {
  try {
    w = lowerDisconnected(w);
  } catch (e) {
    return [{level: 'error', node: 'GRAPH', message: String(e)}];
  }
  w = sourceLinks(w);
  const out: Issue[] = [],
    err = (node: string, message: string) => out.push({level: 'error', node, message});
  const drafts = lowerFlowDrafts(w);
  w = drafts.workspace;
  for (const id of drafts.omitted)
    out.push({level: 'warning', node: id, message: tr('진입 경로에 연결되지 않은 조건은 XML에 포함되지 않습니다.')});
  for (const message of checkFlows(w)) err('Flow', message);
  for (const i of unpairableRoutes(w)) out.push({level: 'warning', ...i});
  for (const i of runtimeNameUses(w)) out.push({level: 'warning', ...i});
  out.push(...registryIssues(w));
  out.push(...viewIssues(w));
  try {
    parseWorkspace(JSON.stringify(w));
    w = lowerBlends(w);
  } catch (e) {
    return [{level: 'error', node: 'project', message: String(e)}];
  }
  if (w.globals.cameraReset && !eventOk(w.globals.cameraReset))
    err('globals', tr('카메라 복구 이벤트 이름을 확인하세요.'));
  if (w.drafts?.length)
    out.push({
      level: 'warning',
      node: 'project',
      message: tr('연결되지 않은 카드 {length}개는 XML에 포함되지 않습니다.', {length: w.drafts.length}),
    });
  const sharedIds = new Set<string>();
  for (const i of w.sharedInputs) {
    if (
      !idOk(i.id) ||
      sharedIds.has(i.id.toLowerCase()) ||
      !i.label.trim() ||
      (i.key && (!keyCode(i.key) || keyCode(i.key) > 265)) ||
      (!i.key && !i.gamepad) ||
      !number(i.gamepad, 0, 65535) ||
      !Number.isInteger(i.gamepad)
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
    if (!idOk(a.uid) || a.uid.length > 48 || uids.has(a.uid) || ids.has(a.config.actionId.toLowerCase()))
      err(a.uid, tr('동작 ID가 중복되었거나 잘못되었습니다.'));
    uids.add(a.uid);
    ids.add(a.config.actionId.toLowerCase());
    for (const e of validate(a.config, selectsOnly(a)))
      // Named as the user sees the action (its display name), not by its XML id.
      out.push({...e, node: a.uid, message: (a.config.name.trim() || a.config.actionId) + ': ' + e.message});
    if (a.pair && a.config.fireArrow) err(a.uid, tr('페어에는 활 발사를 사용할 수 없습니다.'));
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
      !['nearest', 'combatTarget'].includes(p.target) ||
      (p.target === 'combatTarget' && a.config.start.mode !== 'event')
    )
      err(a.uid, tr('전투 대상 연결은 이벤트 시작에만 사용하세요.'));
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
    if (!a || !b || a === b) {
      err(l.id, tr('유효한 출발·도착 동작을 지정하세요.'));
      continue;
    }
    if (
      l.blend !== undefined &&
      (!number(l.blend, 0, 5) || a.pair || b.pair || a.config.steps.length !== 1 || b.config.steps.length !== 1)
    )
      err(l.id, tr('경로별 블렌드는 단일 일반 HKX 사이에서만 지원합니다.'));
    if (l.partnerTo && (!a.pair || b.pair || !partner || partner.pair))
      err(l.id, tr('양쪽 일반 전환은 페어 출발과 일반/콤보 목적지가 필요합니다.'));
    if (!['input', 'event'].includes(l.mode)) err(l.id, tr('연결 시작 방식 오류'));
    if (l.mode === 'event') {
      if (!eventOk(l.event)) err(l.id, tr('연결 이벤트 이름을 입력하세요.'));
      const s = a.uid + ':event:' + l.event;
      if (signatures.has(s)) err(l.id, tr('같은 출발 이벤트의 연결이 중복됩니다.'));
      signatures.add(s);
    } else {
      const input = a.config.inputs.find(i => i.id === l.input);
      // No window: the whole clip (format 4).
      if (!input) err(l.id, tr('키 전환은 출발 동작의 키가 필요합니다.'));
      if (input) {
        for (const s of [
          input.key ? 'key:' + keyCode(input.key) : '',
          input.gamepad ? 'pad:' + input.gamepad : '',
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
/**
 * An action whose flow picks other actions and never its own clip: a choice, not a playback. The
 * runtime reads only its start, its conditions (they gate every branch, runtime 0.12.239), the events
 * it suppresses and the flow; its clip settings, QTEs and transitions never apply. It is written
 * without a clip (runtime 0.12.244) and its HKX card is not drawn (graph/sharing.ts).
 */
export function selectsOnly(a: Action): boolean {
  const f = a.flow;
  if (!f?.tests.some(t => t.id === f.entry)) return false;
  const ends = f.tests.flatMap(t => [t.pass, t.fail]).flatMap(e => (e && 'action' in e ? [e.action] : []));
  // With no destination yet only a flow made to select (graph/flat.ts splitCondition) selects: a new HKX card
  // whose condition is emptied keeps its card.
  return !ends.includes(a.uid) && (ends.length > 0 || f.selects === true);
}
const SELECTING = new Set(['Start', 'Require', 'Suppress', 'Flow']);

function cameraNode(w: Workspace, camera: CameraRestore) {
  return node(
    'Camera',
    omitDefaults(
      {reset: cameraReset(w, camera) || undefined, restore: camera.restore, timeout: camera.timeout},
      {restore: 'end', timeout: 10}
    )
  );
}
export function compileWorkspace(w: Workspace): string {
  w = lowerDisconnected(w);

  w = sourceLinks(w);
  const errors = validateWorkspace(w).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(e => e.node + ': ' + e.message).join('\n'));
  w = lowerFlowDrafts(w).workspace;
  w = lowerBlends(w);
  const root = node('AnimationSet', {
    version: XML_FORMAT_VERSION,
    id: w.id,
    view: projectView(w) !== 'third' ? projectView(w) : undefined,
  });
  // Format 4 writes every key where it is used (Start, Connect, Carry); the file has no <Inputs>.
  for (const a of w.actions) {
    const config = clone(a.config),
      pair = a.pair,
      input = (id: string) => keyAttrs(config.inputs.find(i => i.id === id));
    const out = actionXml(config, !!pair, selectsOnly(a));
    root.children.push(out);
    // The view when it is not the file's; pairs and putdowns play in third person whatever it says.
    if (!fixedThird(w, a) && actionView(w, a) !== projectView(w)) out.attrs.view = actionView(w, a);
    if (actionView(w, a) === 'third' && a.firstPerson === 'switch') out.attrs.firstPerson = 'switch';
    if (a.flow) out.children.push(flowXml(w, a.uid));
    out.children.push(...qteXml(w, a));
    if (!a.enterBlendEnabled) out.children = out.children.filter(n => n.name !== 'Enter');
    if (!a.exitBlendEnabled) delete out.children.find(n => n.name === 'Exit')!.attrs.blend;
    out.children = out.children.filter(n => n.name !== 'Exit' || Object.keys(n.attrs).length);
    // A vanilla cancel: its id when it is not the one the runtime gives it (cancel1, cancel2, ... by position);
    // no <Window> when it is open for the whole clip.
    (a.cancels ?? []).forEach((c, index) =>
      out.children.push(
        node(
          'Cancel',
          {
            id: cancelXmlId(c) === 'cancel' + (index + 1) ? undefined : cancelXmlId(c),
            to: c.to,
            blend: c.blend ?? undefined,
          },
          c.always ? [] : [node('Window', windowAttrs(c.open, c.close, c.buffered))]
        )
      )
    );
    if (pair) {
      out.name = 'Pair';
      const target = omitDefaults(
        {range: pair.range, angle: pair.angle, rig: pair.targetRig ?? 'character'},
        {range: 150, angle: 60, rig: 'character'}
      );
      if (Object.keys(target).length) out.children.push(node('Target', target));
      if (pair.lossEnabled) out.children.push(node('OnPartnerLost', {blend: pair.lossBlend}));
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
                      carry.hold.bones.map(b =>
                        node('Bone', omitDefaults({name: b.name, weight: b.weight}, {weight: 1}))
                      )
                    ),
                  ]
                : []),
            ]
          )
        );
      // The pair's synchronisation values are its Advanced; an Advanced left empty is not written.
      const settings = omitDefaults({reorientSupport: pair.reorientSupport}, {reorientSupport: true});
      if (Object.keys(settings).length) out.children.push(node('Advanced', settings));
      if (config.start.mode === 'event' && pair.target !== 'nearest')
        out.children.find(n => n.name === 'Start')!.attrs.target = pair.target;
      if (pair.effectsEnabled) {
        const effects = node(
          'Effects',
          omitDefaults({interruptOnThirdPartyHit: pair.interruptOnThirdPartyHit}, {interruptOnThirdPartyHit: false})
        );
        if (a.cameraEnabled && a.camera) effects.children.push(cameraNode(w, a.camera));
        for (const e of [...pair.effects, ...pairTimelineEffects(pair)])
          effects.children.push(node('Do', doAttrs(e.values, true)));
        out.children.push(effects);
      }
    }
    // An ordinary action's Effects: its camera restore (runtime 0.12.260) and its clip-time functions (0.12.274).
    if (!a.pair && ((a.cameraEnabled && a.camera) || a.config.effects?.length))
      out.children.push(
        node('Effects', {}, [
          ...(a.cameraEnabled && a.camera ? [cameraNode(w, a.camera)] : []),
          ...(a.config.effects ?? []).map(e => node('Do', doAttrs(e.values, true))),
        ])
      );
    // Transitions (Connect): no <Window> is the whole clip.
    for (const l of w.links.filter(l => l.from === a.uid)) {
      const target = w.actions.find(a => a.uid === l.to)!,
        partner = w.actions.find(a => a.uid === l.partnerTo);
      out.children.push(
        node(
          'Connect',
          {
            to: target.config.actionId,
            blend: l.blend,
            partnerTo: partner?.config.actionId,
            ...(l.mode === 'event' ? {event: l.event} : input(l.input)),
          },
          l.window ? [node('Window', windowAttrs(l.open, l.close, l.buffered))] : []
        )
      );
    }
    if (selectsOnly(a)) out.children = out.children.filter(n => SELECTING.has(n.name));
  }
  // The global event registry comes first: every name the file registers, with its functions, and the QTEs
  // events start (runtime 0.12.248) under their event (a name registered here or one only they use).
  let registry = registryXml(w);
  for (const {event, xml} of eventQteXml(w)) {
    registry ??= node('EventRegistry', {}, []);
    let e = registry.children.find(c => c.name === 'Event' && eventKey(c.attrs.name ?? '') === eventKey(event));
    if (!e) registry.children.push((e = node('Event', {name: event}, [])));
    e.children.push(xml);
  }
  if (registry) root.children.unshift(registry);
  return documentXml(root);
}
