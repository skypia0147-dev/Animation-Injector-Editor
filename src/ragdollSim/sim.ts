// The ragdoll calculator of the carry preview: a port of HKX_Edit's hkxviewer/ragdoll_sim.py (11-04), which it must
// match (tests/ragdoll-sim.test.mjs against tests/fixtures/ragdoll-golden.json, made from the Python calculator).
// Havok-like maximal coordinates: rigid bodies joined by the skeleton's ragdoll and limited-hinge joints, solved with
// velocity impulses; every constraint row of one kind is solved for all joints at once (Jacobi across joints with
// Tonge's mass splitting), in fixed 60 Hz steps split into substeps, with warm starting and split-impulse position
// correction. The game's meanings and units are the Python module's; see its docstring.
import type {RagdollData, RagdollShape} from './data.ts';
import type {M3, M4, Q, V3} from './math.ts';
import {
  add,
  clamp,
  columnNorm,
  cross,
  det3,
  dot,
  eye3,
  eye4,
  frame4,
  interp,
  inv3,
  inv4,
  matQuat,
  mul3,
  mul4,
  mulV3,
  norm,
  pos4,
  principalAxis,
  qmul,
  quatMat,
  rot4,
  rotvec,
  scale,
  skew,
  sub,
  transpose3,
  unit,
  unscaled,
  zero3,
} from './math.ts';

export const HAVOK_SCALE = 69.99;
export const GRAVITY = 9.8 * HAVOK_SCALE;
export const STEP = 1 / 60;
const BAUMGARTE = 0.6;
const M2 = HAVOK_SCALE * HAVOK_SCALE;
const GROUND_FRICTION = 0.5;
const CONTACT_MARGIN = 1.0;
const CONTACT_SLOP = 0.3;
const CONTACT_RECOVERY = 1.0 * HAVOK_SCALE;
// The engine's biped self-collision table (bhkCollisionFilter::bipedBitfields).
const BIPED_COLLISIONS: Record<number, number> = {
  0: 0x00000000,
  1: 0x004230c0,
  2: 0x014030c0,
  3: 0x014030c0,
  4: 0x014230c0,
  5: 0x00403000,
  6: 0x0042791e,
  7: 0x0041ff1e,
  8: 0x0145f0c0,
  9: 0x0145e080,
  10: 0x0144e080,
  11: 0x004000c0,
  12: 0x004241fe,
  13: 0x0045c7fe,
  14: 0x014437c0,
  15: 0x01442780,
  16: 0x01442380,
  17: 0x00401052,
  18: 0x0041e700,
  19: 0x00000000,
  20: 0x00400000,
  21: 0x00400000,
  22: 0x0037fffe,
  23: 0x00000000,
  24: 0x0001c71c,
};
export const partsCollide = (a: number, b: number) =>
  !!(((BIPED_COLLISIONS[a] ?? 0) >>> b) & 1 || ((BIPED_COLLISIONS[b] ?? 0) >>> a) & 1);

/** A shape as one capsule in its body frame (unscaled): drawing, picking and contacts use it. */
export function shapeCapsule(shape: RagdollShape): [V3, V3, number] {
  if (shape.kind === 'capsule') return [[...shape.a], [...shape.b], shape.radius];
  if (shape.kind === 'box') {
    const ext = shape.a.map(Math.abs) as V3;
    let axis = 0;
    for (let k = 1; k < 3; k++) if (ext[k] > ext[axis]) axis = k;
    const a: V3 = [0, 0, 0],
      c: V3 = [0, 0, 0];
    a[axis] = -ext[axis];
    c[axis] = ext[axis];
    return [a, c, Math.max(...ext.filter((_, k) => k !== axis)) + shape.radius];
  }
  if (shape.kind === 'convex' && shape.points.length) {
    const n = shape.points.length;
    const mid: V3 = [0, 0, 0];
    for (const p of shape.points) for (let k = 0; k < 3; k++) mid[k] += p[k] / n;
    const cov = zero3();
    for (const p of shape.points) {
      const d = sub(p, mid);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += d[r] * d[c];
    }
    const axis = principalAxis(cov);
    let lo = Infinity,
      hi = -Infinity,
      r = 0;
    for (const p of shape.points) {
      const d = sub(p, mid),
        proj = dot(d, axis);
      lo = Math.min(lo, proj);
      hi = Math.max(hi, proj);
      r = Math.max(r, norm(sub(d, scale(axis, proj))));
    }
    return [add(mid, scale(axis, lo)), add(mid, scale(axis, hi)), r + shape.radius];
  }
  return [[0, 0, 0], [0, 0, 0], shape.radius];
}
/** The points a shape rests on (unscaled body frame) with their radius. */
export function shapePoints(shape: RagdollShape): [V3, number][] {
  if (shape.kind === 'capsule')
    return [
      [[...shape.a], shape.radius],
      [[...shape.b], shape.radius],
    ];
  if (shape.kind === 'box') {
    const ext = shape.a.map(Math.abs);
    // np.meshgrid([-1,1],[-1,1],[-1,1]) stacked, transposed, reshaped: z slowest, then x, then y.
    const out: [V3, number][] = [];
    for (const z of [-1, 1])
      for (const x of [-1, 1]) for (const y of [-1, 1]) out.push([[ext[0] * x, ext[1] * y, ext[2] * z], shape.radius]);
    return out;
  }
  if (shape.kind === 'convex' && shape.points.length) return shape.points.map(p => [[...p], shape.radius]);
  return [[[0, 0, 0], shape.radius]];
}

/** Closest points of two segments (Ericson 5.1.9; nearly parallel segments meet in the middle of their overlap). */
function closestSegments(p1: V3, q1: V3, p2: V3, q2: V3): [V3, V3] {
  const d1 = sub(q1, p1),
    d2 = sub(q2, p2),
    r = sub(p1, p2);
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r),
    c = dot(d1, r),
    b = dot(d1, d2);
  const denom = a * e - b * b,
    eps = 1e-9;
  let s = denom > eps ? clamp((b * f - c * e) / denom, 0, 1) : 0;
  if (denom <= 3e-4 * a * e && a > eps) {
    const s2 = -c / a,
      t2 = (b - c) / a;
    s = (clamp(Math.min(s2, t2), 0, 1) + clamp(Math.max(s2, t2), 0, 1)) / 2;
  }
  if (a <= eps) s = 0;
  let t = e > eps ? (b * s + f) / e : 0;
  if (t < 0) s = a > eps ? clamp(-c / a, 0, 1) : 0;
  else if (t > 1) s = a > eps ? clamp((b - c) / a, 0, 1) : 0;
  t = clamp(t, 0, 1);
  return [add(p1, scale(d1, s)), add(p2, scale(d2, t))];
}

/** A profile's <Motion>: damping and gravity are minimums over the native values; friction < 0 keeps native. */
export type SimMotion = {
  follow: number;
  gravity: number;
  drag: number;
  spin: number;
  inertia: number;
  friction: number;
};
export const defaultSimMotion = (): SimMotion => ({
  follow: 0,
  gravity: 1,
  drag: 0.8,
  spin: 3,
  inertia: 1,
  friction: -1,
});
/** A profile's <Body>, angles in radians; undefined = the Motion or native value. */
export type SimBody = {
  bone: string;
  simulate: boolean;
  drag?: number;
  spin?: number;
  gravity?: number;
  inertia?: number;
  friction?: number;
  cone?: number;
  plane?: [number, number];
  twist?: [number, number];
  swingFrom?: string;
};
/** A welded joint's range about its start angle (radians), as the runtime's weldPad. */
const WELD_PAD = Math.PI / 180;
export type SimSettings = {substeps: number; iterations: number; positionIterations: number; maxSteps: number};
export const defaultSimSettings = (): SimSettings => ({
  substeps: 2,
  iterations: 12,
  positionIterations: 8,
  maxSteps: 4,
});

type Row = {
  name: string;
  active: boolean[];
  jla: V3[];
  jaa: V3[];
  jlb: V3[];
  jab: V3[];
  bias: number[];
  lo: number[];
  hi: number[];
  pbias: number[] | null;
};
type Prepared = {
  name: string;
  active: boolean[];
  ja: number[][];
  jb: number[][];
  ma: number[][];
  mb: number[][];
  bias: number[];
  lo: number[];
  hi: number[];
  meff: number[];
  acc: number[];
  pbias: number[] | null;
};
type Contacts = {
  a: number[];
  floor: boolean[];
  b: number[];
  dirs: {ja: number[][]; jb: number[][]; ma: number[][]; mb: number[][]; meff: number[]}[];
  bias: number[];
  pbias: number[];
  mu: number[];
  acc: [number, number, number][];
  keys: string[];
};
const zeros = (n: number) => new Array<number>(n).fill(0);
const v6dot = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] + a[5] * b[5];

export class RagdollSim {
  rag: RagdollData;
  settings: SimSettings;
  warnings: string[] = [];
  groups: number[];
  locals: M4[];
  nodeWorld0: M4[] = [];
  index = new Map<string, number>();
  names: string[];
  bodyNode: number[];
  x: V3[];
  q: Q[];
  v: V3[];
  w: V3[];
  invM: number[];
  invI: M3[];
  gravity: number[];
  drag: number[];
  spin: number[];
  dynamic: boolean[];
  /** A simulate=false body below a simulated one: simulated, its joint to the body above locked at its start angle
   *  (the runtime's PartialRagdollPolicy::WeldedToParent, user decision 11-04). */
  welded: boolean[] = [];
  com: V3[];
  offset: M4[] = [];
  nodeScale: number[];
  maxV: number[];
  maxW: number[];
  // joints
  ja: number[] = [];
  jb: number[] = [];
  ra: V3[] = [];
  rb: V3[] = [];
  hinge: boolean[] = [];
  ta: V3[] = [];
  pa: V3[] = [];
  tb: V3[] = [];
  pb: V3[] = [];
  cone: number[] = [];
  plane: [number, number][] = [];
  twist: [number, number][] = [];
  friction: number[] = [];
  lower: number[] = [];
  /** The joint holds its welded lower body at the start angle (range: one degree either way). */
  weld: boolean[] = [];
  limbs: [number, number, number][] = [];
  pivotRealigned: [string, string, number][] = [];
  split: number[] = [];
  warm = new Map<string, number[] | V3[]>();
  limbRest = new Map<number, [number, number, M4, M4]>();
  structure = '';
  follow = 0;
  widened: [string, string, number][] = [];
  startAngles: [number[], number[], number[]] | null = null;
  keyframeTargets = new Map<number, M4>();
  gravityVector: V3 = [0, 0, -GRAVITY];
  floor: number | null;
  // collision
  pointBody: number[] = [];
  pointLocal: V3[] = [];
  pointRadius: number[] = [];
  capBody: number[] = [];
  capA: V3[] = [];
  capB: V3[] = [];
  capRadius: number[] = [];
  pairA: number[] = [];
  pairB: number[] = [];
  frictionCoefficient: number[] = [];
  warmContacts = new Map<string, [number, number, number]>();
  accum = 0;
  time = 0;
  maxJointError = 0;
  private pseudo: [V3[], V3[]] = [[], []];

  constructor(
    rag: RagdollData,
    opts: {
      pose?: Map<string, M4>;
      root?: M4;
      motion?: SimMotion;
      bodies?: SimBody[];
      keyframed?: string[];
      settings?: SimSettings;
      floor?: number | null;
      widenToStart?: boolean;
    } = {}
  ) {
    this.rag = rag;
    this.settings = opts.settings ?? defaultSimSettings();
    const motion = opts.motion ?? defaultSimMotion();
    const root = opts.root ?? eye4();
    const pose = opts.pose ?? new Map<string, M4>();
    this.groups = zeros(rag.bodies.length);
    this.locals = rag.nodes.map(n => pose.get(n.name) ?? n.local);
    rag.nodes.forEach((n, i) => {
      const parent = n.parent >= 0 ? this.nodeWorld0[n.parent] : root;
      this.nodeWorld0.push(mul4(parent, this.locals[i]));
    });
    rag.nodes.forEach((n, i) => this.index.set(n.name.toLowerCase(), i));
    const tuning = this.tuning(opts.bodies ?? []);
    const keyed = new Set((opts.keyframed ?? []).map(k => k.toLowerCase()));
    const n = rag.bodies.length;
    this.names = rag.bodies.map(b => b.node);
    this.bodyNode = rag.bodies.map(b => this.index.get(b.node.toLowerCase())!);
    this.x = [];
    this.q = [];
    this.v = Array.from({length: n}, () => [0, 0, 0] as V3);
    this.w = Array.from({length: n}, () => [0, 0, 0] as V3);
    this.invM = zeros(n);
    this.invI = Array.from({length: n}, zero3);
    this.gravity = zeros(n);
    this.drag = zeros(n);
    this.spin = zeros(n);
    this.dynamic = new Array(n).fill(false);
    this.com = [];
    this.nodeScale = new Array(n).fill(1);
    this.maxV = new Array(n).fill(Infinity);
    this.maxW = new Array(n).fill(Infinity);
    rag.bodies.forEach((b, i) => {
      const node = this.nodeWorld0[this.bodyNode[i]];
      const s = columnNorm(node, 0);
      const off = b.offset.slice();
      off[3] *= s;
      off[7] *= s;
      off[11] *= s;
      const frame = mul4(unscaled(node), off);
      this.offset.push(off);
      this.nodeScale[i] = s;
      this.maxV[i] = b.maxLinear > 0 ? b.maxLinear * HAVOK_SCALE : Infinity;
      this.maxW[i] = b.maxAngular > 0 ? b.maxAngular : Infinity;
      this.com.push(scale(b.center, s));
      this.x.push(add(mulV3(rot4(frame), this.com[i]), pos4(frame)));
      this.q.push(matQuat(rot4(frame)));
      const t = tuning.get(b.node.toLowerCase());
      this.dynamic[i] = !keyed.has(b.node.toLowerCase()) && (t === undefined || t.simulate) && b.mass > 0;
    });
    // Held bodies below a simulated one weld to the body above, all chosen against the profile's selection (a held
    // chain welds link by link). The carry's held body (keyframed) never welds.
    const simulated = this.dynamic.slice();
    this.welded = rag.bodies.map((b, i) => {
      if (simulated[i] || keyed.has(b.node.toLowerCase()) || b.mass <= 0) return false;
      const above = this.aboveBody(this.bodyNode[i]);
      if (
        above < 0 ||
        !rag.joints.some(j => [this.body(j.a), this.body(j.b)].sort().join() === [i, above].sort().join())
      )
        return false;
      for (let p = above; p >= 0; p = this.aboveBody(this.bodyNode[p])) if (simulated[p]) return true;
      return false;
    });
    this.welded.forEach((w, i) => {
      if (w) this.dynamic[i] = true;
    });
    this.buildJoints(tuning);
    this.structure = RagdollSim.structureOf(tuning);
    this.tune([motion], tuning);
    if (opts.widenToStart) {
      this.startAngles = this.angles(...this.worldAxes());
      this.widenToStart();
    }
    this.floor = opts.floor ?? null;
    this.buildCollision();
  }

  // ---- setup
  body(name: string) {
    const lower = name.toLowerCase();
    return this.names.findIndex(n => n.toLowerCase() === lower);
  }
  frame(i: number): M4 {
    const r = quatMat(this.q[i]);
    return frame4(r, sub(this.x[i], mulV3(r, this.com[i])));
  }
  private aboveBody(node: number) {
    let p = this.rag.nodes[node].parent;
    while (p >= 0) {
      const hit = this.bodyNode.indexOf(p);
      if (hit >= 0) return hit;
      p = this.rag.nodes[p].parent;
    }
    return -1;
  }
  private buildJoints(tuning: Map<string, SimBody>) {
    const rag = this.rag;
    rag.joints.forEach((j, k) => {
      const a = this.body(j.a),
        b = this.body(j.b);
      this.ja[k] = a;
      this.jb[k] = b;
      const fa = this.frame(a),
        fb = this.frame(b);
      const sa = this.nodeScale[a],
        sb = this.nodeScale[b];
      const paWorld = add(mulV3(rot4(fa), scale(j.pivotA, sa)), pos4(fa));
      const pbWorld = add(mulV3(rot4(fb), scale(j.pivotB, sb)), pos4(fb));
      const [lower, upper] = this.aboveBody(this.bodyNode[a]) === b ? [a, b] : [b, a];
      const t = tuning.get(this.names[lower].toLowerCase());
      let pivot = lower === a ? pbWorld : paWorld;
      if (t?.swingFrom) {
        const root = this.index.get(t.swingFrom.toLowerCase()) ?? -1;
        const chain: number[] = [];
        let p = rag.nodes[this.bodyNode[lower]].parent;
        while (p >= 0 && p !== this.bodyNode[upper]) {
          chain.push(p);
          p = rag.nodes[p].parent;
        }
        if (chain.includes(root) && this.dynamic[lower]) {
          pivot = pos4(this.nodeWorld0[root]);
          this.limbs.push([lower, root, upper]);
        } else this.warnings.push(`swingFrom '${t.swingFrom}' of '${t.bone}' ignored`);
      }
      const gap = norm(sub(paWorld, pbWorld));
      if (gap > 0.01 && !t?.swingFrom) this.pivotRealigned.push([this.names[a], this.names[b], gap]);
      this.ra[k] = mulV3(transpose3(rot4(fa)), sub(pivot, this.x[a]));
      this.rb[k] = mulV3(transpose3(rot4(fb)), sub(pivot, this.x[b]));
      this.hinge[k] = j.kind === 'hinge';
      this.ta[k] = unit(j.axesA[this.hinge[k] ? 'axis' : 'twist']);
      this.tb[k] = unit(j.axesB[this.hinge[k] ? 'axis' : 'twist']);
      this.pa[k] = unit(j.axesA[this.hinge[k] ? 'perp1' : 'plane']);
      this.pb[k] = unit(j.axesB[this.hinge[k] ? 'perp1' : 'plane']);
      this.lower[k] = lower;
      this.weld[k] = this.welded[lower];
      if (this.weld[k]) {
        // The welded body's axes turned onto the other's at the start pose: every angle is 0 there.
        const turn = lower === a ? mul3(transpose3(rot4(fa)), rot4(fb)) : mul3(transpose3(rot4(fb)), rot4(fa));
        if (lower === a) {
          this.ta[k] = unit(mulV3(turn, this.tb[k]));
          this.pa[k] = unit(mulV3(turn, this.pb[k]));
        } else {
          this.tb[k] = unit(mulV3(turn, this.ta[k]));
          this.pb[k] = unit(mulV3(turn, this.pa[k]));
        }
      }
      this.cone[k] = 0;
      this.plane[k] = [0, 0];
      this.twist[k] = [0, 0];
      this.friction[k] = 0;
    });
    const count = zeros(this.names.length);
    for (const a of this.ja) count[a]++;
    for (const b of this.jb) count[b]++;
    this.split = count.map(c => Math.max(c, 1));
    for (const [lower, root, upper] of this.limbs) {
      const inv = inv4(this.nodeWorld0[this.bodyNode[upper]]);
      this.limbRest.set(root, [
        lower,
        upper,
        mul4(inv, this.nodeWorld0[this.bodyNode[lower]]),
        mul4(inv, this.nodeWorld0[root]),
      ]);
    }
  }
  private tuning(bodies: SimBody[]) {
    const names = new Set(this.rag.bodies.map(b => b.node.toLowerCase()));
    const out = new Map<string, SimBody>();
    for (const t of bodies)
      if (names.has(t.bone.toLowerCase())) out.set(t.bone.toLowerCase(), t);
      else this.warnings.push(`profile bone '${t.bone}' has no ragdoll body; entry ignored`);
    return out;
  }
  /** What a profile change can't apply to a running simulation: which bodies simulate and where pivots sit. */
  static structureOf(tuning: Map<string, SimBody>) {
    const off = [...tuning].filter(([, t]) => !t.simulate).map(([n]) => n);
    const swing = [...tuning].filter(([, t]) => t.swingFrom).map(([n, t]) => n + '>' + t.swingFrom!.toLowerCase());
    return JSON.stringify([off.sort(), swing.sort()]);
  }
  private tune(motions: SimMotion[], tuning: Map<string, SimBody>) {
    this.follow = motions[0].follow;
    this.rag.bodies.forEach((b, i) => {
      const motion = motions.length > 1 ? motions[this.groups[i]] : motions[0];
      const t = tuning.get(b.node.toLowerCase());
      const s = this.nodeScale[i];
      const factor = Math.max(1, t && t.inertia ? t.inertia : motion.inertia);
      const inertia = b.inertia.map(v => v * M2 * s ** 3 * factor);
      this.invM[i] = 0;
      this.invI[i] = zero3();
      if (this.dynamic[i]) {
        this.invM[i] = 1 / (b.mass * s);
        const inv = inv3(inertia);
        this.invI[i] = inv ?? [
          1 / Math.max(inertia[0], 1e-9),
          0,
          0,
          0,
          1 / Math.max(inertia[4], 1e-9),
          0,
          0,
          0,
          1 / Math.max(inertia[8], 1e-9),
        ];
      }
      this.gravity[i] = Math.max(b.gravityFactor, t && t.gravity ? t.gravity : motion.gravity);
      this.drag[i] = Math.max(b.linearDamping, t && t.drag !== undefined ? t.drag : motion.drag);
      this.spin[i] = Math.max(b.angularDamping, t && t.spin !== undefined ? t.spin : motion.spin);
    });
    this.rag.joints.forEach((j, k) => {
      const motion = motions.length > 1 ? motions[this.groups[this.lower[k]]] : motions[0];
      const t = tuning.get(this.names[this.lower[k]].toLowerCase());
      const lim = j.limits;
      if (this.hinge[k]) this.twist[k] = [lim.min, lim.max];
      else {
        this.cone[k] = lim.cone;
        this.plane[k] = [lim.plane_min, lim.plane_max];
        this.twist[k] = [lim.twist_min, lim.twist_max];
      }
      if (t) {
        if (t.cone !== undefined && !this.hinge[k]) this.cone[k] = t.cone;
        if (t.plane !== undefined && !this.hinge[k]) this.plane[k] = [...t.plane];
        if (t.twist !== undefined) this.twist[k] = [...t.twist];
      }
      if (this.weld[k]) {
        this.cone[k] = WELD_PAD;
        this.plane[k] = [-WELD_PAD, WELD_PAD];
        this.twist[k] = [-WELD_PAD, WELD_PAD];
      }
      let friction = j.friction;
      if (motion.friction >= 0) friction = Math.min(friction, motion.friction);
      if (t && t.friction !== undefined) friction = t.friction;
      this.friction[k] = friction * M2;
    });
    this.widenToStart();
  }
  /** New profile values while running. False: the change needs a new simulation (a simulate flag or a swingFrom). */
  retune(motion: SimMotion, bodies: SimBody[]) {
    const tuning = this.tuning(bodies);
    if (RagdollSim.structureOf(tuning) !== this.structure) return false;
    this.tune([motion], tuning);
    return true;
  }
  private buildCollision() {
    this.rag.bodies.forEach((b, i) => {
      const s = this.nodeScale[i];
      for (const shape of b.shapes) {
        for (const [p, r] of shapePoints(shape)) {
          this.pointBody.push(i);
          this.pointLocal.push(scale(p, s));
          this.pointRadius.push(r * s);
        }
        const [a, c, r] = shapeCapsule(shape);
        this.capBody.push(i);
        this.capA.push(scale(a, s));
        this.capB.push(scale(c, s));
        this.capRadius.push(r * s);
      }
    });
    const joined = new Set(this.ja.map((a, k) => [a, this.jb[k]].sort((x, y) => x - y).join(',')));
    const parts = this.rag.bodies.map(b => b.part);
    const cb = this.capBody,
      g = this.groups;
    for (let i = 0; i < cb.length; i++)
      for (let j = i + 1; j < cb.length; j++)
        if (
          cb[i] !== cb[j] &&
          !joined.has([cb[i], cb[j]].sort((x, y) => x - y).join(',')) &&
          (g[cb[i]] !== g[cb[j]] || partsCollide(parts[cb[i]], parts[cb[j]]))
        ) {
          this.pairA.push(i);
          this.pairB.push(j);
        }
    this.frictionCoefficient = this.rag.bodies.map(b => b.friction);
  }
  private contacts() {
    const R = this.q.map(quatMat);
    const origin = this.x.map((x, i) => sub(x, mulV3(R[i], this.com[i])));
    const a: number[] = [],
      b: number[] = [],
      point: V3[] = [],
      normal: V3[] = [],
      sep: number[] = [],
      mu: number[] = [],
      keys: string[] = [];
    if (this.floor !== null)
      this.pointBody.forEach((i, k) => {
        const world = add(mulV3(R[i], this.pointLocal[k]), origin[i]);
        const s = world[2] - this.pointRadius[k] - this.floor!;
        if (s < CONTACT_MARGIN && this.dynamic[i]) {
          a.push(-1);
          b.push(i);
          point.push([world[0], world[1], world[2] - this.pointRadius[k]]);
          normal.push([0, 0, 1]);
          sep.push(s);
          mu.push(Math.sqrt(this.frictionCoefficient[i] * GROUND_FRICTION));
          keys.push('g' + k);
        }
      });
    this.pairA.forEach((ca, k) => {
      const cb = this.pairB[k];
      const ia = this.capBody[ca],
        ib = this.capBody[cb];
      if (!(this.dynamic[ia] || this.dynamic[ib])) return;
      const a1 = add(mulV3(R[ia], this.capA[ca]), origin[ia]),
        a2 = add(mulV3(R[ia], this.capB[ca]), origin[ia]);
      const b1 = add(mulV3(R[ib], this.capA[cb]), origin[ib]),
        b2 = add(mulV3(R[ib], this.capB[cb]), origin[ib]);
      const [pa, pb] = closestSegments(a1, a2, b1, b2);
      const d = sub(pb, pa),
        dist = norm(d);
      const ra = this.capRadius[ca],
        rb = this.capRadius[cb];
      const s = dist - ra - rb;
      if (s < CONTACT_MARGIN) {
        const n: V3 = dist > 1e-6 ? scale(d, 1 / Math.max(dist, 1e-6)) : [0, 0, 1];
        a.push(ia);
        b.push(ib);
        point.push(scale(add(add(pa, scale(n, ra)), sub(pb, scale(n, rb))), 0.5));
        normal.push(n);
        sep.push(s);
        mu.push(Math.sqrt(this.frictionCoefficient[ia] * this.frictionCoefficient[ib]));
        keys.push('c' + k);
      }
    });
    return keys.length ? {a, b, point, normal, sep, mu, keys} : null;
  }

  // ---- stepping
  setTarget(name: string, frame: M4) {
    const i = this.body(name);
    if (i >= 0 && !this.dynamic[i]) this.keyframeTargets.set(i, frame);
  }
  addVelocity(dv: V3) {
    this.v.forEach((v, i) => {
      if (this.dynamic[i]) this.v[i] = add(v, dv);
    });
  }
  /** Advance by dt seconds in fixed 60 Hz steps (at most maxSteps per call). */
  step(dt: number) {
    this.accum = Math.min(this.accum + Math.max(0, dt), STEP * this.settings.maxSteps);
    let steps = 0;
    while (this.accum >= STEP - 1e-9) {
      this.fixedStep(STEP);
      this.accum -= STEP;
      steps++;
    }
    return steps;
  }
  private fixedStep(h: number) {
    const start = new Map([...this.keyframeTargets.keys()].map(i => [i, this.frame(i)]));
    const n = this.settings.substeps,
      sub = h / n;
    for (let s = 0; s < n; s++) {
      const f = (s + 1) / n;
      const targets = new Map([...this.keyframeTargets].map(([i, goal]) => [i, interp(start.get(i)!, goal, f)]));
      this.substep(sub, targets);
    }
    this.time += h;
  }
  private substep(h: number, targets: Map<number, M4>) {
    const dyn = this.dynamic;
    for (const [i, goal] of targets) {
      const cur = this.frame(i);
      const goalCom = add(mulV3(rot4(goal), this.com[i]), pos4(goal));
      this.v[i] = scale(sub(goalCom, this.x[i]), 1 / h);
      this.w[i] = scale(rotvec(mul3(rot4(goal), transpose3(rot4(cur)))), 1 / h);
    }
    dyn.forEach((d, i) => {
      if (!d && !targets.has(i)) {
        this.v[i] = [0, 0, 0];
        this.w[i] = [0, 0, 0];
      }
    });
    dyn.forEach((d, i) => {
      if (!d) return;
      const v = add(this.v[i], scale(this.gravityVector, this.gravity[i] * h));
      this.v[i] = scale(v, 1 / (1 + h * this.drag[i]));
      this.w[i] = scale(this.w[i], 1 / (1 + h * this.spin[i]));
    });
    this.solve(h, this.contacts());
    for (const [vel, cap] of [
      [this.v, this.maxV],
      [this.w, this.maxW],
    ] as [V3[], number[]][])
      vel.forEach((u, i) => {
        const speed = norm(u);
        if (dyn[i] && speed > cap[i]) vel[i] = scale(u, cap[i] / speed);
      });
    const [pv, pw] = this.pseudo;
    this.x = this.x.map((x, i) => add(x, scale(add(this.v[i], pv[i]), h)));
    this.q = this.q.map((q, i) => {
      const w = add(this.w[i], pw[i]);
      const dq = qmul([0, w[0], w[1], w[2]], q);
      const next = q.map((v, k) => v + 0.5 * h * dq[k]) as Q;
      const n = Math.hypot(...next);
      return next.map(v => v / n) as Q;
    });
    for (const [i, goal] of targets) {
      this.q[i] = matQuat(rot4(goal));
      this.x[i] = add(mulV3(rot4(goal), this.com[i]), pos4(goal));
    }
  }
  /** Every joint's twist / plane axes of body A and B in world space. */
  private worldAxes(R = this.q.map(quatMat)): [V3[], V3[], V3[], V3[]] {
    const ta = this.ja.map((a, k) => unit(mulV3(R[a], this.ta[k])));
    const tb = this.jb.map((b, k) => unit(mulV3(R[b], this.tb[k])));
    const pa = this.ja.map((a, k) => unit(mulV3(R[a], this.pa[k])));
    const pb = this.jb.map((b, k) => unit(mulV3(R[b], this.pb[k])));
    return [ta, tb, pa, pb];
  }
  /** (cone angle, plane angle, twist or hinge angle) of every joint. */
  private angles(ta: V3[], tb: V3[], pa: V3[], pb: V3[]): [number[], number[], number[]] {
    const theta: number[] = [],
      phi: number[] = [],
      angle: number[] = [];
    ta.forEach((t, k) => {
      theta.push(Math.acos(clamp(dot(t, tb[k]), -1, 1)));
      phi.push(Math.asin(clamp(dot(t, pb[k]), -1, 1)));
      if (this.hinge[k]) {
        const pbOnA = unit(sub(pb[k], scale(t, dot(pb[k], t))));
        angle.push(-Math.atan2(dot(t, cross(pa[k], pbOnA)), dot(pa[k], pbOnA)));
      } else {
        const tMean = unit(add(t, tb[k]));
        const u = unit(sub(pa[k], scale(tMean, dot(pa[k], tMean))));
        const v = unit(sub(pb[k], scale(tMean, dot(pb[k], tMean))));
        angle.push(Math.atan2(dot(tMean, cross(u, v)), dot(u, v)));
      }
    });
    return [theta, phi, angle];
  }
  /** A start pose past a joint's limit widens that limit to it (the game does the same at a carry's start). */
  private widenToStart() {
    if (!this.startAngles) return;
    const [theta, phi, angle] = this.startAngles;
    const pad = Math.PI / 180;
    const widened: [string, string, number][] = [];
    this.ja.forEach((a, k) => {
      if (this.weld[k]) return;
      const name = `${this.names[a]}-${this.names[this.jb[k]]}`;
      const rag = !this.hinge[k];
      if (rag && theta[k] + pad > this.cone[k]) {
        widened.push([name, 'cone', theta[k] + pad - this.cone[k]]);
        this.cone[k] = theta[k] + pad;
      }
      if (rag && phi[k] + pad > this.plane[k][1]) {
        widened.push([name, 'plane', phi[k] + pad - this.plane[k][1]]);
        this.plane[k][1] = phi[k] + pad;
      }
      if (rag && phi[k] - pad < this.plane[k][0]) {
        widened.push([name, 'plane', this.plane[k][0] - phi[k] + pad]);
        this.plane[k][0] = phi[k] - pad;
      }
      const kind = this.hinge[k] ? 'hinge' : 'twist';
      if (angle[k] + pad > this.twist[k][1]) {
        widened.push([name, kind, angle[k] + pad - this.twist[k][1]]);
        this.twist[k][1] = angle[k] + pad;
      }
      if (angle[k] - pad < this.twist[k][0]) {
        widened.push([name, kind, this.twist[k][0] - angle[k] + pad]);
        this.twist[k][0] = angle[k] - pad;
      }
    });
    this.widened = widened.filter(([, , d]) => d > pad * 1.5).map(([n, kind, d]) => [n, kind, (d * 180) / Math.PI]);
  }
  private solve(h: number, contacts: ReturnType<RagdollSim['contacts']>) {
    const R = this.q.map(quatMat);
    const m = this.ja.length;
    const im = this.invM.map((v, i) => (this.dynamic[i] ? v : 0));
    const ii = this.invI.map((inv, i) => (this.dynamic[i] ? mul3(mul3(R[i], inv), transpose3(R[i])) : zero3()));
    const a = this.ja,
      b = this.jb;
    const ra = a.map((ai, k) => mulV3(R[ai], this.ra[k]));
    const rb = b.map((bi, k) => mulV3(R[bi], this.rb[k]));
    const [ta, tb, pa, pb] = this.worldAxes(R);
    const [theta, phi, angle] = this.angles(ta, tb, pa, pb);
    const err = b.map((bi, k) => sub(add(this.x[bi], rb[k]), add(this.x[a[k]], ra[k])));
    this.maxJointError = err.reduce((best, e) => Math.max(best, norm(e)), 0);
    // The ball socket: one 3x3 block per joint, each against its copy of mass m/c.
    const kInv = a.map((ai, k) => {
      const bi = b[k],
        ca = this.split[ai],
        cbs = this.split[bi];
      const sa = skew(ra[k]),
        sb = skew(rb[k]);
      const iiA = ii[ai].map(v => v * ca),
        iiB = ii[bi].map(v => v * cbs);
      const lin = im[ai] * ca + im[bi] * cbs;
      const K = eye3().map(v => v * lin);
      const ta3 = mul3(mul3(sa, iiA), sa),
        tb3 = mul3(mul3(sb, iiB), sb);
      for (let e = 0; e < 9; e++) K[e] -= ta3[e] + tb3[e];
      if (Math.abs(det3(K)) < 1e-18) for (const e of [0, 4, 8]) K[e] += 1;
      return inv3(K) ?? eye3();
    });
    const pointBias = err.map(e => scale(e, BAUMGARTE / h));
    const rows: Row[] = [];
    const angular = (name: string, active: boolean[], n: V3[], c: number[]): Row => ({
      name,
      active,
      jla: n.map(() => [0, 0, 0]),
      jaa: n.map(x => scale(x, -1)),
      jlb: n.map(() => [0, 0, 0]),
      jab: n,
      bias: c.map(v => (v > 0 ? 0 : v / h)),
      lo: c.map(() => -Infinity),
      hi: c.map(() => 0),
      pbias: c.map(v => (v > 0 ? (BAUMGARTE / h) * v : 0)),
    });
    const rag = this.hinge.map(x => !x);
    const nCone = ta.map((t, k) => unit(cross(t, tb[k])));
    const cCone = theta.map((t, k) => t - this.cone[k]);
    rows.push(
      angular(
        'cone',
        rag.map((r, k) => r && cCone[k] > -0.05),
        nCone,
        cCone
      )
    );
    const nPlane = ta.map((t, k) => scale(cross(t, pb[k]), 1 / Math.max(Math.cos(phi[k]), 1e-3)));
    rows.push(
      angular(
        'plane_max',
        rag.map((r, k) => r && phi[k] > this.plane[k][1] - 0.05),
        nPlane.map(x => scale(x, -1)),
        phi.map((p, k) => p - this.plane[k][1])
      )
    );
    rows.push(
      angular(
        'plane_min',
        rag.map((r, k) => r && phi[k] < this.plane[k][0] + 0.05),
        nPlane,
        phi.map((p, k) => this.plane[k][0] - p)
      )
    );
    const tMean = ta.map((t, k) => unit(add(t, tb[k])));
    const perp1 = ta.map((t, k) => unit(cross(t, pa[k])));
    const align = ta.map((t, k) => cross(t, tb[k]));
    for (const [name, d] of [
      ['h1', pa],
      ['h2', perp1],
    ] as [string, V3[]][])
      rows.push({
        name,
        active: [...this.hinge],
        jla: d.map(() => [0, 0, 0]),
        jaa: d.map(x => scale(x, -1)),
        jlb: d.map(() => [0, 0, 0]),
        jab: d,
        bias: zeros(m),
        lo: zeros(m).map(() => -Infinity),
        hi: zeros(m).map(() => Infinity),
        pbias: d.map((x, k) => (BAUMGARTE / h) * dot(align[k], x)),
      });
    const axisT = ta.map((t, k) => (this.hinge[k] ? scale(t, -1) : tMean[k]));
    rows.push(
      angular(
        'twist_max',
        angle.map((v, k) => v > this.twist[k][1] - 0.05),
        axisT,
        angle.map((v, k) => v - this.twist[k][1])
      )
    );
    rows.push(
      angular(
        'twist_min',
        angle.map((v, k) => v < this.twist[k][0] + 0.05),
        axisT.map(x => scale(x, -1)),
        angle.map((v, k) => this.twist[k][0] - v)
      )
    );
    const limit = this.friction.map(f => f * h);
    for (let axis = 0; axis < 3; axis++) {
      const e = ta.map((t, k) => (this.hinge[k] ? t : ([0, 1, 2].map(c => (c === axis ? 1 : 0)) as V3)));
      rows.push({
        name: 'f' + axis,
        active: limit.map((l, k) => l > 0 && (!this.hinge[k] || axis === 0)),
        jla: e.map(() => [0, 0, 0]),
        jaa: e.map(x => scale(x, -1)),
        jlb: e.map(() => [0, 0, 0]),
        jab: e,
        bias: zeros(m),
        lo: limit.map(l => -l),
        hi: limit,
        pbias: null,
      });
    }
    this.jacobi(rows, im, ii, ra, rb, kInv, pointBias, this.contactRows(contacts, h, im, ii));
  }
  private contactRows(
    contacts: ReturnType<RagdollSim['contacts']>,
    h: number,
    im: number[],
    ii: M3[]
  ): Contacts | null {
    if (!contacts) return null;
    const {a: ca, b: cb, point, normal: n, sep, mu, keys} = contacts;
    const floor = ca.map(x => x < 0);
    const ia = ca.map((x, k) => (floor[k] ? 0 : x));
    const ra = point.map((p, k): V3 => (floor[k] ? [0, 0, 0] : sub(p, this.x[ia[k]])));
    const rb = point.map((p, k) => sub(p, this.x[cb[k]]));
    const t1 = n.map(d => unit(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])));
    const t2 = n.map((d, k) => cross(d, t1[k]));
    const count = this.split.slice();
    cb.forEach(x => count[x]++);
    ia.forEach((x, k) => {
      if (!floor[k]) count[x]++;
    });
    const dirs = [n, t1, t2].map(d => {
      const ja: number[][] = [],
        jb: number[][] = [],
        ma: number[][] = [],
        mb: number[][] = [],
        meff: number[] = [];
      d.forEach((dk, k) => {
        const jla = scale(dk, -1),
          jaa = scale(cross(ra[k], dk), -1);
        const jlb = dk,
          jab = cross(rb[k], dk);
        const imA = floor[k] ? 0 : im[ia[k]];
        const iiA = floor[k] ? zero3() : ii[ia[k]];
        const rowA = [...scale(jla, imA), ...mulV3(iiA, jaa)];
        const rowB = [...scale(jlb, im[cb[k]]), ...mulV3(ii[cb[k]], jab)];
        const jA = [...jla, ...jaa],
          jB = [...jlb, ...jab];
        const kk = (floor[k] ? 0 : count[ia[k]]) * v6dot(jA, rowA) + count[cb[k]] * v6dot(jB, rowB);
        ja.push(jA);
        jb.push(jB);
        ma.push(rowA);
        mb.push(rowB);
        meff.push(kk > 1e-12 ? 1 / kk : 0);
      });
      return {ja, jb, ma, mb, meff};
    });
    return {
      a: ia,
      floor,
      b: cb,
      dirs,
      bias: sep.map(s => (s > 0 ? s / h : 0)),
      pbias: sep.map(s => (s > 0 ? 0 : Math.max((BAUMGARTE / h) * Math.min(s + CONTACT_SLOP, 0), -CONTACT_RECOVERY))),
      mu,
      acc: keys.map(key => [...(this.warmContacts.get(key) ?? [0, 0, 0])] as [number, number, number]),
      keys,
    };
  }
  /** Rows of one kind for all joints at once (Jacobi), kinds in sequence; then the split-impulse position pass. */
  private jacobi(
    rows: Row[],
    im: number[],
    ii: M3[],
    ra: V3[],
    rb: V3[],
    kInv: M3[],
    pointBias: V3[],
    contacts: Contacts | null
  ) {
    const a = this.ja,
      b = this.jb,
      m = a.length,
      nb = this.names.length;
    const prepared: Prepared[] = [];
    for (const row of rows) {
      if (!row.active.some(Boolean)) {
        this.warm.delete(row.name);
        continue;
      }
      const ja: number[][] = [],
        jb: number[][] = [],
        ma: number[][] = [],
        mb: number[][] = [],
        meff: number[] = [],
        acc: number[] = [];
      const active = [...row.active];
      const warm = (this.warm.get(row.name) as number[] | undefined) ?? zeros(m);
      for (let k = 0; k < m; k++) {
        const jA = [...row.jla[k], ...row.jaa[k]],
          jB = [...row.jlb[k], ...row.jab[k]];
        const mA = [...scale(row.jla[k], im[a[k]]), ...mulV3(ii[a[k]], row.jaa[k])];
        const mB = [...scale(row.jlb[k], im[b[k]]), ...mulV3(ii[b[k]], row.jab[k])];
        const kk = this.split[a[k]] * v6dot(jA, mA) + this.split[b[k]] * v6dot(jB, mB);
        active[k] = active[k] && kk > 1e-12;
        ja.push(jA);
        jb.push(jB);
        ma.push(mA);
        mb.push(mB);
        meff.push(active[k] ? 1 / (kk > 1e-12 ? kk : 1) : 0);
        acc.push(clamp(active[k] ? warm[k] : 0, row.lo[k], row.hi[k]));
      }
      prepared.push({
        name: row.name,
        active,
        ja,
        jb,
        ma,
        mb,
        bias: row.bias,
        lo: row.lo,
        hi: row.hi,
        meff,
        acc,
        pbias: row.pbias,
      });
    }
    const vel = this.v.map((v, i) => [...v, ...this.w[i]]);
    const addTo = (target: number[][], body: number, d: number[], f = 1) => {
      const t = target[body];
      for (let e = 0; e < 6; e++) t[e] += d[e] * f;
    };
    const push = (target: number[][], lam: V3[]) => {
      const da = lam.map((l, k) => [...scale(l, -im[a[k]]), ...scale(mulV3(ii[a[k]], cross(ra[k], l)), -1)]);
      const db = lam.map((l, k) => [...scale(l, im[b[k]]), ...mulV3(ii[b[k]], cross(rb[k], l))]);
      for (let k = 0; k < m; k++) {
        addTo(target, a[k], da[k]);
        addTo(target, b[k], db[k]);
      }
    };
    const ball = (target: number[][], bias: V3[] | null) => {
      const lam = a.map((ai, k) => {
        const va = target[ai],
          vb = target[b[k]];
        const lin = (x: number[]): V3 => [x[0], x[1], x[2]];
        const ang = (x: number[]): V3 => [x[3], x[4], x[5]];
        let cdot = sub(add(lin(vb), cross(ang(vb), rb[k])), add(lin(va), cross(ang(va), ra[k])));
        if (bias) cdot = add(cdot, bias[k]);
        return scale(mulV3(kInv[k], cdot), -1);
      });
      push(target, lam);
      return lam;
    };
    const rowPass = (target: number[][], row: Prepared, acc: number[], bias: number[]) => {
      const next = acc.map((x, k) => {
        const jv = v6dot(row.ja[k], target[a[k]]) + v6dot(row.jb[k], target[b[k]]);
        return clamp(x - (jv + bias[k]) * row.meff[k], row.lo[k], row.hi[k]);
      });
      for (let k = 0; k < m; k++) {
        const d = next[k] - acc[k];
        if (d === 0) continue;
        addTo(target, a[k], row.ma[k], d);
        addTo(target, b[k], row.mb[k], d);
      }
      return next;
    };
    const contactPass = (target: number[][], c: Contacts, axis: number, acc: number[], bias: number[]) => {
      const {ja, jb, ma, mb, meff} = c.dirs[axis];
      const next = acc.map((x, k) => {
        const va = c.floor[k] ? [0, 0, 0, 0, 0, 0] : target[c.a[k]];
        const jv = v6dot(ja[k], va) + v6dot(jb[k], target[c.b[k]]);
        if (axis === 0) return Math.max(x - (jv + bias[k]) * meff[k], 0);
        const lim = c.mu[k] * c.acc[k][0];
        return clamp(x - jv * meff[k], -lim, lim);
      });
      next.forEach((x, k) => {
        const d = x - acc[k];
        if (d === 0) return;
        if (!c.floor[k]) addTo(target, c.a[k], ma[k], d);
        addTo(target, c.b[k], mb[k], d);
      });
      return next;
    };
    // Velocity pass, warm started.
    let pointAcc = ((this.warm.get('point') as V3[] | undefined) ?? a.map(() => [0, 0, 0] as V3)).map(
      x => [...x] as V3
    );
    push(vel, pointAcc);
    for (const row of prepared)
      if (row.acc.some(x => x !== 0))
        for (let k = 0; k < m; k++) {
          addTo(vel, a[k], row.ma[k], row.acc[k]);
          addTo(vel, b[k], row.mb[k], row.acc[k]);
        }
    if (contacts)
      contacts.dirs.forEach(({ma, mb}, axis) =>
        contacts.keys.forEach((_, k) => {
          const lam = contacts.acc[k][axis];
          if (!contacts.floor[k]) addTo(vel, contacts.a[k], ma[k], lam);
          addTo(vel, contacts.b[k], mb[k], lam);
        })
      );
    for (let it = 0; it < this.settings.iterations; it++) {
      const lam = ball(vel, null);
      pointAcc = pointAcc.map((p, k) => add(p, lam[k]));
      for (const row of prepared) row.acc = rowPass(vel, row, row.acc, row.bias);
      if (contacts)
        for (let axis = 0; axis < 3; axis++) {
          const next = contactPass(
            vel,
            contacts,
            axis,
            contacts.acc.map(x => x[axis]),
            contacts.bias
          );
          next.forEach((x, k) => (contacts.acc[k][axis] = x));
        }
    }
    this.v = vel.map(x => [x[0], x[1], x[2]]);
    this.w = vel.map(x => [x[3], x[4], x[5]]);
    // Position pass: pseudo-velocities from rest, no warm start, no friction.
    const pseudo = Array.from({length: nb}, () => [0, 0, 0, 0, 0, 0]);
    const pAcc = prepared.map(() => zeros(m));
    let cAcc = contacts ? zeros(contacts.keys.length) : null;
    for (let it = 0; it < this.settings.positionIterations; it++) {
      ball(pseudo, pointBias);
      prepared.forEach((row, k) => {
        if (row.pbias) pAcc[k] = rowPass(pseudo, row, pAcc[k], row.pbias);
      });
      if (contacts) cAcc = contactPass(pseudo, contacts, 0, cAcc!, contacts.pbias);
    }
    this.pseudo = [pseudo.map(x => [x[0], x[1], x[2]]), pseudo.map(x => [x[3], x[4], x[5]])];
    this.warmContacts = new Map(contacts ? contacts.keys.map((key, k) => [key, contacts.acc[k]] as const) : []);
    this.warm.set('point', pointAcc);
    for (const row of prepared)
      this.warm.set(
        row.name,
        row.acc.map((x, k) => (row.active[k] ? x : 0))
      );
  }

  // ---- output
  bodyFrames(): Map<string, M4> {
    return new Map(this.names.map((n, i) => [n, this.frame(i)]));
  }
  /** World 4x4 of every node: bodies from the simulation, other nodes from their start locals below them, swingFrom
   *  roots turned by their body's swing; nodes above the ragdoll go with `above`. */
  nodeWorlds(above: M4 = eye4()): M4[] {
    const out: M4[] = new Array(this.rag.nodes.length);
    const frames = new Map(this.bodyNode.map((node, i) => [node, i]));
    const limbNodes = new Set(this.limbs.map(([lower]) => this.bodyNode[lower]));
    this.rag.nodes.forEach((node, k) => {
      const parent = node.parent >= 0 ? out[node.parent] : null;
      let world: M4;
      if (frames.has(k) && !limbNodes.has(k)) {
        const i = frames.get(k)!;
        world = mul4(this.frame(i), inv4(this.offset[i]));
        for (const e of [0, 1, 2, 4, 5, 6, 8, 9, 10]) world[e] *= this.nodeScale[i];
      } else if (this.limbRest.has(k)) {
        const [lower, upper, restInUpper, rootInUpper] = this.limbRest.get(k)!;
        const up = out[this.bodyNode[upper]];
        const body = mul4(this.frame(lower), inv4(this.offset[lower]));
        const rest = mul4(up, restInUpper);
        world = mul4(up, rootInUpper);
        const turn = mul3(rot4(unscaled(body)), transpose3(rot4(unscaled(rest))));
        const r = mul3(turn, rot4(world));
        world = frame4(r, pos4(world));
      } else if (parent) world = mul4(parent, this.locals[k]);
      else world = mul4(above, this.nodeWorld0[k]);
      out[k] = world;
    });
    return out;
  }
}
