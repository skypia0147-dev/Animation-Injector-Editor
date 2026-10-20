import {pairedRig} from './pairedRigs.ts';
import type {Workspace} from './workspace.ts';
import {compileWorkspace} from './workspace.ts';
import {t} from './i18n/index.ts';
import {isFirstPersonClip, stepFiles} from './view.ts';
export type Asset = {
  actorRoots: string[];
  clip: string;
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
export type PackageReport = {
  ready: boolean;
  totalBytes: number;
  warnings: string[];
  assets: {
    clip: string;
    status: 'ready' | 'external' | 'missing' | 'ambiguous' | 'invalid';
    message: string;
    candidates: Candidate[];
    sha256: string;
    size: number;
  }[];
  plugins: {name: string; found: boolean}[];
  runtime?: RuntimeVerdict;
};
export type PackageRequest = {
  folder: string;
  id: string;
  roots: string[];
  assets: Asset[];
  plugins: string[];
  xml: string;
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
            actorRoots: ['meshes/actors/character'],
            paths: [],
            mode: policy?.mode ?? 'copy',
            dependency: policy?.dependency ?? '',
            expectedSha256: '',
          };
          map.set(key, found);
        }
        if (file.firstPerson) continue; // its source is the library entry
        const targetRoot = a.pair ? pairedRig(a.pair.targetRig).actorRoot : 'meshes/actors/character';
        if (!found.actorRoots.includes(targetRoot)) found.actorRoots.push(targetRoot);
        if (s.localPath && !found.paths.some(p => assetKey(p) === assetKey(s.localPath))) found.paths.push(s.localPath);
      }
  // Registered library entries supply a source path for clips the states reference without one.
  for (const asset of w.assets) {
    const found = map.get(assetKey(asset.clip));
    if (found && asset.localPath && !found.paths.some(p => assetKey(p) === assetKey(asset.localPath)))
      found.paths.push(asset.localPath);
  }
  return [...map.values()];
}
export function selectAsset(w: Workspace, clip: string, path: string): Workspace {
  // A first-person copy's source lives only in the library: a chosen one becomes an entry.
  const listed = w.assets.some(x => assetKey(x.clip) === assetKey(clip));
  return {
    ...w,
    assets:
      listed || !isFirstPersonClip(clip)
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
export function policy(w: Workspace, clip: string, mode: 'copy' | 'external', dependency: string): Workspace {
  return {
    ...w,
    packaging: {
      ...w.packaging,
      policies: [...w.packaging.policies.filter(p => assetKey(p.clip) !== assetKey(clip)), {clip, mode, dependency}],
    },
  };
}
export function plugins(w: Workspace): string[] {
  return [
    ...new Set(
      w.actions
        .filter(a => a.pair?.effectsEnabled)
        .flatMap(a => a.pair!.effects.filter(e => e.values.op === 'spell').map(e => e.values.plugin))
        .filter(Boolean)
    ),
  ].sort();
}
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
export function packageProblems(w: Workspace): string[] {
  const errors: string[] = [];
  if (!folderValid(w.packaging.folder)) errors.push(t('export.folderInvalid'));
  if (assets(w).length > 500) errors.push(t('export.tooMany'));
  for (const a of assets(w))
    if (a.mode === 'external' && !a.dependency.trim()) errors.push(a.clip + ': ' + t('export.providerMissing'));
  for (const p of plugins(w))
    if (!/\.(esp|esm|esl)$/i.test(p) || !folderValid(p)) errors.push(t('export.pluginInvalid') + ': ' + p);
  return errors;
}
export function request(w: Workspace, report?: PackageReport): PackageRequest {
  const errors = packageProblems(w);
  if (errors.length) throw new Error(errors.join('\n'));
  const files = assets(w);
  for (const f of files)
    f.expectedSha256 = report?.assets.find(a => assetKey(a.clip) === assetKey(f.clip))?.sha256 ?? '';
  return {
    folder: w.packaging.folder,
    id: w.id,
    roots: w.packaging.roots,
    assets: files,
    plugins: plugins(w),
    xml: compileWorkspace(w),
  };
}
