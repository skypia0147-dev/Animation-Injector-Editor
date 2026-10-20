// Recent documents (user preference, not part of the project): XML and templates. Entries of the retired .aiproj
// (10-03) are dropped when the list is read and written back without them.
export type RecentFile = {path: string; name: string; time: number};
const KEY = 'aieditor-recent';
const LIMIT = 8;
const opens = (path: string) => /\.(xml|aitemplate)$/i.test(path);

export function getRecent(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    const kept = list.filter(r => r && typeof r.path === 'string' && typeof r.name === 'string' && opens(r.path));
    if (kept.length !== list.length) localStorage.setItem(KEY, JSON.stringify(kept));
    return kept.slice(0, LIMIT);
  } catch {
    return [];
  }
}
export function addRecent(path: string, name: string): RecentFile[] {
  if (!path || !opens(path)) return getRecent();
  const list = [{path, name, time: Date.now()}, ...getRecent().filter(r => r.path !== path)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Preference storage is optional. */
  }
  return list;
}
export function removeRecent(path: string): RecentFile[] {
  const list = getRecent().filter(r => r.path !== path);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Preference storage is optional. */
  }
  return list;
}
