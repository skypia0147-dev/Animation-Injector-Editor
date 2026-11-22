import type {Workspace} from './workspace.ts';
import {assetLibrary} from './assets.ts';
import {assetKey, selectAsset, selectSound, soundLibrary, unregisterSound} from './package.ts';
import {clipRoot} from './creatureRig.ts';
import {allTreeFiles} from './locomotion.ts';

type Resolved = {path: string; clip: string; error: string};

/** Resolve only files belonging to the XML's mod, never another mod's replacement. A source remembered on this
 *  computer whose file is gone (`exists`: its mod folder renamed or moved, 10-22) is looked for there too: kept, it
 *  pointed at nothing and the HKX could not play. `stale` counts those. */
export async function connectXmlAssets(
  workspace: Workspace,
  xmlPath: string,
  resolve: (paths: string[]) => Promise<Resolved[]>,
  exists?: (paths: string[]) => Promise<boolean[]>
): Promise<{
  workspace: Workspace;
  connected: number;
  missing: number;
  stale: number;
  sounds: {connected: number; missing: number; stale: number; folded: number};
}> {
  const root = modRoot(xmlPath);
  const result = {
    workspace,
    connected: 0,
    missing: 0,
    stale: 0,
    sounds: {connected: 0, missing: 0, stale: 0, folded: 0},
  };
  if (!root) return result;
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
      // A creature's clip is relative to its actor folder (creatureRig.ts).
      const owner = result.workspace.actions.find(a =>
        a.config.steps.some(s => assetKey(s.clip) === assetKey(asset.clip))
      );
      const folder = owner ? clipRoot(owner) : 'meshes/actors/character';
      return {clip: asset.clip, path: safe ? `${root}/${folder}/${clip}`.replaceAll('/', '\\') : ''};
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
  // <Tree use="own">: the own trees' files the mod holds join the library. One that is not there is not missing: the
  // runtime plays the source kind's file in its place.
  const axes = allTreeFiles(result.workspace)
    .filter(file => !file.localPath)
    .map(file => ({clip: file.clip, path: `${root}/meshes/actors/character/${file.clip}`.replaceAll('/', '\\')}));
  if (axes.length) {
    try {
      const resolved = await resolve(axes.map(file => file.path));
      for (const file of axes) {
        const found = resolved.find(
          item =>
            !item.error && assetKey(item.path) === assetKey(file.path) && assetKey(item.clip) === assetKey(file.clip)
        );
        if (!found) continue;
        result.workspace = selectAsset(result.workspace, file.clip, found.path);
        result.connected++;
      }
    } catch {
      /* Without the lookup the files are registered from the card. */
    }
  }
  if (exists) {
    const sounds = await connectXmlSounds(result.workspace, root, exists);
    result.workspace = sounds.workspace;
    result.sounds = {
      connected: sounds.connected,
      missing: sounds.missing,
      stale: sounds.stale,
      folded: sounds.folded,
    };
  }
  return result;
}

/** The mod folder an XML in it belongs to (`<mod>\SKSE\Plugins\AnimationInjector\…\<name>.xml`, forward slashes),
 *  or '' when the path is not one. */
export function modRoot(xmlPath: string): string {
  const normalized = xmlPath.replaceAll('\\', '/');
  if (normalized.split('/').some(part => part === '..' || part === '.')) return '';
  return /^([a-z]:\/.*?)\/SKSE\/Plugins\/AnimationInjector\/(?:[^/]+\/)*[^/]+\.xml$/i.exec(normalized)?.[1] ?? '';
}
/** The folder whose sound files the app lists beside the project (package.ts FolderSound), or '' for none. An XML in
 *  the game's Data folder (a mod manager that installs there) has every installed mod's sounds beside it, which are
 *  not this mod's to list or package. */
export function soundFolder(xmlPath: string): string {
  const root = modRoot(xmlPath);
  return root && root.split('/').pop()!.toLowerCase() !== 'data' ? root : '';
}

/** The sound files the functions play, found beside the XML as the mod holds them (`<mod>\<file>`, the path the
 *  package writes): a remembered source whose file is gone is looked for there too. The mod folder's other sounds are
 *  listed by the app instead of saved (package.ts FolderSound); an unused one an earlier editor saved in the library
 *  is taken out of it (`folded`). */
async function connectXmlSounds(workspace: Workspace, root: string, exists: (paths: string[]) => Promise<boolean[]>) {
  const result = {workspace, connected: 0, missing: 0, stale: 0, folded: 0};
  const ask = async (paths: string[]) => {
    const out: boolean[] = [];
    for (let offset = 0; offset < paths.length; offset += 200)
      out.push(...(await exists(paths.slice(offset, offset + 200))));
    return out;
  };
  // `<mod>\<file>`, or '' for a file name that cannot be one.
  const beside = (name: string) => {
    const file = name.replaceAll('\\', '/');
    const safe =
      /\.(wav|xwm)$/i.test(file) &&
      !/[<>:"|?*\x00-\x1f]/.test(file) &&
      file.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
    return safe ? `${root}/${file}`.replaceAll('/', '\\') : '';
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
  // From 10-26 every sound of the mod folder was saved in the library: one no function plays that the folder holds is
  // the folder's, listed again by the app. In a Data folder that was up to 500 of every installed mod's sounds.
  const unused = soundLibrary(result.workspace)
    .filter(s => s.registered && !s.actions.length && !s.events.length)
    .map(s => ({file: s.file, path: beside(s.file)}))
    .filter(s => s.path);
  if (unused.length)
    try {
      const there = await ask(unused.map(s => s.path));
      unused.forEach((s, i) => {
        if (!there[i]) return;
        result.workspace = unregisterSound(result.workspace, s.file);
        result.folded++;
      });
    } catch {
      /* Without the check the library is left as it was. */
    }
  const candidates = soundLibrary(result.workspace)
    .filter(s => !s.localPath)
    .map(s => ({file: s.file, path: beside(s.file)}));
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
