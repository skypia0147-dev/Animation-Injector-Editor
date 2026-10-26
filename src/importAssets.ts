import type {Workspace} from './workspace.ts';
import {assetLibrary} from './assets.ts';
import {assetKey, selectAsset, selectSound, soundLibrary} from './package.ts';

type Resolved = {path: string; clip: string; error: string};

/** Resolve only files belonging to the XML's mod, never another mod's replacement. A source remembered on this
 *  computer whose file is gone (`exists`: its mod folder renamed or moved, 10-22) is looked for there too: kept, it
 *  pointed at nothing and the HKX could not play. `stale` counts those. */
export async function connectXmlAssets(
  workspace: Workspace,
  xmlPath: string,
  resolve: (paths: string[]) => Promise<Resolved[]>,
  exists?: (paths: string[]) => Promise<boolean[]>,
  modSounds?: (root: string) => Promise<{path: string; file: string}[]>
): Promise<{
  workspace: Workspace;
  connected: number;
  missing: number;
  stale: number;
  sounds: {connected: number; missing: number; stale: number};
}> {
  const normalized = xmlPath.replaceAll('\\', '/');
  const root = /^([a-z]:\/.*?)\/SKSE\/Plugins\/AnimationInjector\/(?:[^/]+\/)*[^/]+\.xml$/i.exec(normalized)?.[1];
  const result = {workspace, connected: 0, missing: 0, stale: 0, sounds: {connected: 0, missing: 0, stale: 0}};
  if (!root || normalized.split('/').some(part => part === '..' || part === '.')) return result;
  const remembered = exists ? assetLibrary(workspace).filter(asset => asset.localPath) : [];
  for (let offset = 0; offset < remembered.length; offset += 200) {
    const batch = remembered.slice(offset, offset + 200);
    let there: boolean[];
    try {
      there = await exists!(batch.map(asset => asset.localPath));
    } catch {
      continue;
    }
    batch.forEach((asset, i) => {
      if (there[i] !== false) return;
      result.workspace = selectAsset(result.workspace, asset.clip, '');
      result.stale++;
    });
  }
  const candidates = assetLibrary(result.workspace)
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
  if (exists) {
    const sounds = await connectXmlSounds(result.workspace, root, exists, modSounds);
    result.workspace = sounds.workspace;
    result.sounds = {connected: sounds.connected, missing: sounds.missing, stale: sounds.stale};
  }
  return result;
}

/** The sound files the functions play, found beside the XML as the mod holds them (`<mod>\<file>`, the path the
 *  package writes): a remembered source whose file is gone is looked for there too. */
async function connectXmlSounds(
  workspace: Workspace,
  root: string,
  exists: (paths: string[]) => Promise<boolean[]>,
  modSounds?: (root: string) => Promise<{path: string; file: string}[]>
) {
  const result = {workspace, connected: 0, missing: 0, stale: 0};
  const ask = async (paths: string[]) => {
    const out: boolean[] = [];
    for (let offset = 0; offset < paths.length; offset += 200)
      out.push(...(await exists(paths.slice(offset, offset + 200))));
    return out;
  };
  const remembered = soundLibrary(workspace).filter(s => s.localPath);
  if (remembered.length) {
    try {
      const there = await ask(remembered.map(s => s.localPath));
      remembered.forEach((s, i) => {
        if (there[i] !== false) return;
        result.workspace = selectSound(result.workspace, s.file, '');
        result.stale++;
      });
    } catch {
      /* Without the check a remembered path is left alone. */
    }
  }
  // Every sound the mod folder holds joins the library (10-26): its plugin may play it from an HKX SoundPlay
  // annotation, which the XML never names, and the package must keep it.
  if (modSounds) {
    let held: {path: string; file: string}[] = [];
    try {
      held = await modSounds(root);
    } catch {
      /* Without the listing only the sounds the functions play are looked for. */
    }
    const library = new Map(soundLibrary(result.workspace).map(s => [assetKey(s.file), s]));
    for (const h of held) {
      const known = library.get(assetKey(h.file));
      if (known?.localPath) continue;
      result.workspace = selectSound(result.workspace, known?.file ?? h.file, h.path);
      result.connected++;
    }
  }
  const candidates = soundLibrary(result.workspace)
    .filter(s => !s.localPath)
    .map(s => {
      const file = s.file.replaceAll('\\', '/');
      const safe =
        /\.(wav|xwm)$/i.test(file) &&
        !/[<>:"|?*\x00-\x1f]/.test(file) &&
        file.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
      return {file: s.file, path: safe ? `${root}/${file}`.replaceAll('/', '\\') : ''};
    });
  result.missing = candidates.length;
  const safe = candidates.filter(c => c.path);
  if (!safe.length) return result;
  let there: boolean[];
  try {
    there = await ask(safe.map(c => c.path));
  } catch {
    return result;
  }
  safe.forEach((c, i) => {
    if (!there[i]) return;
    result.workspace = selectSound(result.workspace, c.file, c.path);
    result.connected++;
    result.missing--;
  });
  return result;
}
