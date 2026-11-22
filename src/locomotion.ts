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
export type Locomotion = {
  /** Per weapon kind, how it moves: absent = vanilla. */
  trees?: Partial<Record<TreeWeapon, TreeUse>>;
  /** The sets left vanilla (<Except set>); absent = none. */
  except?: LadderSet[];
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

/** <Locomotion> as the runtime reads it; throws its message on what it refuses. */
export function readLocomotion(n: Xml): Locomotion {
  shapeXml(n, [], ['Tree', 'Except']);
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
  return out;
}

/** <Locomotion> to write; none without a declaration. Trees, then the excepted sets in the runtime's order. */
export function locomotionXml(l: Locomotion | undefined): Xml | undefined {
  if (!l) return undefined;
  const trees = TREE_WEAPONS.filter(w => l.trees?.[w]).map(w => node('Tree', {weapon: w, use: l.trees![w]}));
  const except = LADDER_SETS.filter(s => l.except?.includes(s)).map(s => node('Except', {set: s}));
  return node('Locomotion', {}, [...trees, ...except]);
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
  const {trees, except, ...rest} = l as Record<string, unknown>;
  if (Object.keys(rest).length) bad();
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
