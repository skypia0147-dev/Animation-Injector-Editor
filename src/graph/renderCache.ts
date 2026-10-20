// Read-only views of the rendered workspace, computed once per workspace object. The app shell and every
// card ask for the same views of the same document in one render (the flat graph twice, the registry once
// per card). Only for the rendered document: it is never changed in place (edit() changes a clone), so a
// cached view cannot go stale. Editing code keeps calling the functions themselves.
// A new view keeps the parts equal to the previous one's (shareUnchanged), like the document itself: a
// card or row whose inputs did not change sees the same objects and skips its render.
import type {Workspace} from '../workspace.ts';
import {getLanguage} from '../i18n/index.ts';
import {flatGraph} from './flat.ts';
import {checklistModel} from './checklist.ts';
import {registryEntries} from '../eventRegistry.ts';
import {assetLibrary} from '../assets.ts';
import {shareUnchanged} from './historySharing.ts';

const views = new WeakMap<Workspace, Map<string, unknown>>();
function once<T>(w: Workspace, key: string, make: () => T): T {
  let map = views.get(w);
  if (!map) views.set(w, (map = new Map()));
  if (!map.has(key)) map.set(key, make());
  return map.get(key) as T;
}
const latest = new Map<string, unknown>();
/** `value`, with the parts equal to the latest view of the same key kept as those objects. Plain records only
 *  (shareUnchanged sees no Map or Set contents). */
function sharedWith<T>(key: string, value: T): T {
  const previous = latest.get(key) as T | undefined;
  const result = previous === undefined ? value : shareUnchanged(previous, value);
  latest.set(key, result);
  return result;
}
type Model = ReturnType<typeof checklistModel>;
const latestModels = new Map<string, Model>();
// Titles and summaries are translated: one view per language.
export const renderedFlatGraph = (w: Workspace) =>
  once(w, 'flat:' + getLanguage(), () => sharedWith('flat:' + getLanguage(), flatGraph(w)));
export const renderedChecklist = (w: Workspace) =>
  once(w, 'checklist:' + getLanguage(), () => {
    const model = checklistModel(w, renderedFlatGraph(w)),
      previous = latestModels.get(getLanguage());
    // The card items per node (Maps hold them): an unchanged card's list stays the same array.
    if (previous)
      for (const [id, items] of model.items) {
        const old = previous.items.get(id);
        if (old) model.items.set(id, shareUnchanged(old, items));
      }
    latestModels.set(getLanguage(), model);
    return model;
  });
export const renderedRegistry = (w: Workspace) => once(w, 'registry', () => sharedWith('registry', registryEntries(w)));
export const renderedLibrary = (w: Workspace) => once(w, 'library', () => sharedWith('library', assetLibrary(w)));
