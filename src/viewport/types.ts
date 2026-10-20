import type {Meta} from '../timeline/model.ts';
import {tr} from '../i18n/korean.ts';

export type ViewerRequest = {path: string; skeletons: string[]; candidates: string[]};
export type ViewerBone = {name: string; parent: number; body: boolean};
export type ViewerActor = {
  skeleton: string;
  skeletonPath: string;
  bones: ViewerBone[];
  /** Frame-major, 16 row-major values per bone. Float32Array from the desktop IPC. */
  matrices: Float32Array | number[];
  rootTranslation: [number, number, number][];
  rootYaw: number[];
  trajectory: [number, number, number][];
};
export type ViewerAnnotation = {time: number; text: string; track: string};
export type ViewerData = {
  duration: number;
  fps: number;
  frameCount: number;
  paired: boolean;
  actors: ViewerActor[];
  annotations: ViewerAnnotation[];
};
export type SkinBinary = {path: string; name: string; bytes: Uint8Array | number[]};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const allFinite = (values: ArrayLike<unknown>) => {
  for (let i = 0; i < values.length; i++) if (!finite(values[i])) return false;
  return true;
};
const vector = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(finite);

export function validateViewerData(value: unknown): ViewerData {
  if (!value || typeof value !== 'object') throw new Error(tr('HKX 프레임 응답 형식이 올바르지 않습니다.'));
  const data = value as ViewerData;
  if (
    !finite(data.duration) ||
    data.duration <= 0 ||
    !finite(data.fps) ||
    data.fps <= 0 ||
    !Number.isInteger(data.frameCount) ||
    data.frameCount < 1 ||
    data.frameCount > 100_000 ||
    typeof data.paired !== 'boolean' ||
    !Array.isArray(data.actors) ||
    data.actors.length < 1 ||
    data.actors.length > 2 ||
    !Array.isArray(data.annotations)
  )
    throw new Error(tr('HKX 프레임 응답의 기본 값이 올바르지 않습니다.'));
  for (const actor of data.actors) {
    if (
      typeof actor?.skeleton !== 'string' ||
      typeof actor?.skeletonPath !== 'string' ||
      !Array.isArray(actor.bones) ||
      !(Array.isArray(actor.matrices) || actor.matrices instanceof Float32Array) ||
      actor.matrices.length !== data.frameCount * actor.bones.length * 16 ||
      !allFinite(actor.matrices) ||
      !Array.isArray(actor.rootTranslation) ||
      actor.rootTranslation.length !== data.frameCount ||
      !actor.rootTranslation.every(vector) ||
      !Array.isArray(actor.rootYaw) ||
      actor.rootYaw.length !== data.frameCount ||
      !actor.rootYaw.every(finite) ||
      !Array.isArray(actor.trajectory) ||
      actor.trajectory.length !== data.frameCount ||
      !actor.trajectory.every(vector)
    )
      throw new Error(tr('HKX 액터 프레임 응답 형식이 올바르지 않습니다.'));
    actor.bones.forEach((bone, index) => {
      if (
        typeof bone?.name !== 'string' ||
        typeof bone?.body !== 'boolean' ||
        !Number.isInteger(bone?.parent) ||
        bone.parent < -1 ||
        bone.parent >= index
      )
        throw new Error(tr('HKX 본 계층 응답 형식이 올바르지 않습니다.'));
    });
  }
  if (data.paired !== (data.actors.length === 2)) throw new Error(tr('HKX 페어 액터 수가 응답과 맞지 않습니다.'));
  for (const item of data.annotations)
    if (!finite(item?.time) || typeof item?.text !== 'string' || typeof item?.track !== 'string')
      throw new Error(tr('HKX 주석 응답 형식이 올바르지 않습니다.'));
  return data;
}

export const viewerMeta = (data?: ViewerData): Meta | undefined =>
  data ? {duration: data.duration, tracks: data.actors.length, annotations: data.annotations} : undefined;

export function frameAtTime(time: number, data?: Pick<ViewerData, 'duration' | 'frameCount'>): number {
  if (!data || data.frameCount <= 1 || data.duration <= 0) return 0;
  const normalized = Math.max(0, Math.min(1, time / data.duration));
  return Math.round(normalized * (data.frameCount - 1));
}
