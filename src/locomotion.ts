// The locomotion (<Locomotion>, runtime 1.0.9; runtime docs/설계-이동사다리-완충칸.md section 7): with it every weapon
// state's direction blenders play a walk or a run alone at the rate that follows the actor's speed. It declares only
// the weapon kinds that get a locomotion tree of their own (<Tree>) and the sets it leaves vanilla (<Except>): there
// are no numbers. Read and checked as the runtime's XmlV2 Locomotion() reads it (its messages), written back the same
// way; one card on the canvas edits it (graph/LocomotionCard.tsx).
import type {Xml} from './xml.ts';
import {node, shapeXml} from './xml.ts';
import type {Issue} from './model.ts';
import {tr} from './i18n/korean.ts';
import {ownTreeFiles} from './ownTreeFiles.ts';

/** The runtime's set names (runtime/LadderSpec.h kSets), in its order. */
export const LADDER_SETS = [
  '1HM',
  '2HM',
  '2HW',
  'H2H',
  'Bow',
  'CrossBow',
  'Magic',
  'MagicCast',
  'Sheathed',
  'Sneak',
  'Block1HM',
  'Block2HM',
  'BlockBow',
  'BlockSneak',
  'Block2HW',
  'BlockH2H',
] as const;
export type LadderSet = (typeof LADDER_SETS)[number];
/** The weapon kinds that move with another kind's tree in vanilla (runtime/LadderSpec.h kTreeKinds): two-handed
 *  axes and hammers (the 2HM tree) and unarmed (the 1HM tree). */
export const TREE_WEAPONS = ['2HW', 'H2H'] as const;
export type TreeWeapon = (typeof TREE_WEAPONS)[number];
/** `own`: a copy of the other kind's tree playing the weapon's own files. `2HM` (2HW only): the 2HM tree whole. */
export type TreeUse = 'own' | '2HM';
type TreeKind = {from: LadderSet; set: LadderSet; blockFrom: LadderSet; blockSet: LadderSet; shared: boolean};
export const TREE_KINDS: Record<TreeWeapon, TreeKind> = {
  '2HW': {from: '2HM', set: '2HW', blockFrom: 'Block2HM', blockSet: 'Block2HW', shared: true},
  H2H: {from: '1HM', set: 'H2H', blockFrom: 'Block1HM', blockSet: 'BlockH2H', shared: false},
};
/** <Stance side> (runtime 1.0.9, runtime/LadderSpec.h StanceSpec): while an upper-body part action plays, its clip's
 *  chest turned that way by more than `from` degrees moves the legs onto these walk / run files, wholly at `full`.
 *  `walk` and `run` are path prefixes the direction and `.hkx` are appended to (STANCE_DIRECTIONS). */
export const STANCE_SIDES = ['right', 'left'] as const;
export type StanceSide = (typeof STANCE_SIDES)[number];
export type Stance = {from: number; full: number; walk?: string; run?: string};
export const STANCE_DEFAULT: Stance = {from: 25, full: 45};
/** The direction names a stance prefix takes (runtime/LadderSpec.h LadderNames kDirections). */
export const STANCE_DIRECTIONS = [
  'Forward',
  'ForwardLeft',
  'Left',
  'BackwardLeft',
  'Backward',
  'BackwardRight',
  'Right',
  'ForwardRight',
] as const;
export type Locomotion = {
  /** Per weapon kind, how it moves: absent = vanilla. */
  trees?: Partial<Record<TreeWeapon, TreeUse>>;
  /** The sets left vanilla (<Except set>); absent = none. */
  except?: LadderSet[];
  /** The stance sets by side (<Stance>); absent = none. */
  stances?: Partial<Record<StanceSide, Stance>>;
};
/** The one file the runtime reads the locomotion from: SKSE/Plugins/AnimationInjector/Locomotion/Locomotion.xml
 *  (runtime/LadderSpec.h kLocomotionFile). Two mods' files meet at that path, so the mod manager's priority picks one
 *  whole; a <Locomotion> in any other file is not read. This is the folder's and the file's name. */
export const LOCOMOTION_FILE = 'Locomotion';
/** The canvas card of the project's ladders (graph/flat.ts). */
export const LOCOMOTION_NODE = 'locomotion';

const isSet = (s: string): s is LadderSet => (LADDER_SETS as readonly string[]).includes(s);
const isWeapon = (s: string): s is TreeWeapon => (TREE_WEAPONS as readonly string[]).includes(s);

export const setLabel = (s: LadderSet): string =>
  ({
    '1HM': tr('한손·맨손'),
    '2HM': tr('양손검'),
    '2HW': tr('양손 도끼·망치'),
    H2H: tr('맨손'),
    Bow: tr('활'),
    CrossBow: tr('석궁'),
    Magic: tr('마법 준비'),
    MagicCast: tr('시전하며 이동'),
    Sheathed: tr('무기 넣음'),
    Sneak: tr('잠행'),
    Block1HM: tr('막기 · 한손·맨손·마법'),
    Block2HM: tr('막기 · 양손'),
    BlockBow: tr('막기 · 활·석궁'),
    BlockSneak: tr('막기 · 잠행'),
    Block2HW: tr('막기 · 양손 도끼·망치'),
    BlockH2H: tr('막기 · 맨손'),
  })[s];
export const isBlockSet = (s: LadderSet) => s.startsWith('Block');
/** The weapon whose own tree a set's blenders belong to (the runtime makes them only with <Tree use="own">). */
export const treeWeaponOf = (s: LadderSet): TreeWeapon | undefined =>
  TREE_WEAPONS.find(w => TREE_KINDS[w].set === s || TREE_KINDS[w].blockSet === s);
export const treeUse = (l: Locomotion | undefined, weapon: TreeWeapon): TreeUse | undefined => l?.trees?.[weapon];
/** No declaration at all. A declaration with nothing in it is every set (<Locomotion/>). */
export const locomotionEmpty = (l: Locomotion | undefined) => !l;
/** Whether the runtime splits the set's blenders (runtime/LadderSpec.h Applies): not excepted, and for an own tree's
 *  set, that weapon has its own tree. */
export const setApplies = (l: Locomotion | undefined, s: LadderSet): boolean => {
  if (!l || l.except?.includes(s)) return false;
  const weapon = treeWeaponOf(s);
  return !weapon || treeUse(l, weapon) === 'own';
};
/** The sets the declaration covers, in the runtime's order. */
export const ladderSets = (l: Locomotion | undefined): LadderSet[] => LADDER_SETS.filter(s => setApplies(l, s));
/** The sets the game has with this declaration: all but an own tree's sets without that tree. */
export const offeredSets = (l: Locomotion | undefined): LadderSet[] =>
  LADDER_SETS.filter(s => {
    const weapon = treeWeaponOf(s);
    return !weapon || treeUse(l, weapon) === 'own';
  });

const required = (n: Xml, key: string) => {
  const s = n.attrs[key];
  if (!s) throw Error(tr('{name}.{k}: 필수 값', {name: n.name, k: key}));
  return s;
};

/** The files a stance prefix names, in the runtime's direction order; none without a prefix. */
export const stanceFiles = (prefix: string | undefined): string[] =>
  prefix ? STANCE_DIRECTIONS.map(d => prefix + d + '.hkx') : [];
/** The prefix of a file named for a direction ("Animations\\Bow\\WalkForwardLeft.hkx" -> "Animations\\Bow\\Walk"), or
 *  undefined when its name does not end in one. */
export function stancePrefixOf(clip: string): string | undefined {
  const m = /^(.*?)(ForwardLeft|ForwardRight|BackwardLeft|BackwardRight|Forward|Backward|Left|Right)\.hkx$/i.exec(clip);
  return m && m[1] ? m[1] : undefined;
}
/** Which sides the locomotion uses: none, one, or both. */
export type StanceChoice = '' | StanceSide | 'both';
export const stanceChoice = (l: Locomotion | undefined): StanceChoice => {
  const right = !!l?.stances?.right,
    left = !!l?.stances?.left;
  return right && left ? 'both' : right ? 'right' : left ? 'left' : '';
};
export const stanceSides = (l: Locomotion | undefined): StanceSide[] => STANCE_SIDES.filter(s => l?.stances?.[s]);
const angle = (n: Xml, key: string, d: number) => {
  const s = n.attrs[key];
  if (s === undefined) return d;
  const v = Number(s);
  if (!s.trim() || !Number.isFinite(v) || v < 0 || v > 180) throw Error(tr('숫자 범위 또는 형식 오류: ') + s);
  return v;
};
/** One <Stance>'s problem as the runtime words it, or empty. */
function stanceProblem(s: Stance): string {
  if (!(s.full > s.from)) return tr('full은 from보다 커야 합니다');
  if (!s.walk && !s.run) return tr('walk나 run 중 하나는 지정해야 합니다');
  for (const prefix of [s.walk, s.run])
    if (prefix && prefix.toLowerCase().endsWith('.hkx'))
      return tr('walk·run은 방향 이름 앞까지의 경로입니다(예: Animations\\bowdrawn_walk): ') + prefix;
  return '';
}

/** <Locomotion> as the runtime reads it; throws its message on what it refuses. */
export function readLocomotion(n: Xml): Locomotion {
  shapeXml(n, [], ['Tree', 'Except', 'Stance']);
  const out: Locomotion = {};
  for (const t of n.children.filter(c => c.name === 'Tree')) {
    shapeXml(t, ['weapon', 'use']);
    const weapon = required(t, 'weapon'),
      use = required(t, 'use');
    if (!isWeapon(weapon)) throw Error(tr('weapon은 2HW 또는 H2H입니다: ') + weapon);
    if (use !== 'own' && use !== '2HM') throw Error(tr('use는 own 또는 2HM입니다: ') + use);
    if (use === '2HM' && !TREE_KINDS[weapon].shared) throw Error(tr('use="2HM"은 weapon="2HW"에만 씁니다'));
    if (out.trees?.[weapon]) throw Error(tr('같은 weapon을 두 번 지정했습니다: ') + weapon);
    (out.trees ??= {})[weapon] = use;
  }
  for (const e of n.children.filter(c => c.name === 'Except')) {
    shapeXml(e, ['set']);
    const set = required(e, 'set');
    if (!isSet(set)) throw Error(tr('set은 {sets} 중 하나입니다: ', {sets: LADDER_SETS.join(', ')}) + set);
    if (out.except?.includes(set)) throw Error(tr('같은 set을 두 번 뺐습니다: ') + set);
    (out.except ??= []).push(set);
  }
  for (const s of n.children.filter(c => c.name === 'Stance')) {
    shapeXml(s, ['side', 'from', 'full', 'walk', 'run']);
    const side = required(s, 'side');
    if (side !== 'right' && side !== 'left') throw Error(tr('side는 right 또는 left입니다: ') + side);
    if (out.stances?.[side]) throw Error(tr('같은 side를 두 번 지정했습니다: ') + side);
    const stance: Stance = {from: angle(s, 'from', 25), full: angle(s, 'full', 45)};
    if (s.attrs.walk) stance.walk = s.attrs.walk;
    if (s.attrs.run) stance.run = s.attrs.run;
    const problem = stanceProblem(stance);
    if (problem) throw Error(problem);
    (out.stances ??= {})[side] = stance;
  }
  return out;
}

/** <Locomotion> to write; none without a declaration. Trees, then the excepted sets in the runtime's order. */
export function locomotionXml(l: Locomotion | undefined): Xml | undefined {
  if (!l) return undefined;
  const trees = TREE_WEAPONS.filter(w => l.trees?.[w]).map(w => node('Tree', {weapon: w, use: l.trees![w]}));
  const except = LADDER_SETS.filter(s => l.except?.includes(s)).map(s => node('Except', {set: s}));
  const stances = stanceSides(l).map(side => {
    const s = l.stances![side]!;
    return node('Stance', {side, from: s.from, full: s.full, walk: s.walk || undefined, run: s.run || undefined});
  });
  return node('Locomotion', {}, [...trees, ...except, ...stances]);
}

const fileKey = (clip: string) => clip.replaceAll('\\', '/').toLowerCase();
/** A file of a weapon's own tree (<Tree use="own">): its clip path, its group and the source it has. */
export type TreeFile = {
  weapon: TreeWeapon;
  clip: string;
  name: string;
  group: 'walk' | 'run' | 'strafe';
  localPath: string;
};
export const isTreeFile = (clip: string) =>
  TREE_WEAPONS.some(w => ownTreeFiles[w].some(f => fileKey(f.clip) === fileKey(clip)));
type WithFiles = {locomotion?: Locomotion; assets: {clip: string; localPath: string}[]};
/** The files the runtime looks for with the weapon's own tree (ownTreeFiles.ts), each with its source
 *  in the HKX library (`assets`); none unless the weapon has its own tree. A file without a source is not an error:
 *  the runtime plays the source kind's file in its place. */
export function treeFiles(w: WithFiles, weapon: TreeWeapon): TreeFile[] {
  if (treeUse(w.locomotion, weapon) !== 'own') return [];
  return ownTreeFiles[weapon].map(f => ({
    ...f,
    weapon,
    name: f.clip.split('\\').at(-1)!,
    localPath: w.assets.find(a => fileKey(a.clip) === fileKey(f.clip))?.localPath ?? '',
  }));
}
/** Every own tree's files. */
export const allTreeFiles = (w: WithFiles): TreeFile[] => TREE_WEAPONS.flatMap(weapon => treeFiles(w, weapon));
/** Which foot sync annotations an own tree's file lacks. The runtime takes such a file's foot timing and footsteps
 *  from its own FootLeft and FootRight annotations alone (OwnLocomotion), so both must be there. */
export function missingFeet(annotations: {text: string}[]): string[] {
  const has = (name: string) => annotations.some(a => a.text.split('|')[0].trim().toLowerCase() === name.toLowerCase());
  return ['FootLeft', 'FootRight'].filter(name => !has(name));
}

/** The ground speed a dedicated file's step was made for, as the runtime reads it (core/ClipHooks): the distance of
 *  its last "animmotion x y z" annotation over that annotation's time (the file's length when it sits at 0).
 *  Undefined: the file has none, and the runtime plays it as if its step were the source file's. */
export function motionSpeed(annotations: {time: number; text: string}[], duration: number): number | undefined {
  let at = -1,
    distance = 0;
  for (const a of annotations) {
    const m = /^animmotion\s+(\S+)\s+(\S+)/.exec(a.text);
    if (!m || a.time <= at) continue;
    const x = Number(m[1]),
      y = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    at = a.time;
    distance = Math.hypot(x, y);
  }
  const seconds = at > 0 ? at : duration;
  return distance > 0 && seconds > 0 ? distance / seconds : undefined;
}

/** What the runtime would refuse (the same rules as readLocomotion). */
export function locomotionIssues(l: Locomotion | undefined): Issue[] {
  if (!l) return [];
  const out: Issue[] = [];
  for (const w of TREE_WEAPONS)
    if (l.trees?.[w] === '2HM' && !TREE_KINDS[w].shared)
      out.push({level: 'error', node: LOCOMOTION_NODE, message: tr('use="2HM"은 weapon="2HW"에만 씁니다')});
  if (new Set(l.except).size !== (l.except?.length ?? 0))
    out.push({level: 'error', node: LOCOMOTION_NODE, message: tr('같은 set을 두 번 뺐습니다: ') + l.except!.join(' ')});
  for (const side of stanceSides(l)) {
    const problem = stanceProblem(l.stances![side]!);
    if (problem) out.push({level: 'error', node: LOCOMOTION_NODE, message: `${stanceSideLabel(side)}: ${problem}`});
  }
  return out;
}

// Edits (the card's). Each takes the workspace's locomotion object, creating it when needed.
type WithLocomotion = {locomotion?: Locomotion};
/** The declaration, made (every set, no tree) when the project had none (the tree's +). */
export function ensureLocomotion(w: WithLocomotion): Locomotion {
  return (w.locomotion ??= {});
}
/** Leaves a set vanilla, or covers it again. */
export function setExcept(w: WithLocomotion, set: LadderSet, except: boolean) {
  const l = ensureLocomotion(w);
  const rest = (l.except ?? []).filter(s => s !== set);
  const next = except ? LADDER_SETS.filter(s => s === set || rest.includes(s)) : rest;
  if (next.length) l.except = next;
  else delete l.except;
}
/** How a weapon kind moves. Its two sets exist in the game only with its own tree; an exception of theirs stays, so
 *  that turning the tree off and on again loses nothing. */
export function setTreeUse(w: WithLocomotion, weapon: TreeWeapon, use: TreeUse | undefined) {
  const l = ensureLocomotion(w);
  if (use === '2HM' && !TREE_KINDS[weapon].shared) throw Error(tr('use="2HM"은 weapon="2HW"에만 씁니다'));
  if (use) (l.trees ??= {})[weapon] = use;
  else if (l.trees) {
    delete l.trees[weapon];
    if (!Object.keys(l.trees).length) delete l.trees;
  }
}
export const stanceSideLabel = (side: StanceSide) => (side === 'right' ? tr('우측 상체') : tr('좌측 상체'));
/** Which sides have a stance set: a side kept keeps its values, a new one starts at the defaults. */
export function setStanceChoice(w: WithLocomotion, choice: StanceChoice) {
  const l = ensureLocomotion(w);
  const keep = (side: StanceSide) => choice === side || choice === 'both';
  const next: Partial<Record<StanceSide, Stance>> = {};
  for (const side of STANCE_SIDES) if (keep(side)) next[side] = l.stances?.[side] ?? {...STANCE_DEFAULT};
  if (Object.keys(next).length) l.stances = next;
  else delete l.stances;
}
/** One side's values. */
export function setStance(w: WithLocomotion, side: StanceSide, patch: Partial<Stance>) {
  const l = ensureLocomotion(w);
  const s: Stance = {...(l.stances?.[side] ?? STANCE_DEFAULT), ...patch};
  for (const key of ['walk', 'run'] as const) if (!s[key]) delete s[key];
  (l.stances ??= {})[side] = s;
}
export function removeLocomotion(w: WithLocomotion) {
  delete w.locomotion;
}

/** The project file's locomotion (workspace.ts checkShell): the shape the editor writes, nothing else. */
export function checkLocomotionShape(l: unknown) {
  if (l === undefined) return;
  const bad = () => {
    throw Error(tr('이동 선언 형식 오류'));
  };
  if (!l || typeof l !== 'object') bad();
  const {trees, except, stances, ...rest} = l as Record<string, unknown>;
  if (Object.keys(rest).length) bad();
  if (stances !== undefined) {
    if (!stances || typeof stances !== 'object') bad();
    for (const [side, s] of Object.entries(stances as Record<string, unknown>)) {
      if (side !== 'right' && side !== 'left') bad();
      if (!s || typeof s !== 'object') bad();
      const {from, full, walk, run, ...more} = s as Record<string, unknown>;
      if (Object.keys(more).length || !Number.isFinite(from) || !Number.isFinite(full)) bad();
      for (const p of [walk, run]) if (p !== undefined && typeof p !== 'string') bad();
    }
  }
  if (trees !== undefined) {
    if (!trees || typeof trees !== 'object') bad();
    for (const [weapon, use] of Object.entries(trees as Record<string, unknown>))
      if (!isWeapon(weapon) || (use !== 'own' && use !== '2HM')) bad();
  }
  if (except !== undefined) {
    if (!Array.isArray(except) || except.length > LADDER_SETS.length) bad();
    for (const s of except as unknown[]) if (typeof s !== 'string' || !isSet(s)) bad();
  }
}
