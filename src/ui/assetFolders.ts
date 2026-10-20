import type {LibraryEntry} from '../assets.ts';

export type AssetFolder = {key: string; name: string; folders: AssetFolder[]; files: LibraryEntry[]; count: number};

export function assetFolders(entries: LibraryEntry[]): AssetFolder {
  const root: AssetFolder = {key: '', name: 'HKX', folders: [], files: [], count: 0};
  for (const entry of entries) {
    const parts = entry.clip.replaceAll('\\', '/').split('/').filter(Boolean);
    parts.pop();
    // The HKX library already denotes the animation root.
    if (parts[0]?.toLowerCase() === 'animations') parts.shift();
    let folder = root;
    folder.count++;
    for (const name of parts) {
      const key = folder.key + '/' + name.toLowerCase();
      let child = folder.folders.find(f => f.key === key);
      if (!child) {
        child = {key, name, folders: [], files: [], count: 0};
        folder.folders.push(child);
      }
      child.count++;
      folder = child;
    }
    folder.files.push(entry);
  }
  const sort = (f: AssetFolder) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    f.files.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}
