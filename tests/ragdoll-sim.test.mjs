import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ragdollFromJson} from '../src/ragdollSim/data.ts';
import {RagdollPreview} from '../src/ragdollSim/preview.ts';
import {defaultSimMotion} from '../src/ragdollSim/sim.ts';

// The editor's calculator against HKX_Edit's Python one (tools/ragdoll-golden.py): the same carry previews, body
// positions every 0.1 s for 1.5 s. Both are double precision; the reference keeps 4 decimals (11-04: largest difference
// 0.0001; one Jacobi iteration fewer already moves a body 0.017 units).
const golden = JSON.parse(readFileSync('tests/fixtures/ragdoll-golden.json', 'utf8'));
const rig = id => ragdollFromJson(JSON.parse(readFileSync(`src/ragdollSim/rigs/${id}.json`, 'utf8')));
const RAD = Math.PI / 180;
const profile = (motion, bodies) => ({
  motion: {...defaultSimMotion(), ...motion},
  bodies: bodies.map(b => ({
    ...b,
    simulate: b.simulate ?? true,
    ...(b.cone !== undefined && {cone: b.cone * RAD}),
    ...(b.plane && {plane: b.plane.map(v => v * RAD)}),
    ...(b.twist && {twist: b.twist.map(v => v * RAD)}),
  })),
});

for (const c of golden.cases)
  test(`ragdoll calculator matches the Python one: ${c.name}`, () => {
    const preview = new RagdollPreview(rig(c.rig), {
      scale: c.scale,
      anchor: c.anchor,
      profile: profile(c.motion, c.bodies),
      floor: c.floor,
    });
    assert.deepEqual(preview.sim.names, c.names);
    assert.deepEqual(preview.sim.dynamic, c.dynamic);
    assert.deepEqual(
      preview.widened().map(([a, b, kind, deg]) => [a, b, kind, Math.round(deg * 1000) / 1000]),
      c.widened
    );
    preview.setScenario(c.scenario);
    preview.playing = true;
    let worst = 0,
      at = '';
    for (let step = 1; step <= golden.steps; step++) {
      preview.step(golden.dt);
      if (step % golden.every) continue;
      const expected = c.frames[step / golden.every - 1];
      preview.sim.x.forEach((x, i) => {
        const d = Math.hypot(x[0] - expected[i][0], x[1] - expected[i][1], x[2] - expected[i][2]);
        if (d > worst) [worst, at] = [d, `${c.names[i]} @ step ${step}`];
      });
    }
    assert.ok(worst < 0.005, `largest difference ${worst.toFixed(4)} units at ${at}`);
  });

// A display refresh faster than 60 Hz must not shake the carry (11-04: stepping the preview per 144 Hz frame gave
// ten times the jitter of HKX_Edit's 16 ms timer); advance() keeps whole physics steps.
test('the preview steps whole 60 Hz steps whatever the display rate', () => {
  const motion = {...defaultSimMotion(), follow: 1, gravity: 4, drag: 10, spin: 10, inertia: 10};
  const bodies = ['NPC COM [COM ]', 'NPC Spine [Spn0]', 'NPC Spine1 [Spn1]', 'NPC Spine2 [Spn2]'].map(bone => ({
    bone,
    simulate: false,
  }));
  const jitter = (frames, rate) => {
    const p = new RagdollPreview(rig('character'), {anchor: 'NPC COM [COM ]', profile: {motion, bodies}});
    p.setScenario('walk');
    p.playing = true;
    const foot = p.sim.body('NPC L Foot [Lft ]'),
      xs = [];
    for (let i = 0; i < frames; i++) if (p.advance(1 / rate)) xs.push([...p.sim.x[foot]]);
    let sum = 0;
    for (let i = 2; i < xs.length; i++)
      for (let k = 0; k < 3; k++) sum += Math.abs(xs[i][k] - 2 * xs[i - 1][k] + xs[i - 2][k]);
    return {steps: xs.length, jerk: sum / xs.length};
  };
  const at60 = jitter(360, 60),
    at144 = jitter(864, 144);
  assert.ok(Math.abs(at144.steps - at60.steps) <= 1, `${at60.steps} vs ${at144.steps} steps`);
  assert.ok(at144.jerk < at60.jerk * 1.2, `jerk ${at144.jerk.toFixed(3)} at 144 Hz, ${at60.jerk.toFixed(3)} at 60 Hz`);
});

// A simulate=false body below a simulated one welds to the body above (user decision 11-04, the runtime's
// PartialRagdollPolicy::WeldedToParent): it simulates, keeps its start angle to its parent and so moves with it.
test('a held body below a simulated one moves with its parent at its start angle', () => {
  const motion = {...defaultSimMotion(), follow: 1, gravity: 4, drag: 10, spin: 10, inertia: 10};
  // The Grapple lift's file of 11-04 20:58: Spine2 simulated, the left upper arm held under it.
  const off = ['NPC COM [COM ]', 'NPC Spine [Spn0]', 'NPC Spine1 [Spn1]', 'NPC L UpperArm [LUar]'];
  const p = new RagdollPreview(rig('character'), {
    anchor: 'NPC COM [COM ]',
    profile: {motion, bodies: off.map(bone => ({bone, simulate: false}))},
  });
  const sim = p.sim;
  const arm = sim.body('NPC L UpperArm [LUar]'),
    spine2 = sim.body('NPC Spine2 [Spn2]'),
    spine1 = sim.body('NPC Spine1 [Spn1]');
  assert.ok(sim.welded[arm] && sim.dynamic[arm], 'the arm under the simulated Spine2 welds');
  assert.ok(!sim.welded[spine1] && !sim.dynamic[spine1], 'a held body with only held bodies above stays held');
  const axesIn = () => {
    const a = sim.frame(spine2),
      b = sim.frame(arm);
    const col = (m, c) => [m[c], m[4 + c], m[8 + c]];
    return [0, 1, 2].map(c => [0, 1, 2].map(k => col(a, k).reduce((s, v, i) => s + v * col(b, c)[i], 0)));
  };
  const start = axesIn();
  const startSpine = sim.frame(spine2);
  p.setScenario('walk');
  p.playing = true;
  for (let i = 0; i < 120; i++) p.step(1 / 60);
  const moved = Math.hypot(...[3, 7, 11].map(k => sim.frame(spine2)[k] - startSpine[k]));
  const now = axesIn();
  const drift = Math.max(...now.flatMap((r, c) => r.map((v, k) => Math.abs(v - start[c][k]))));
  assert.ok(moved > 1, `Spine2 swings (${moved.toFixed(2)})`);
  assert.ok(drift < 0.06, `the arm keeps its angle to Spine2 (drift ${drift.toFixed(3)})`);
});
