/** Local file paths stay on this computer (2026-10-19).
 *
 * The XML a document saves carries the whole project in its editor block (editorBlock.ts), and that XML is what a
 * mod author ships: the plugin reads it from the mod folder. Absolute paths in the project (HKX sources, search
 * folders, preview skeletons and skins) would publish the author's drives and folder names, so the block holds
 * none. Saving sets each absolute path to '' and keeps it here, under the hash of the project as written; opening
 * that block on this computer puts them back. On another computer the paths stay empty and the HKX beside the XML
 * are found again from its mod folder (importAssets.ts connectXmlAssets).
 *
 * The walk is generic (every string that is an absolute local path), so a new field holding a path is covered
 * without a list to keep up to date. */
import {bodyHash} from './editorBlock.ts';

const STORE_KEY = 'aieditor-localpaths-v1';
const KEEP = 64;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/;

type Entry = {key: string; at: number; paths: Record<string, string>};

const escape = (part: string) => part.replaceAll('~', '~0').replaceAll('/', '~1');

/** The project with every absolute path emptied, and those paths by JSON pointer. */
export function splitLocalPaths(project: unknown): {shared: unknown; local: Record<string, string>} {
  const local: Record<string, string> = {};
  const walk = (value: unknown, pointer: string): unknown => {
    if (typeof value === 'string') {
      if (!ABSOLUTE.test(value)) return value;
      local[pointer] = value;
      return '';
    }
    if (Array.isArray(value)) return value.map((item, i) => walk(item, pointer + '/' + i));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, pointer + '/' + escape(k))]));
    return value;
  };
  return {shared: walk(project, ''), local};
}

/** Puts paths back where splitLocalPaths took them, only into the empty strings it left. */
export function joinLocalPaths(project: unknown, local: Record<string, string>): unknown {
  for (const [pointer, path] of Object.entries(local)) {
    const parts = pointer
      .split('/')
      .slice(1)
      .map(p => p.replaceAll('~1', '/').replaceAll('~0', '~'));
    const last = parts.pop();
    let at: unknown = project;
    for (const part of parts) at = at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined;
    if (last === undefined || !at || typeof at !== 'object') continue;
    const holder = at as Record<string, unknown>;
    if (holder[last] === '') holder[last] = path;
  }
  return project;
}

function readStore(): Entry[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** The project text to write into the block; its paths are remembered on this computer. */
export function shareableProject(project: string): string {
  const {shared, local} = splitLocalPaths(JSON.parse(project));
  const text = JSON.stringify(shared);
  if (Object.keys(local).length) {
    const key = bodyHash(text);
    const entries = [{key, at: Date.now(), paths: local}, ...readStore().filter(e => e.key !== key)].slice(0, KEEP);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    } catch {
      /* Without local storage the paths are chosen again after reopening. */
    }
  }
  return text;
}

/** The project text of an opened block with this computer's paths put back (unchanged when none are known). */
export function localProject(project: string): string {
  const entry = readStore().find(e => e.key === bodyHash(project));
  return entry ? JSON.stringify(joinLocalPaths(JSON.parse(project), entry.paths)) : project;
}
