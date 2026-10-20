import {useEffect, useState} from 'react';
import {invoke, isTauri} from '../backend.ts';
import type {Meta} from './model.ts';
import {t} from '../i18n/index.ts';
/** Length of a local HKX's first animation (desktop only); undefined when it cannot be read. */
export async function clipSeconds(path: string): Promise<number | undefined> {
  if (!path || !isTauri()) return undefined;
  try {
    const result = await invoke<{animations: Meta[]}>('hkx_meta', {path});
    return result.animations[0]?.duration;
  } catch {
    return undefined;
  }
}
export function useMetadata(path: string, revision = 0) {
  const [state, set] = useState<{path: string; data?: Meta[]; error?: string; loading?: boolean}>({path: ''});
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      set({path, error: t('timeline.noSource')});
      return;
    }
    if (!isTauri()) {
      set({path, error: t('timeline.desktopMeta')});
      return;
    }
    set({path, loading: true});
    invoke<{animations: Meta[]}>('hkx_meta', {path})
      .then(result => {
        if (!cancelled) set({path, data: result.animations});
      })
      .catch(e => {
        if (!cancelled) set({path, error: String(e)});
      });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);
  return state.path === path ? state : {path, loading: true};
}
