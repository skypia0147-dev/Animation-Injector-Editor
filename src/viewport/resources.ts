import {clone} from '../model.ts';
import {assetKey} from '../package.ts';
import {pairedRig, type PairedRig} from '../pairedRigs.ts';
import type {PreviewAssets, Workspace} from '../workspace.ts';
import {tr} from '../i18n/korean.ts';

export type PreviewAssetKind = 'skeletons' | 'skins';
export const emptyPreviewAssets = (): PreviewAssets => ({skeletons: [], skins: []});

export function previewAssets(w: Workspace, clip: string, targetRig?: PairedRig): PreviewAssets {
  const result = clone(
    w.assets.find(asset => assetKey(asset.clip) === assetKey(clip))?.preview ?? emptyPreviewAssets()
  );
  if (targetRig && targetRig !== 'character') {
    result.skeletons[0] ||= pairedRig('character').previewSkeleton;
    result.skeletons[1] ||= pairedRig(targetRig).previewSkeleton;
  }
  return result;
}

export function setPreviewAsset(
  w: Workspace,
  clip: string,
  kind: PreviewAssetKind,
  actor: number,
  path: string
): Workspace {
  if (!clip) throw new Error(tr('프리뷰 자산을 연결할 클립이 없습니다.'));
  if (actor !== 0 && actor !== 1) throw new Error(tr('프리뷰 액터는 A1 또는 A2여야 합니다.'));
  const next = clone(w);
  let asset = next.assets.find(item => assetKey(item.clip) === assetKey(clip));
  if (!asset) {
    asset = {clip, localPath: '', preview: emptyPreviewAssets()};
    next.assets.push(asset);
  }
  const paths = [...asset.preview[kind]];
  while (paths.length <= actor) paths.push('');
  paths[actor] = path;
  while (paths.at(-1) === '') paths.pop();
  asset.preview[kind] = paths;
  return next;
}

export function skeletonCandidates(w: Workspace, explicit: string[]): string[] {
  const used = new Set(explicit.filter(Boolean).map(path => path.toLowerCase()));
  const result: string[] = [];
  for (const asset of w.assets)
    for (const path of asset.preview.skeletons)
      if (path && !used.has(path.toLowerCase())) {
        used.add(path.toLowerCase());
        result.push(path);
      }
  return result;
}

const normalizedStem = (path: string) =>
  (path.split(/[\\/]/).at(-1) ?? path)
    .replace(/\.(glb|hkx)$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

/** Explicit A1/A2 mapping wins; a uniquely named registered skin is the automatic fallback. */
export function skinPathForActor(
  w: Workspace,
  clip: string,
  actor: number,
  skeleton: string,
  skeletonPath = ''
): string {
  const explicit = previewAssets(w, clip).skins[actor];
  if (explicit) return explicit;
  const wanted = normalizedStem(skeleton);
  const candidates = [...new Set(w.assets.flatMap(asset => asset.preview.skins).filter(Boolean))];
  const matches = candidates.filter(path => normalizedStem(path) === wanted);
  return matches.length === 1
    ? matches[0]
    : skeletonPath.startsWith('builtin/skeletons/')
      ? `builtin/meshes/${skeleton}.glb`
      : '';
}
