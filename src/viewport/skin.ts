import * as THREE from 'three';
import {matchBoneNames, matrixAt} from './matrices.ts';
import type {ViewerActor} from './types.ts';
import {tr} from '../i18n/korean.ts';

export type SkinJoint = {name: string; parent: number};
export type SkinPoseStats = {matchedBones: number; maxWorldError: number};

/** GLB helper joints may remain in their bind pose, while every driven joint must map uniquely. */
export function validateSkinHierarchy(joints: SkinJoint[], actor: ViewerActor): number[] {
  const matches = matchBoneNames(
    joints.map(joint => joint.name),
    actor.bones
  );
  const driven = matches.filter(index => index >= 0);
  if (!driven.length) throw new Error(tr('GLB 본 이름이 선택한 스켈레톤과 일치하지 않습니다.'));
  if (new Set(driven).size !== driven.length) throw new Error(tr('GLB 본 여러 개가 같은 HKX 본에 중복 연결됩니다.'));
  joints.forEach((joint, index) => {
    if (!Number.isInteger(joint.parent) || joint.parent < -1 || joint.parent >= joints.length || joint.parent === index)
      throw new Error(tr('GLB 본 계층이 올바르지 않습니다: {name}', {name: joint.name}));
    const visited = new Set<number>([index]);
    let parent = joint.parent;
    while (parent >= 0) {
      if (visited.has(parent)) throw new Error(tr('GLB 본 계층에 순환이 있습니다: {name}', {name: joint.name}));
      visited.add(parent);
      parent = joints[parent].parent;
    }
  });
  return matches;
}

const matrix = (values: readonly number[]) => {
  const result = new THREE.Matrix4();
  result.set(...values);
  return result;
};

function jointDescription(bones: any[]): SkinJoint[] {
  const indices = new Map(bones.map((bone, index) => [bone, index]));
  return bones.map(bone => {
    let parent = bone.parent;
    while (parent && !indices.has(parent)) parent = parent.parent;
    // GLTFLoader sanitizes Object3D.name (brackets, spaces and duplicate names).
    // userData.name retains the authored joint name needed for HKX matching.
    const name = typeof bone.userData?.name === 'string' && bone.userData.name ? bone.userData.name : bone.name;
    return {name, parent: parent ? indices.get(parent)! : -1};
  });
}

/** Set target object-space matrices through each GLB bone's actual parent transform. */
export function applyActorPose(actorRoot: any, actor: ViewerActor, frame: number, meshes: any[]): SkinPoseStats {
  actorRoot.updateWorldMatrix(true, false);
  const actorWorld = actorRoot.matrixWorld.clone();
  const drivenBoneObjects = new Set<any>();
  let maxWorldError = 0;
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones as any[],
      joints = jointDescription(bones),
      matches = validateSkinHierarchy(joints, actor),
      completed = new Set<number>();
    const apply = (joint: number) => {
      if (completed.has(joint)) return;
      if (joints[joint].parent >= 0) apply(joints[joint].parent);
      const bone = bones[joint],
        parent = bone.parent;
      parent?.updateWorldMatrix?.(true, false);
      if (matches[joint] >= 0) {
        const desiredWorld = actorWorld.clone().multiply(matrix(matrixAt(actor, frame, matches[joint]))),
          local = parent ? parent.matrixWorld.clone().invert().multiply(desiredWorld) : desiredWorld;
        local.decompose(bone.position, bone.quaternion, bone.scale);
        drivenBoneObjects.add(bone);
      }
      bone.updateMatrix();
      bone.updateMatrixWorld(true);
      completed.add(joint);
    };
    bones.forEach((_, joint) => apply(joint));
  }
  actorRoot.updateMatrixWorld(true);
  for (const mesh of meshes) {
    mesh.updateMatrixWorld?.(true);
    const matches = validateSkinHierarchy(jointDescription(mesh.skeleton.bones), actor);
    mesh.skeleton.bones.forEach((bone: any, joint: number) => {
      if (matches[joint] < 0) return;
      const expected = actorWorld.clone().multiply(matrix(matrixAt(actor, frame, matches[joint])));
      expected.elements.forEach((value: number, index: number) => {
        maxWorldError = Math.max(maxWorldError, Math.abs(value - bone.matrixWorld.elements[index]));
      });
    });
    mesh.skeleton.update();
  }
  if (maxWorldError > 0.001)
    throw new Error(
      tr('GLB 본 world 변환을 재현하지 못했습니다. 최대 오차 {v0}', {v0: maxWorldError.toExponential(3)})
    );
  return {matchedBones: drivenBoneObjects.size, maxWorldError};
}

export const describeSkinJoints = jointDescription;
