import {pairedRig} from './pairedRigs.ts';
import type {Workspace} from './workspace.ts';
import {compileWorkspace} from './workspace.ts';
import {clipEffects} from './clipEffects.ts';
import {t} from './i18n/index.ts';
import {tr} from './i18n/korean.ts';
import {isFirstPersonClip, stepFiles} from './view.ts';
import {ragdollWrites} from './ragdoll.ts';
import {actionRig, clipRoot, rigRoot} from './creatureRig.ts';
import {LOCOMOTION_FILE, allTreeFiles, isTreeFile, locomotionEmpty} from './locomotion.ts';
export type Asset = {
  actorRoots: string[];
  clip: string;
  paths: string[];
  mode: 'copy' | 'external';
  dependency: string;
  expectedSha256: string;
};
/** A sound file a function plays (runtime 0.12.296), copied to its path under Data in the mod. */
export type SoundAsset = {
  file: string;
  paths: string[];
  mode: 'copy' | 'external';
  dependency: string;
  expectedSha256: string;
};
export type Candidate = {path: string; size: number};
/** Verdict of AnimationInjectorXmlCheck: the plugin's own parser run on the generated XML. */
export type RuntimeVerdict = {
  available: boolean;
  valid: boolean;
  actions: string[];
  errors: string[];
  warnings: string[];
  problem: string;
};
export const runtimeSummary = (v: RuntimeVerdict) => (v.errors.length ? v.errors : v.warnings).join(' / ');
export type ReportRow = {
  /** The HKX clip, or the sound's path under Data. */
  clip: string;
  status: 'ready' | 'external' | 'missing' | 'ambiguous' | 'invalid';
  message: string;
  candidates: Candidate[];
  sha256: string;
  size: number;
};
export type PackageReport = {
  ready: boolean;
  totalBytes: number;
  warnings: string[];
  assets: ReportRow[];
  sounds: ReportRow[];
  plugins: {name: string; found: boolean}[];
  runtime?: RuntimeVerdict;
};
export type PackageRequest = {
  folder: string;
  id: string;
  roots: string[];
  assets: Asset[];
  sounds: SoundAsset[];
  plugins: string[];
  xml: string;
  /** The carry lift actions' own ragdoll files, written beside the XML (ragdoll.ts). */
  ragdolls: {id: string; contents: string}[];
  /** A locomotion project: its XML is the game's one locomotion file, Locomotion/Locomotion.xml. */
  locomotion: boolean;
};
export const assetKey = (clip: string) => clip.replaceAll('\\', '/').toLowerCase();
export function assets(w: Workspace): Asset[] {
  const map = new Map<string, Asset>();
  for (const a of w.actions)
    for (const s of a.config.steps)
      // The files of the step's view (view.ts): a first-person copy is its own file, _1stPerson\<clip>.
      for (const file of stepFiles(w, a, s)) {
        const key = assetKey(file.clip);
        let found = map.get(key);
        if (!found) {
          const policy = w.packaging.policies.find(p => assetKey(p.clip) === key);
          found = {
            clip: file.clip,
            // A creature's own clip goes to its actor folder only; a pair's to the character's (creatureRig.ts).
            actorRoots: [clipRoot(a)],
            paths: [],
            mode: policy?.mode ?? 'copy',
            dependency: policy?.dependency ?? '',
            expectedSha256: '',
          };
          map.set(key, found);
        }
        if (file.firstPerson) continue; // its source is the library entry
        const targetRoot = a.pair ? pairedRig(a.pair.targetRig).actorRoot : rigRoot(actionRig(a));
        if (!found.actorRoots.includes(targetRoot)) found.actorRoots.push(targetRoot);
        if (s.localPath && !found.paths.some(p => assetKey(p) === assetKey(s.localPath))) found.paths.push(s.localPath);
      }
  // Registered library entries supply a source path for clips the states reference without one.
  for (const asset of w.assets) {
    const found = map.get(assetKey(asset.clip));
    if (found && asset.localPath && !found.paths.some(p => assetKey(p) === assetKey(asset.localPath)))
      found.paths.push(asset.localPath);
  }
  // <Tree use="own">: the own trees' files that have a source go to the character's animations folder. One without
  // a source is left out (the runtime plays the source kind's file there), so it never holds the package back.
  for (const file of allTreeFiles(w)) {
    if (!file.localPath || map.has(assetKey(file.clip))) continue;
    const policy = w.packaging.policies.find(p => assetKey(p.clip) === assetKey(file.clip));
    map.set(assetKey(file.clip), {
      clip: file.clip,
      actorRoots: [pairedRig('character').actorRoot],
      paths: [file.localPath],
      mode: policy?.mode ?? 'copy',
      dependency: policy?.dependency ?? '',
      expectedSha256: '',
    });
  }
  return [...map.values()];
}
export function selectAsset(w: Workspace, clip: string, path: string): Workspace {
  // A first-person copy's source lives only in the library: a chosen one becomes an entry.
  const listed = w.assets.some(x => assetKey(x.clip) === assetKey(clip));
  return {
    ...w,
    assets:
      // (as an own tree's locomotion file does, locomotion.ts treeFiles)
      listed || !(isFirstPersonClip(clip) || isTreeFile(clip))
        ? w.assets.map(x => (assetKey(x.clip) === assetKey(clip) ? {...x, localPath: path} : x))
        : [...w.assets, {clip, localPath: path, preview: {skeletons: [], skins: []}}],
    actions: w.actions.map(a => ({
      ...a,
      config: {
        ...a.config,
        steps: a.config.steps.map(s => (assetKey(s.clip) === assetKey(clip) ? {...s, localPath: path} : s)),
      },
    })),
  };
}
/** The most sound files a package holds (modpack.rs MAX_SOUNDS), and the most a mod folder lists. */
export const MAX_SOUNDS = 5000;
/** A sound file the opened XML's mod folder holds (`<mod>\sound\…`, io.modSounds). The app lists them again each
 *  time the document's folder is known; they are never saved in the project (11-23: a Data folder's 500 sounds filled
 *  the project's library, and one more chosen with 찾아보기 broke the project check). */
export type FolderSound = {path: string; file: string};
/** A sound file of the project, its source, and who plays it: actions (uids) and registered events. `registered`:
 *  added to the project's library (packaging.sounds), which the mod package copies even when no function names it.
 *  `inFolder`: held by the opened XML's mod folder, which the package copies too, since the mod's plugin may play it
 *  from an HKX SoundPlay annotation. */
export type SoundEntry = {
  file: string;
  name: string;
  localPath: string;
  actions: string[];
  events: string[];
  registered: boolean;
  inFolder: boolean;
};
/** Every sound file of the project, once each: the library's, those the functions play, then the mod folder's. A
 *  source chosen in the project comes before the folder's file. */
export function soundLibrary(w: Workspace, folder: readonly FolderSound[] = []): SoundEntry[] {
  const found = new Map<string, SoundEntry>();
  const entry = (file: string) => {
    let e = found.get(assetKey(file));
    if (!e) {
      e = {
        file,
        name: file.split(/[\\/]/).pop() ?? file,
        localPath: w.packaging.sounds.find(s => assetKey(s.file) === assetKey(file))?.localPath ?? '',
        actions: [],
        events: [],
        registered: w.packaging.sounds.some(s => assetKey(s.file) === assetKey(file)),
        inFolder: false,
      };
      found.set(assetKey(file), e);
    }
    return e;
  };
  for (const s of w.packaging.sounds) entry(s.file);
  for (const a of w.actions)
    for (const e of clipEffects(a))
      if (e.values.op === 'sound' && e.values.file) {
        const s = entry(e.values.file);
        if (!s.actions.includes(a.uid)) s.actions.push(a.uid);
      }
  for (const row of w.eventRegistry ?? [])
    for (const f of row.functions)
      if (f.values.op === 'sound' && f.values.file) {
        const s = entry(f.values.file);
        if (!s.events.includes(row.name)) s.events.push(row.name);
      }
  for (const f of folder) {
    const e = entry(f.file);
    e.inFolder = true;
    if (!e.localPath) e.localPath = f.path;
  }
  return [...found.values()];
}
export const soundFiles = (w: Workspace, folder: readonly FolderSound[] = []): string[] =>
  soundLibrary(w, folder).map(e => e.file);
export function sounds(w: Workspace, folder: readonly FolderSound[] = []): SoundAsset[] {
  return soundLibrary(w, folder).map(e => {
    const policy = w.packaging.policies.find(p => assetKey(p.clip) === assetKey(e.file));
    return {
      file: e.file,
      paths: e.localPath ? [e.localPath] : [],
      mode: policy?.mode ?? 'copy',
      dependency: policy?.dependency ?? '',
      expectedSha256: '',
    };
  });
}
/** Puts a sound in the library with its source; an empty path forgets the source (the search folders are looked
 *  in again) and keeps the entry. */
export function selectSound(w: Workspace, file: string, path: string): Workspace {
  const at = w.packaging.sounds.findIndex(s => assetKey(s.file) === assetKey(file));
  const sounds = [...w.packaging.sounds];
  if (at >= 0) sounds[at] = {...sounds[at], localPath: path};
  else sounds.push({file, localPath: path});
  return {...w, packaging: {...w.packaging, sounds}};
}
/** Takes a sound out of the library (a function that still plays it keeps it in the package). */
export function unregisterSound(w: Workspace, file: string): Workspace {
  return {
    ...w,
    packaging: {...w.packaging, sounds: w.packaging.sounds.filter(s => assetKey(s.file) !== assetKey(file))},
  };
}
export function policy(w: Workspace, clip: string, mode: 'copy' | 'external', dependency: string): Workspace {
  return {
    ...w,
    packaging: {
      ...w.packaging,
      policies: [...w.packaging.policies.filter(p => assetKey(p.clip) !== assetKey(clip)), {clip, mode, dependency}],
    },
  };
}
/** The plugins whose forms the functions use: a spell's, a state spell's, a registered sound's, a global's. */
export function plugins(w: Workspace): string[] {
  const functions = [
    ...w.actions.flatMap(a => clipEffects(a)),
    ...(w.eventRegistry ?? []).flatMap(row => row.functions),
  ];
  return [
    ...new Set(
      functions
        .filter(e => ['magicAdd', 'magicRemove', 'magicCast', 'sound', 'globalSet'].includes(e.values.op))
        .map(e => e.values.plugin)
        .filter(Boolean)
    ),
  ].sort();
}
/** The folder and file name of the project's XML below SKSE/Plugins/AnimationInjector: the mod folder's name, or
 *  for a locomotion project the game's one locomotion file (locomotion.ts LOCOMOTION_FILE). */
export const xmlName = (w: Workspace) => (locomotionEmpty(w.locomotion) ? w.packaging.folder : LOCOMOTION_FILE);
/** Runtime XML is named after the mod folder, as the mod package writes <folder>/<folder>.xml. */
export function xmlFileName(folder: string) {
  return folderValid(folder) ? folder + '.xml' : 'AnimationInjector.xml';
}
/** XML save suggestion: the folder of the last XML save (if any) with the mod-named file. */
export function xmlSavePath(folder: string, lastPath = '') {
  const cut = Math.max(lastPath.lastIndexOf('\\'), lastPath.lastIndexOf('/'));
  return (cut >= 0 ? lastPath.slice(0, cut + 1) : '') + xmlFileName(folder);
}
export function folderValid(name: string) {
  const stem = name.split('.')[0].toUpperCase();
  return (
    !!name.trim() &&
    name.length <= 100 &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^\.?\.?$/.test(name) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem) &&
    !name.startsWith('.aieditor-')
  );
}
/** Notes that do not block the package. */
export function packageNotices(w: Workspace): string[] {
  // Read since runtime 0.12.229: an older one ended the game on such a folder.
  return /[^\x20-\x7e]/.test(w.packaging.folder) ? [t('export.folderAscii')] : [];
}
export function packageProblems(w: Workspace, folder: readonly FolderSound[] = []): string[] {
  const errors: string[] = [];
  if (!folderValid(w.packaging.folder)) errors.push(t('export.folderInvalid'));
  if (assets(w).length > 500) errors.push(t('export.tooMany'));
  for (const a of assets(w))
    if (a.mode === 'external' && !a.dependency.trim()) errors.push(a.clip + ': ' + t('export.providerMissing'));
  const played = sounds(w, folder);
  if (played.length > MAX_SOUNDS) errors.push(tr('한 패키지의 소리 파일은 {n}개까지입니다.', {n: MAX_SOUNDS}));
  for (const s of played)
    if (s.mode === 'external' && !s.dependency.trim()) errors.push(s.file + ': ' + t('export.providerMissing'));
  for (const p of plugins(w))
    if (!/\.(esp|esm|esl)$/i.test(p) || !folderValid(p)) errors.push(t('export.pluginInvalid') + ': ' + p);
  return errors;
}
export function request(w: Workspace, report?: PackageReport, folder: readonly FolderSound[] = []): PackageRequest {
  const errors = packageProblems(w, folder);
  if (errors.length) throw new Error(errors.join('\n'));
  const files = assets(w);
  for (const f of files)
    f.expectedSha256 = report?.assets.find(a => assetKey(a.clip) === assetKey(f.clip))?.sha256 ?? '';
  const played = sounds(w, folder);
  for (const s of played)
    s.expectedSha256 = report?.sounds.find(a => assetKey(a.clip) === assetKey(s.file))?.sha256 ?? '';
  return {
    folder: w.packaging.folder,
    id: w.id,
    roots: w.packaging.roots,
    assets: files,
    sounds: played,
    plugins: plugins(w),
    xml: compileWorkspace(w),
    ragdolls: ragdollWrites(w, [], []).files,
    locomotion: !locomotionEmpty(w.locomotion),
  };
}
