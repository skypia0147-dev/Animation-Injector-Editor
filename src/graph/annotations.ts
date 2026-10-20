import {useEffect, useMemo, useState} from 'react';
import {invoke, isTauri} from '../backend.ts';
import type {Meta} from '../timeline/model.ts';
import type {Workspace} from '../workspace.ts';
import {renderedLibrary} from './renderCache.ts';
import {tr} from '../i18n/korean.ts';

/** An event a clip sends: its HKX annotation text and time (seconds). */
export type Annotation = {time: number; text: string};
// Local HKX path -> its annotations (null: could not be read). Read once per path and session.
const cache = new Map<string, Annotation[] | null>();
const pending = new Map<string, Promise<void>>();
function load(path: string): Promise<void> {
  let p = pending.get(path);
  if (!p) {
    p = invoke<{animations: Meta[]}>('hkx_meta', {path})
      .then(result => {
        const seen = new Set<string>(),
          list: Annotation[] = [];
        for (const a of result.animations)
          for (const n of a.annotations) {
            const key = n.time + '\u0000' + n.text;
            if (seen.has(key)) continue;
            seen.add(key);
            list.push({time: n.time, text: n.text});
          }
        cache.set(
          path,
          list.sort((a, b) => a.time - b.time)
        );
      })
      .catch(() => void cache.set(path, null));
    pending.set(path, p);
  }
  return p;
}
export const clipKey = (clip: string) => clip.replaceAll('/', '\\').toLowerCase();
/** Clip path (clipKey) -> its HKX annotations, for every clip with a local source (desktop only).
 *  A clip without a readable source is missing from the map. */
export function useClipAnnotations(w: Workspace): Map<string, Annotation[]> {
  const paths = useMemo(() => {
    const out = new Map<string, string>();
    for (const e of renderedLibrary(w)) if (e.localPath) out.set(clipKey(e.clip), e.localPath);
    return out;
  }, [w]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!isTauri()) return;
    const missing = [...new Set(paths.values())].filter(p => !cache.has(p));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(load)).then(() => {
      if (!cancelled) setRevision(r => r + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [paths]);
  return useMemo(() => {
    const out = new Map<string, Annotation[]>();
    for (const [clip, path] of paths) {
      const list = cache.get(path);
      if (list) out.set(clip, list);
    }
    return out;
    // `revision` changes when a read finishes.
  }, [paths, revision]);
}
/** The event an annotation sends: its name ("name|values" payloads send the name), the values, and in a
 *  paired clip the actor that sends it ("NPC" prefix: the initiator, "2_": the receiver). */
export type SentEvent = {name: string; values: string; role?: 'initiator' | 'receiver'};
export const roleLabel = {
  get initiator() {
    return tr('가해자');
  },
  get receiver() {
    return tr('피해자');
  },
} as const;
/** Which of a paired clip's two actors send `event` ('self' the initiator, 'partner' the receiver: "2_" prefixed).
 *  A QTE started by that event listens to its sender (runtime eventSource, 10-19: a victim's event never opened a
 *  QTE listening to the attacker). */
export function eventSenders(list: Annotation[], event: string): Set<'self' | 'partner'> {
  const out = new Set<'self' | 'partner'>();
  for (const n of list) {
    const e = sentEvent(n.text, true);
    if (e?.name === event) out.add(e.role === 'receiver' ? 'partner' : 'self');
  }
  return out;
}
/** undefined for annotations that are not events: AMR root motion data (animmotion, animrotation). */
export function sentEvent(text: string, pair: boolean): SentEvent | undefined {
  let body = text,
    role: SentEvent['role'];
  if (pair && body.startsWith('2_')) {
    role = 'receiver';
    body = body.slice(2);
  } else if (pair && body.startsWith('NPC')) {
    role = 'initiator';
    body = body.slice(3);
  }
  if (/^anim(motion|rotation)\b/i.test(body)) return undefined;
  const bar = body.indexOf('|');
  return {name: bar < 0 ? body : body.slice(0, bar), values: bar < 0 ? '' : body.slice(bar + 1), role};
}
