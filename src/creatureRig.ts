// A creature's own action (runtime 1.1.0 <Action rig>, docs/mockup-creature-rig 2안): the skeleton comes from the
// folder the HKX sits in (meshes/actors/<folder>/, which resolve_hkx requires and makes the clip relative to). The HKX
// itself cannot say: many vanilla creature clips carry no bone names, and the bone-set match took a draugr clip for a
// hagraven's and a scrib's for a dog's (11-05 test on 37 vanilla clips). Creatures sharing a folder share a skeleton,
// and the runtime plays one's action on all of them (its skeleton family).
import {pairedRig, pairedRigs, type PairedRig} from './pairedRigs.ts';
import type {Action, Workspace} from './workspace.ts';
import type {Project} from './model.ts';
import {actionView} from './view.ts';
import {tr} from './i18n/korean.ts';
import {t} from './i18n/index.ts';

export const isCreatureRig = (rig?: PairedRig): rig is PairedRig => !!rig && rig !== 'character';
/** The skeleton an HKX card plays with: an ordinary card's rig, a pair's initiator (runtime 1.1.0 <Pair rig>). */
export const actionRig = (a: Action): PairedRig => a.config.rig ?? 'character';
/** A pair's partner skeleton (FindPartner rig). */
export const partnerRig = (a: Action): PairedRig => a.pair?.targetRig ?? 'character';
/** The folder a card's clip is relative to: a creature's own clip its actor folder; a pair's (both roles read the one
 *  paired HKX) the character's. */
export const clipRoot = (a: Action) => (a.pair ? pairedRig('character').actorRoot : rigRoot(actionRig(a)));

/** The skeleton of the actor folder holding this local HKX (the deepest match, as resolve_hkx anchors the clip), or
 *  undefined outside every actor folder. */
export function rigFromPath(path: string): PairedRig | undefined {
  const folded = path.replaceAll('\\', '/').toLowerCase();
  let best: {rig: PairedRig; end: number} | undefined;
  for (const r of pairedRigs) {
    const anchor = '/' + r.actorRoot.toLowerCase() + '/';
    const at = folded.lastIndexOf(anchor);
    if (at >= 0 && (!best || at + anchor.length > best.end)) best = {rig: r.id, end: at + anchor.length};
  }
  return best?.rig;
}
/** The creatures sharing this one's folder and so its skeleton: the runtime plays its action on all of them. */
export const rigFamily = (rig: PairedRig): PairedRig[] =>
  pairedRigs.filter(r => r.actorRoot === pairedRig(rig).actorRoot).map(r => r.id);
/** Their names for a card's header: 「늑대·개」. */
export const familyLabel = (rig: PairedRig) =>
  rigFamily(rig)
    .map(r => pairedRig(r).label)
    .join('·');
export const sameFamily = (a: PairedRig, b: PairedRig) => pairedRig(a).actorRoot === pairedRig(b).actorRoot;
/** The folder its clip is relative to. */
export const rigRoot = (rig: PairedRig) => pairedRig(rig).actorRoot;

/** The settings with this rig: the character's is the default, written as none. */
export function withRig(config: Project, rig: PairedRig): Project {
  const {rig: _old, ...rest} = config;
  return isCreatureRig(rig) ? {...rest, rig} : rest;
}

/** A card's settings with the rig of the folder its new HKX sits in: unchanged without a local path or outside every
 *  actor folder; a pair's rig comes from its HKX's track names instead (graph/pairFacing.ts). */
export function withRigOf(a: Action, config: Project, path: string): Project {
  const rig = a.pair || !path ? undefined : rigFromPath(path);
  return rig ? withRig(config, rig) : config;
}

/** Why a transition from a to b cannot be: they play on different skeletons. undefined when it can. */
export const crossRigError = (a: Action, b: Action) =>
  sameFamily(actionRig(a), actionRig(b))
    ? undefined
    : tr('스켈레톤이 다른 동작으로는 전환할 수 없습니다({from} → {to}).', {
        from: familyLabel(actionRig(a)),
        to: familyLabel(actionRig(b)),
      });
/** Why `next` cannot be a pair's partner's next action (partnerTo): the partner plays it, on the pair's partner
 *  skeleton. undefined when it can. */
export const partnerRigError = (pair: Action, next: Action) =>
  sameFamily(actionRig(next), partnerRig(pair))
    ? undefined
    : tr('상대의 다음 동작은 상대 스켈레톤({rig})의 동작이어야 합니다.', {rig: familyLabel(partnerRig(pair))});

/** The settings (＋ 설정 ids) and the items (＋ 기능 and context add kinds) a creature card is not offered: the
 *  runtime refuses them on a creature's action (XmlV2). */
export const creatureHiddenSettings: readonly string[] = ['view', 'otherView', 'air', 'attack'];
export const creatureHiddenAdds: readonly string[] = [
  'qte',
  'cameraRestore',
  'carryRelease',
  'notify:hide',
  'notify:show',
  'notify:fireArrow',
  'carry',
];

/** The character-only parts a creature card holds (they stay when its HKX moves to a creature's folder, until
 *  removed): their names, for the card's problem. */
export function creatureLimits(w: Workspace, a: Action): string[] {
  if (!isCreatureRig(actionRig(a))) return [];
  const p = a.config,
    out: string[] = [];
  // A creature-started pair carries no one (runtime XmlV2).
  if (a.pair?.carry) out.push(tr('운반'));
  if (actionView(w, a) !== 'third') out.push(tr('인칭'));
  if (a.otherView) out.push(t('row.otherView'));
  if (p.air !== 'deny') out.push(tr('공중'));
  if (p.attack || p.steps.some(s => s.attack)) out.push(tr('공격 데이터'));
  if (w.qtes?.some(q => q.owner === a.uid)) out.push('QTE');
  if (a.cameraEnabled) out.push(tr('카메라 복구'));
  if (p.carryRelease) out.push(tr('대상 놓기'));
  if (w.actions.some(x => x.pair?.carry?.putdownAction === a.uid)) out.push(tr('운반의 내려놓기 동작'));
  const ops = new Set((p.effects ?? []).map(e => e.values.op));
  if (ops.has('hide')) out.push(tr('무기 숨김'));
  if (ops.has('show')) out.push(tr('무기 표시'));
  if (ops.has('fireArrow')) out.push(tr('활 발사'));
  return out;
}
/** The rigs a pair HKX's role fits (src-tauri hkx_meta pairRigs: built-in skeleton paths), by their previewSkeleton;
 *  a skeleton no rig previews (the first-person and female characters) is left out. */
export const rigsOfSkeletons = (paths: readonly string[]): PairedRig[] =>
  paths.flatMap(path => pairedRigs.filter(r => r.previewSkeleton === path).map(r => r.id));

/** A pair role from its HKX: `rig` = the one to keep or set (the current one when it fits, else the HKX's when its
 *  rigs are one skeleton family), `choices` = one rig per family when the HKX cannot tell them apart (giant and
 *  lurker share their bone names), for the user to pick. Neither when the HKX said nothing. */
export function resolvePairRole(candidates: readonly PairedRig[], current: PairedRig) {
  const families: PairedRig[] = [];
  for (const rig of candidates) if (!families.some(f => sameFamily(f, rig))) families.push(rig);
  const choices = families.length > 1 ? families : [];
  if (!candidates.length) return {rig: undefined, choices};
  if (candidates.includes(current) || (families.length === 1 && sameFamily(families[0], current)))
    return {rig: current, choices};
  return {rig: families.length === 1 ? families[0] : undefined, choices};
}
