// A pair's facing comes from its HKX (10-16): the engine turns a pair's two to face each other at the start
// (Advanced reorientSupport), which a pair played from behind must not do. The HKX's first frame tells which
// (src-tauri hkx::viewer::pair_start_facing): the two face each other, or one stands behind the other.
import {invoke, isTauri} from '../backend.ts';
import type {Workspace} from '../workspace.ts';
import {assetKey} from '../package.ts';
import {renderedLibrary} from './renderCache.ts';

export type Facing = 'front' | 'back';
// Local HKX path -> its pair facing (null: not a pair, or unreadable). Read once per path and session.
const cache = new Map<string, Facing | null>();
async function facingOf(path: string): Promise<Facing | null> {
  if (!cache.has(path))
    cache.set(
      path,
      await invoke<{pairFacing?: Facing}>('hkx_meta', {path})
        .then(r => r.pairFacing ?? null)
        .catch(() => null)
    );
  return cache.get(path)!;
}

/** Each pair action's local HKX (its entry clip), for the actions whose file is found on disk. */
export function pairSources(w: Workspace): {action: string; path: string}[] {
  const local = new Map(renderedLibrary(w).map(e => [assetKey(e.clip), e.localPath]));
  return w.actions.flatMap(a => {
    if (!a.pair) return [];
    const step = a.config.steps.find(s => s.id === a.config.entry) ?? a.config.steps[0];
    const path = step ? step.localPath || local.get(assetKey(step.clip)) || '' : '';
    return path ? [{action: a.uid, path}] : [];
  });
}

/** The pairs whose stored facing differs from what their HKX says: action uid -> reorientSupport. A file that
 *  cannot be read leaves its pair as it is. Desktop only. */
export async function facingChanges(w: Workspace): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!isTauri()) return out;
  for (const {action, path} of pairSources(w)) {
    const facing = await facingOf(path);
    const a = w.actions.find(x => x.uid === action);
    if (facing && a?.pair && a.pair.reorientSupport !== (facing === 'front')) out.set(action, facing === 'front');
  }
  return out;
}

/** The document with those facings set (a copy; the actions not named are shared). */
export function withFacings(w: Workspace, changes: Map<string, boolean>): Workspace {
  if (!changes.size) return w;
  return {
    ...w,
    actions: w.actions.map(a =>
      a.pair && changes.has(a.uid) ? {...a, pair: {...a.pair, reorientSupport: changes.get(a.uid)!}} : a
    ),
  };
}
