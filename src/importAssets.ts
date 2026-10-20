import type {Workspace} from './workspace.ts';
import {assetLibrary} from './assets.ts';
import {assetKey, selectAsset} from './package.ts';

type Resolved = {path: string; clip: string; error: string};

/** Resolve only files belonging to the XML's mod, never another mod's replacement. */
export async function connectXmlAssets(
  workspace: Workspace,
  xmlPath: string,
  resolve: (paths: string[]) => Promise<Resolved[]>
): Promise<{workspace: Workspace; connected: number; missing: number}> {
  const normalized = xmlPath.replaceAll('\\', '/');
  const root = /^([a-z]:\/.*?)\/SKSE\/Plugins\/AnimationInjector\/(?:[^/]+\/)*[^/]+\.xml$/i.exec(normalized)?.[1];
  const result = {workspace, connected: 0, missing: 0};
  if (!root || normalized.split('/').some(part => part === '..' || part === '.')) return result;
  const candidates = assetLibrary(workspace)
    .filter(asset => !asset.localPath)
    .map(asset => {
      const clip = asset.clip.replaceAll('\\', '/');
      const safe =
        !/[<>:"|?*\x00-\x1f]/.test(clip) &&
        /\.hkx$/i.test(clip) &&
        clip.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
      return {clip: asset.clip, path: safe ? `${root}/meshes/actors/character/${clip}`.replaceAll('/', '\\') : ''};
    });
  result.missing = candidates.length;
  const safe = candidates.filter(candidate => candidate.path);
  for (let offset = 0; offset < safe.length; offset += 100) {
    const batch = safe.slice(offset, offset + 100);
    let resolved: Resolved[];
    try {
      resolved = await resolve(batch.map(candidate => candidate.path));
    } catch {
      continue;
    }
    for (const candidate of batch) {
      const found = resolved.find(
        item =>
          !item.error &&
          assetKey(item.path) === assetKey(candidate.path) &&
          assetKey(item.clip) === assetKey(candidate.clip)
      );
      if (!found) continue;
      result.workspace = selectAsset(result.workspace, candidate.clip, found.path);
      result.connected++;
      result.missing--;
    }
  }
  return result;
}
