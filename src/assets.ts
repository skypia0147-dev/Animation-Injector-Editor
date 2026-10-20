// HKX asset library: what the HKX browser shows and how drag & drop registers files.
import {clone} from './model.ts';
import type {PreviewAssets, Workspace} from './workspace.ts';
import {assetKey} from './package.ts';
import {stepFiles} from './view.ts';
import {tr} from './i18n/korean.ts';

export type LibraryEntry = {
  clip: string;
  name: string;
  localPath: string;
  preview: PreviewAssets;
  /** uids of states whose clips reference this file */
  users: string[];
  /** true when the file was registered explicitly (drag & drop / add), not only referenced by a state */
  registered: boolean;
};

/** Registered assets ∪ files the states need (a first-person action's _1stPerson copy, view.ts), one
 *  entry per relative path (case-insensitive). */
export function assetLibrary(w: Workspace): LibraryEntry[] {
  const map = new Map<string, LibraryEntry>();
  const entry = (clip: string) => {
    const key = assetKey(clip);
    let e = map.get(key);
    if (!e) {
      e = {
        clip,
        name: clip.split(/[\\/]/).at(-1) || clip,
        localPath: '',
        preview: {skeletons: [], skins: []},
        users: [],
        registered: false,
      };
      map.set(key, e);
    }
    return e;
  };
  // States first so the displayed spelling follows the clip a state actually references.
  for (const a of w.actions)
    for (const s of a.config.steps)
      for (const file of stepFiles(w, a, s)) {
        if (!file.clip) continue;
        const e = entry(file.clip);
        if (!e.users.includes(a.uid)) e.users.push(a.uid);
        if (!file.firstPerson && !e.localPath && s.localPath) e.localPath = s.localPath;
      }
  for (const a of w.assets) {
    const e = entry(a.clip);
    e.registered = true;
    if (a.localPath) e.localPath = a.localPath;
    e.preview = clone(a.preview);
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** Add or update library entries. States that reference the same clip without a source path pick it up. */
export function registerAssets(w: Workspace, items: {clip: string; path: string}[]): Workspace {
  const next = clone(w);
  for (const item of items) {
    if (!item.clip) continue;
    const key = assetKey(item.clip);
    const existing = next.assets.find(a => assetKey(a.clip) === key);
    if (existing) {
      if (item.path) existing.localPath = item.path;
    } else next.assets.push({clip: item.clip, localPath: item.path, preview: {skeletons: [], skins: []}});
    if (item.path)
      for (const a of next.actions)
        for (const s of a.config.steps) if (assetKey(s.clip) === key && !s.localPath) s.localPath = item.path;
  }
  if (next.assets.length > 500) throw new Error(tr('에셋은 500개까지 등록할 수 있습니다.'));
  return next;
}

/** Drop on a state: the state's first clip becomes this file (single/pair replace, others replace the entry clip). */
export function assignClip(w: Workspace, uid: string, clip: string, path: string): Workspace {
  const next = registerAssets(w, [{clip, path}]);
  const a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾을 수 없습니다.'));
  const target = a.config.steps.find(s => s.id === a.config.entry) ?? a.config.steps[0];
  if (!target) throw new Error(tr('클립이 없는 동작입니다.'));
  target.clip = clip;
  target.localPath = path;
  return next;
}

/** Remove a registered entry. Entries still referenced by a state only lose their registration flag. */
export function unregisterAsset(w: Workspace, clip: string): Workspace {
  const next = clone(w);
  next.assets = next.assets.filter(a => assetKey(a.clip) !== assetKey(clip));
  return next;
}
