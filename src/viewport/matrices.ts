import type {ViewerActor} from './types.ts';

export type RowMajorMatrix = number[];

export function multiplyRowMajor(a: readonly number[], b: readonly number[]): RowMajorMatrix {
  const out = Array<number>(16).fill(0);
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++)
      for (let k = 0; k < 4; k++) out[row * 4 + column] += a[row * 4 + k] * b[k * 4 + column];
  return out;
}

export function matrixAt(actor: ViewerActor, frame: number, bone: number): RowMajorMatrix {
  const safeFrame = Math.max(0, Math.min(actor.rootYaw.length - 1, Math.trunc(frame)));
  const start = (safeFrame * actor.bones.length + bone) * 16;
  // Plain number[] for both the IPC Float32Array and array fixtures.
  return Array.prototype.slice.call(actor.matrices, start, start + 16);
}

export function actorRootMatrix(actor: ViewerActor, frame: number, enabled: boolean): RowMajorMatrix {
  const safeFrame = Math.max(0, Math.min(actor.rootYaw.length - 1, Math.trunc(frame)));
  if (!enabled) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const radians = (actor.rootYaw[safeFrame] * Math.PI) / 180,
    cosine = Math.cos(radians),
    sine = Math.sin(radians),
    [x, y, z] = actor.rootTranslation[safeFrame];
  return [cosine, -sine, 0, x, sine, cosine, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

export const matrixPosition = (matrix: readonly number[]): [number, number, number] => [
  matrix[3],
  matrix[7],
  matrix[11],
];

export function boneSegments(actor: ViewerActor, frame: number, bodyOnly = false): number[] {
  const positions = actor.bones.map((_, bone) => matrixPosition(matrixAt(actor, frame, bone)));
  const result: number[] = [];
  actor.bones.forEach((bone, index) => {
    if (bone.parent < 0 || (bodyOnly && (!bone.body || !actor.bones[bone.parent]?.body))) return;
    result.push(...positions[bone.parent], ...positions[index]);
  });
  return result;
}

const withoutActorPrefix = (name: string) => name.replace(/^2_/i, '');

export function normalizeBoneName(name: string): string {
  return withoutActorPrefix(name)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\.([lr])(?=$|[^a-z0-9])/g, ' $1')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('|');
}

function isCanonicalBone(name: string): boolean {
  const value = withoutActorPrefix(name),
    code =
      value
        .match(/\[([^\]]*)\]/)?.[1]
        .trim()
        .toLowerCase() ?? '',
    words = value
      .replace(/\[[^\]]*\]/g, '')
      .trim()
      .toLowerCase()
      .split(/[ _]+/)
      .filter(Boolean),
    last = words.at(-1) ?? '';
  return !!code && !!last && (last.startsWith(code) || code.startsWith(last));
}

/** Exact case-insensitive names win. Normalized fallback is used only when it is unique. */
export function matchBoneNames(joints: string[], bones: {name: string}[]): number[] {
  const exact = new Map<string, number[]>(),
    normalized = new Map<string, number[]>();
  bones.forEach((bone, index) => {
    const exactKey = withoutActorPrefix(bone.name).toLowerCase(),
      exactValues = exact.get(exactKey) ?? [];
    exactValues.push(index);
    exact.set(exactKey, exactValues);
    const key = normalizeBoneName(bone.name),
      values = normalized.get(key) ?? [];
    values.push(index);
    normalized.set(key, values);
  });
  return joints.map(name => {
    const direct = exact.get(withoutActorPrefix(name).toLowerCase());
    if (direct?.length === 1) return direct[0];
    const fallback = normalized.get(normalizeBoneName(name));
    if (fallback?.length === 1) return fallback[0];
    const canonical = fallback?.filter(index => isCanonicalBone(bones[index].name)) ?? [];
    return canonical.length === 1 ? canonical[0] : -1;
  });
}
