// The carry preview: a rig's ragdoll with one body held by the carrier's hand, the hand following a scenario (walk,
// run and stop, turn, jump) or the user's drag, passing its motion on as the game's carry does. Port of HKX_Edit's
// hkxviewer/ragdoll_preview.py (11-04).
import type {RagdollData} from './data.ts';
import type {M4, V3} from './math.ts';
import {eye4, inv4, mul4, norm, pos4, scale, sub} from './math.ts';
import type {SimBody, SimMotion} from './sim.ts';
import {RagdollSim, STEP, defaultSimMotion} from './sim.ts';
import type {Ragdoll} from '../ragdoll.ts';

const FORWARD: V3 = [0, 1, 0]; // a Skyrim actor faces +Y
const TELEPORT = 60; // a hand jump larger than this per step is not a speed
export const ragdollScenarios = ['hold', 'walk', 'run', 'turn', 'jump'] as const;
export type RagdollScenario = (typeof ragdollScenarios)[number];

const yaw = (a: number): M4 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
const move = (x: number, y: number, z: number): M4 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

/** The hand's motion `t` seconds into a scenario (a world transform applied to the start hand) and its period. */
export function scenarioOffset(name: RagdollScenario, t: number): [M4, number] {
  if (name === 'walk' || name === 'run') {
    const [speed, bob, freq] = name === 'walk' ? [130, 2, 1.9] : [390, 4, 2.8];
    const period = 6,
      u = t % period,
      run = 1.5;
    let d = 0,
      moving = false;
    if (u < 0.5) [d, moving] = [0, false];
    else if (u < 2) [d, moving] = [speed * (u - 0.5), true];
    else if (u < 3.5) [d, moving] = [speed * run, false];
    else if (u < 5) [d, moving] = [speed * run - speed * (u - 3.5), true];
    const z = moving ? bob * Math.sin(2 * Math.PI * freq * u) : 0;
    return [move(FORWARD[0] * d, FORWARD[1] * d, FORWARD[2] * d + z), period];
  }
  if (name === 'turn') {
    const period = 4,
      u = t % period,
      turn = Math.PI;
    let a = 0;
    if (u < 0.25) a = 0;
    else if (u < 1.05) a = (turn * (u - 0.25)) / 0.8;
    else if (u < 2.25) a = turn;
    else if (u < 3.05) a = turn * (1 - (u - 2.25) / 0.8);
    return [yaw(a), period];
  }
  if (name === 'jump') {
    const period = 2.5,
      u = t % period,
      air = 0.8,
      height = 60;
    const z = u >= 0.5 && u < 0.5 + air ? ((4 * height * (u - 0.5)) / air) * (1 - (u - 0.5) / air) : 0;
    return [move(0, 0, z), period];
  }
  return [eye4(), 1];
}

/** The editor's ragdoll values (degrees, null = shared or native) as the calculator's profile (radians). */
export function simProfile(
  r: Ragdoll | null,
  rig: string,
  builtIn: (rig: string) => Ragdoll
): {motion: SimMotion; bodies: SimBody[]} {
  const values = r ?? builtIn(rig);
  const rad = Math.PI / 180;
  const m = values.motion;
  return {
    motion: {
      ...defaultSimMotion(),
      follow: m.follow,
      gravity: m.gravity,
      drag: m.drag,
      spin: m.spin,
      inertia: m.inertia,
      friction: m.friction ?? -1,
    },
    bodies: values.bodies.map(b => ({
      bone: b.bone,
      simulate: b.simulate,
      ...(b.drag !== null && {drag: b.drag}),
      ...(b.spin !== null && {spin: b.spin}),
      ...(b.gravity !== null && {gravity: b.gravity}),
      ...(b.inertia !== null && {inertia: b.inertia}),
      ...(b.friction !== null && {friction: b.friction}),
      ...(b.cone !== null && {cone: b.cone * rad}),
      ...(b.plane && {plane: [b.plane[0] * rad, b.plane[1] * rad] as [number, number]}),
      ...(b.twist && {twist: [b.twist[0] * rad, b.twist[1] * rad] as [number, number]}),
      ...(b.swingFrom && {swingFrom: b.swingFrom}),
    })),
  };
}

export class RagdollPreview {
  rag: RagdollData;
  floor: number | null;
  pose?: Map<string, M4>;
  scale: number;
  anchor: string;
  profile: {motion: SimMotion; bodies: SimBody[]};
  scenario: RagdollScenario = 'hold';
  speed = 1;
  playing = false;
  dragging = false;
  sim!: RagdollSim;
  anchorIndex = 0;
  start: M4 = eye4();
  held = new Map<string, M4>();
  hand: M4 = eye4();
  t = 0;
  /** The hand's velocity last step (game units / s). */
  handVelocity: V3 = [0, 0, 0];

  constructor(
    rag: RagdollData,
    opts: {
      pose?: Map<string, M4>;
      scale?: number;
      anchor?: string;
      profile?: {motion: SimMotion; bodies: SimBody[]};
      floor?: number | null;
    } = {}
  ) {
    this.rag = rag;
    this.floor = opts.floor ?? null;
    this.pose = opts.pose;
    this.scale = opts.scale ?? 1;
    this.anchor = opts.anchor || rag.bodies[0].node;
    this.profile = opts.profile ?? {motion: defaultSimMotion(), bodies: []};
    this.rebuild();
  }
  /** A new simulation from the start pose (after the anchor, pose, scale or a structural profile change). */
  rebuild() {
    const root = eye4();
    for (const e of [0, 5, 10]) root[e] *= this.scale;
    if (!this.rag.bodies.some(b => b.node.toLowerCase() === this.anchor.toLowerCase()))
      this.anchor = this.rag.bodies[0].node;
    this.sim = new RagdollSim(this.rag, {
      pose: this.pose,
      root,
      motion: this.profile.motion,
      bodies: this.profile.bodies,
      keyframed: [this.anchor],
      floor: this.floor,
      widenToStart: true,
    });
    this.anchorIndex = this.sim.body(this.anchor);
    this.start = this.sim.frame(this.anchorIndex);
    // Bodies kept out of physics ride the carry with the held body.
    const toStart = inv4(this.start);
    this.held = new Map(
      this.sim.names
        .map((name, i) => [name, i] as const)
        .filter(([, i]) => i !== this.anchorIndex && !this.sim.dynamic[i])
        .map(([name, i]) => [name, mul4(toStart, this.sim.frame(i))])
    );
    this.hand = this.start.slice();
    this.handVelocity = [0, 0, 0];
    this.t = 0;
  }
  /** New values apply to the running simulation; a changed simulate flag or swingFrom restarts it (true). */
  setProfile(profile: {motion: SimMotion; bodies: SimBody[]}) {
    this.profile = profile;
    if (this.sim.retune(profile.motion, profile.bodies)) return false;
    this.rebuild();
    return true;
  }
  setFloor(height: number | null) {
    this.floor = height;
    this.sim.floor = height;
  }
  setAnchor(name: string) {
    if (
      name.toLowerCase() !== this.anchor.toLowerCase() &&
      this.rag.bodies.some(b => b.node.toLowerCase() === name.toLowerCase())
    ) {
      this.anchor = name;
      this.rebuild();
    }
  }
  setPose(pose?: Map<string, M4>) {
    this.pose = pose;
    this.rebuild();
  }
  setScale(value: number) {
    this.scale = Math.max(0.1, value);
    this.rebuild();
  }
  setScenario(name: RagdollScenario, speed?: number) {
    this.scenario = name;
    if (speed !== undefined) this.speed = Math.max(0.1, speed);
    this.t = 0;
  }
  dragBegin() {
    this.dragging = true;
    this.playing = false;
  }
  dragTo(frame: M4) {
    this.hand = frame.slice();
  }
  dragEnd() {
    this.dragging = false;
  }
  /** Advance by dt real seconds (the scenario runs at `speed`). */
  step(dt: number) {
    dt = Math.max(0, dt);
    if (this.playing && !this.dragging) {
      this.t += dt * this.speed;
      const [offset] = scenarioOffset(this.scenario, this.t);
      this.hand = this.scenarioHand(offset);
    }
    const previous = this.sim.frame(this.anchorIndex);
    if (dt > 0) {
      const moved = sub(pos4(this.hand), pos4(previous));
      const velocity = norm(moved) <= TELEPORT ? scale(moved, 1 / dt) : this.handVelocity;
      // The game's follow share: part of each speed change reaches the bodies directly.
      if (this.sim.follow > 0) this.sim.addVelocity(scale(sub(velocity, this.handVelocity), this.sim.follow));
      this.handVelocity = velocity;
    }
    this.sim.setTarget(this.anchor, this.hand);
    for (const [name, relative] of this.held) this.sim.setTarget(name, mul4(this.hand, relative));
    return this.sim.step(dt);
  }
  private pending = 0;
  /** Advance by real seconds from a display loop: in whole 60 Hz steps (at most `maxSteps` a call), so the hand
   *  target, its velocity and the follow share change once per physics step. A display refresh faster than 60 Hz
   *  stepping the preview itself left most refreshes without a physics step while the hand still moved and the
   *  follow share was given again: ten times the jitter of HKX_Edit's 16 ms timer (11-04). Returns the steps taken. */
  advance(dt: number, maxSteps = 4) {
    this.pending = Math.min(this.pending + Math.max(0, dt), STEP * maxSteps);
    let steps = 0;
    while (this.pending >= STEP - 1e-9) {
      this.pending -= STEP;
      steps += this.step(STEP);
    }
    return steps;
  }
  private scenarioHand(offset: M4) {
    if (this.scenario === 'turn') {
      const pivot = sub(pos4(this.start), scale(FORWARD, 25));
      return mul4(mul4(mul4(move(...pivot), offset), move(-pivot[0], -pivot[1], -pivot[2])), this.start);
    }
    return mul4(offset, this.start);
  }
  nodeWorlds() {
    return this.sim.nodeWorlds(mul4(this.hand, inv4(this.start)));
  }
  /** [body A, body B, limit kind, degrees] the start pose opened, joints with a simulated body only. */
  widened(): [string, string, string, number][] {
    const sim = this.sim;
    const out: [string, string, string, number][] = [];
    for (const [name, kind, deg] of sim.widened) {
      const k = sim.ja.findIndex((a, j) => `${sim.names[a]}-${sim.names[sim.jb[j]]}` === name);
      if (k >= 0 && (sim.dynamic[sim.ja[k]] || sim.dynamic[sim.jb[k]]))
        out.push([sim.names[sim.ja[k]], sim.names[sim.jb[k]], kind, deg]);
    }
    return out;
  }
}

/** Node locals for a ragdoll from model-space bone matrices by name (an HKX frame); nodes without a bone keep their
 *  rest local under their parent's new world (ragdoll_preview.pose_from_model). */
export function poseFromModel(rag: RagdollData, worlds: Map<string, M4>): Map<string, M4> {
  const byName = new Map([...worlds].map(([k, v]) => [k.toLowerCase(), v]));
  const out = new Map<string, M4>(),
    world: M4[] = [];
  for (const n of rag.nodes) {
    const parent = n.parent >= 0 ? world[n.parent] : eye4();
    const w = byName.get(n.name.toLowerCase());
    if (w) {
      out.set(n.name, mul4(inv4(parent), w));
      world.push(w);
    } else world.push(mul4(parent, n.local));
  }
  return out;
}
