import {backendText, invoke, isTauri, runtimeText} from './backend.ts';
import type {PackageRequest, PackageReport, RuntimeVerdict} from './package';
import {t} from './i18n/index.ts';
import {tr} from './i18n/korean.ts';

export async function resolveSearchRoots(paths: string[]): Promise<{roots: string[]; rejected: string[]}> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  return invoke('resolve_search_roots', {paths});
}

/** `stamp` is the SHA-256 of the file's bytes as read (empty outside the desktop app): Save compares it with the
 * file on disk so an edit made elsewhere is never written over without asking. */
export type OpenedDocument = {name: string; path: string; contents: string; stamp: string};
/** A written document: its path and the stamp of what is now on disk. */
export type SavedDocument = {path: string; stamp: string};
/** saveToPath's error when the file changed on disk since it was opened or last saved (main.rs CHANGED_ON_DISK). */
export const changedOnDisk = (error: unknown) => String(error).includes('changed-on-disk');
export type ResolvedHkx = {path: string; clip: string; error: string};

export async function pickAssetRoot(): Promise<string | null> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  return invoke('pick_asset_root');
}
export async function probePackage(request: PackageRequest): Promise<PackageReport> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  const report = await invoke<PackageReport>('probe_package', {request});
  return {
    ...report,
    warnings: report.warnings.map(backendText),
    assets: report.assets.map(a => ({...a, message: backendText(a.message)})),
    runtime: report.runtime && checkerText(report.runtime),
  };
}
export async function exportMod(request: PackageRequest): Promise<{path: string; files: number; bytes: number} | null> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  return invoke('export_mod', {request});
}

/** The checker's verdict in the UI language: its errors and warnings are the runtime's own (Korean) words. */
const checkerText = (v: RuntimeVerdict): RuntimeVerdict => ({
  ...v,
  problem: runtimeText(backendText(v.problem)),
  errors: v.errors.map(runtimeText),
  warnings: v.warnings.map(runtimeText),
});

/** Runs the plugin's parser on generated XML. The plugin skips a rejected file entirely. */
export async function checkRuntimeXml(xml: string): Promise<RuntimeVerdict> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  const verdict = await invoke<RuntimeVerdict>('check_runtime_xml', {xml});
  return checkerText(verdict);
}

export async function pickHkx(): Promise<{path: string; clip: string} | null> {
  if (!isTauri()) throw new Error(t('drop.hkxNeedsDesktop'));
  return invoke('pick_hkx');
}
/** Dropped HKX paths → relative clip paths. Entries with a non-empty `error` were not registered. */
export async function resolveHkx(paths: string[]): Promise<ResolvedHkx[]> {
  if (!isTauri()) throw new Error(t('drop.hkxNeedsDesktop'));
  return (await invoke<ResolvedHkx[]>('resolve_hkx', {paths})).map(r => ({...r, error: backendText(r.error)}));
}
export async function checkAssets(
  files: {id: string; path: string; clip: string}[]
): Promise<{id: string; message: string}[]> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  const results = await invoke<{id: string; message: string}[]>('check_assets', {files});
  return results.map(r => ({...r, message: backendText(r.message)}));
}

export async function save(
  kind: 'xml' | 'template',
  contents: string,
  defaultPath?: string,
  draft = false
): Promise<SavedDocument | null> {
  if (isTauri())
    return invoke<SavedDocument | null>('save_document', {kind, contents, defaultPath: defaultPath || null, draft});
  const name = kind === 'template' ? 'AnimationSet.aitemplate' : 'AnimationInjector.xml';
  const url = URL.createObjectURL(
    new Blob([contents], {type: kind === 'xml' ? 'application/xml' : 'application/json'})
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultPath?.split(/[\\/]/).at(-1) || name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return {path: name, stamp: ''};
}
/** File > Save when the document already has its XML. Falls back to the dialog outside the desktop app.
 * `expected` is the stamp of the file as last read or written; '' writes over whatever is there. */
export async function saveToPath(
  path: string,
  contents: string,
  expected: string,
  draft = false
): Promise<SavedDocument | null> {
  if (isTauri()) return invoke<SavedDocument>('save_to_path', {path, contents, expected: expected || null, draft});
  return save('xml', contents);
}
export async function open(): Promise<OpenedDocument | null> {
  if (isTauri()) return invoke<OpenedDocument | null>('open_document');
  return new Promise((resolve, reject) => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.xml,.aitemplate';
    picker.oncancel = () => resolve(null);
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return resolve(null);
      if (file.size > 4 * 1024 * 1024) return reject(new Error(tr('파일은 4 MB 이하여야 합니다.')));
      try {
        resolve({name: file.name, path: '', contents: await file.text(), stamp: ''});
      } catch (e) {
        reject(e);
      }
    };
    picker.click();
  });
}
/** Recent files and drag & drop. */
export async function openPath(path: string): Promise<OpenedDocument> {
  if (!isTauri()) throw new Error(t('export.desktop'));
  return invoke<OpenedDocument>('read_document', {path});
}
