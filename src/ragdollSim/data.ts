// A rig's ragdoll as HKX_Edit's ragdoll_data.py bundles it (src/ragdollSim/rigs/<id>.json, format 2, made from the
// vanilla skeleton.nif): nodes, rigid bodies with their shapes, and the joints between them. Units: game units,
// kilograms, inertia in kg*m^2 (Havok's own), angles in radians.
import type {M3, M4, V3} from './math.ts';
import {eye4} from './math.ts';

export const RAGDOLL_DATA_FORMAT = 2;
export type RagdollNode = {name: string; parent: number; local: M4};
export type RagdollShape = {
  kind: 'capsule' | 'box' | 'sphere' | 'convex' | string;
  radius: number;
  a: V3;
  b: V3;
  points: V3[];
};
export type RagdollBodyData = {
  node: string;
  kind: string;
  offset: M4;
  mass: number;
  inertia: M3;
  center: V3;
  linearDamping: number;
  angularDamping: number;
  gravityFactor: number;
  friction: number;
  restitution: number;
  maxLinear: number;
  maxAngular: number;
  layer: number;
  part: number;
  shapes: RagdollShape[];
};
export type RagdollJoint = {
  kind: 'ragdoll' | 'hinge' | string;
  a: string;
  b: string;
  pivotA: V3;
  pivotB: V3;
  axesA: Record<string, V3>;
  axesB: Record<string, V3>;
  limits: Record<string, number>;
  friction: number;
};
export type RagdollData = {
  id: string;
  rig: string;
  source: string;
  nodes: RagdollNode[];
  bodies: RagdollBodyData[];
  joints: RagdollJoint[];
};

const m34 = (values: number[]): M4 => {
  const m = eye4();
  for (let i = 0; i < 12; i++) m[i] = values[i];
  return m;
};
const v = (values: number[]): V3 => [values[0], values[1], values[2]];

/** One bundled rig file (ragdoll_data.from_json). */
export function ragdollFromJson(data: any): RagdollData {
  if (data?.format !== RAGDOLL_DATA_FORMAT)
    throw new Error(`ragdoll data format ${data?.format} (expected ${RAGDOLL_DATA_FORMAT})`);
  return {
    id: data.id,
    rig: data.rig,
    source: data.source ?? '',
    nodes: data.nodes.map((n: any) => ({name: n.name, parent: n.parent, local: m34(n.m)})),
    bodies: data.bodies.map((b: any) => ({
      node: b.node,
      kind: b.kind,
      offset: m34(b.offset),
      mass: b.mass,
      inertia: b.inertia.slice(0, 9),
      center: v(b.center),
      linearDamping: b.linearDamping,
      angularDamping: b.angularDamping,
      gravityFactor: b.gravityFactor,
      friction: b.friction,
      restitution: b.restitution,
      maxLinear: b.maxLinear,
      maxAngular: b.maxAngular,
      layer: b.layer,
      part: b.part,
      shapes: b.shapes.map((s: any) => ({
        kind: s.kind,
        radius: s.radius,
        a: v(s.a),
        b: v(s.b),
        points: s.points.map(v),
      })),
    })),
    joints: data.joints.map((j: any) => ({
      kind: j.kind,
      a: j.a,
      b: j.b,
      pivotA: v(j.pivotA),
      pivotB: v(j.pivotB),
      axesA: Object.fromEntries(Object.entries(j.axesA).map(([k, x]) => [k, v(x as number[])])),
      axesB: Object.fromEntries(Object.entries(j.axesB).map(([k, x]) => [k, v(x as number[])])),
      limits: {...j.limits},
      friction: j.friction,
    })),
  };
}
