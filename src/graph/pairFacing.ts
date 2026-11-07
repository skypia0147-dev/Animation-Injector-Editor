// What a pair's HKX tells about the pair (10-16, 11-05): read from the HKX, never a checkbox or a guess.
// - Its facing: the engine turns a pair's two to face each other at the start (Advanced reorientSupport), which a pair
//   played from behind must not do. The HKX's first frame tells which (src-tauri hkx::viewer::pair_start_facing).
// - Its two roles' skeletons (runtime 1.1.0 <Pair rig>, FindPartner rig): both roles read the one paired HKX from the
//   character's folder, so its folder cannot tell them, but its track names do (A1 unprefixed, A2 "2_";
//   hkx::viewer::pair_rigs, 105 vanilla pairs right). Skeletons sharing their bone names (giant and lurker) are left
//   for the user to pick (creatureRig.ts resolvePairRole).
import {useSyncExternalStore} from 'react';
import {invoke, isTauri} from '../backend.ts';
import type {Action, Workspace} from '../workspace.ts';
import {assetKey} from '../package.ts';
import {renderedLibrary} from './renderCache.ts';
import type {PairedRig} from '../pairedRigs.ts';
import {partnerRig, actionRig, resolvePairRole, rigsOfSkeletons, withRig} from '../creatureRig.ts';

export type Facing = 'front' | 'back';
export type PairInfo = {facing: Facing | null; rigs: [PairedRig[], PairedRig[]] | null};
// Local HKX path -> what it tells (null rigs: not a pair, unreadable, or a build without built-in skeletons). Read
// once per path and session; the cards listen to it (usePairInfo).
const cache = new Map<string, PairInfo>();
const listeners = new Set<() => void>();
async function infoOf(path: string): Promise<PairInfo> {
  if (!cache.has(path)) {
    const info = await invoke<{pairFacing?: Facing; pairRigs?: [string[], string[]]}>('hkx_meta', {path})
      .then(r => ({
        facing: r.pairFacing ?? null,
        rigs: r.pairRigs
          ? ([rigsOfSkeletons(r.pairRigs[0]), rigsOfSkeletons(r.pairRigs[1])] as [PairedRig[], PairedRig[]])
          : null,
      }))
      .catch(() => ({facing: null, rigs: null}));
    cache.set(path, info);
    for (const listen of listeners) listen();
  }
  return cache.get(path)!;
}
const subscribe = (listen: () => void) => {
  listeners.add(listen);
  return () => listeners.delete(listen);
};
/** What this pair's HKX tells, once read (undefined before, or without a local HKX). */
export function usePairInfo(path: string): PairInfo | undefined {
  return useSyncExternalStore(subscribe, () => (path ? cache.get(path) : undefined));
}

/** A pair action's local HKX (its entry clip), or '' when its file is not found on disk. */
export function pairSourcePath(w: Workspace, a: Action): string {
  if (!a.pair) return '';
  const step = a.config.steps.find(s => s.id === a.config.entry) ?? a.config.steps[0];
  if (!step) return '';
  return step.localPath || renderedLibrary(w).find(e => assetKey(e.clip) === assetKey(step.clip))?.localPath || '';
}
/** Each pair action's local HKX, for the actions whose file is found on disk. */
export function pairSources(w: Workspace): {action: string; path: string}[] {
  return w.actions.flatMap(a => {
    const path = pairSourcePath(w, a);
    return path ? [{action: a.uid, path}] : [];
  });
}

export type PairChange = {reorientSupport?: boolean; rig?: PairedRig; targetRig?: PairedRig};
/** The pairs whose stored facing or skeletons differ from what their HKX says. A file that cannot be read, and a
 *  role whose skeletons the HKX cannot tell apart, leave the pair as it is. Desktop only. */
export async function pairChanges(w: Workspace): Promise<Map<string, PairChange>> {
  const out = new Map<string, PairChange>();
  if (!isTauri()) return out;
  for (const {action, path} of pairSources(w)) {
    const info = await infoOf(path);
    const a = w.actions.find(x => x.uid === action);
    if (!a?.pair) continue;
    const change: PairChange = {};
    if (info.facing && a.pair.reorientSupport !== (info.facing === 'front'))
      change.reorientSupport = info.facing === 'front';
    if (info.rigs) {
      const initiator = resolvePairRole(info.rigs[0], actionRig(a)).rig,
        partner = resolvePairRole(info.rigs[1], partnerRig(a)).rig;
      if (initiator && initiator !== actionRig(a)) change.rig = initiator;
      if (partner && partner !== partnerRig(a)) change.targetRig = partner;
    }
    if (Object.keys(change).length) out.set(action, change);
  }
  return out;
}

/** The document with those changes (a copy; the actions not named are shared). */
export function withPairChanges(w: Workspace, changes: Map<string, PairChange>): Workspace {
  if (!changes.size) return w;
  return {
    ...w,
    actions: w.actions.map(a => {
      const c = changes.get(a.uid);
      if (!a.pair || !c) return a;
      let next: Action = {...a, pair: {...a.pair}};
      if (c.reorientSupport !== undefined) next.pair!.reorientSupport = c.reorientSupport;
      if (c.targetRig) next.pair!.targetRig = c.targetRig;
      if (c.rig) next = {...next, config: withRig(a.config, c.rig)};
      return next;
    }),
  };
}
