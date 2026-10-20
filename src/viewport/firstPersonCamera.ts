// The first-person camera preset (view.ts, runtime 0.12.225): the game's first-person camera follows the
// first-person skeleton's camera bone (FirstPersonState), so the preview looks through that bone. At
// rest the bone faces the actor's forward (+Y) with +Z up; a clip's camera shake is its motion.
type Vec = [number, number, number];

/** Game space (Z up) to the viewport scene (Y up): the scene's `common` group rotation. */
export const toScene = ([x, y, z]: Vec): Vec => [x, z, -y];
const normalize = ([x, y, z]: Vec): Vec => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};
const cross = ([a, b, c]: Vec, [x, y, z]: Vec): Vec => [b * z - c * y, c * x - a * z, a * y - b * x];
/** Rodrigues' rotation of `v` about the unit `axis` (right-handed, radians). */
function rotate(v: Vec, axis: Vec, angle: number): Vec {
  const cos = Math.cos(angle),
    sin = Math.sin(angle),
    [cx, cy, cz] = cross(axis, v),
    dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return [0, 1, 2].map(i => v[i] * cos + [cx, cy, cz][i] * sin + axis[i] * dot * (1 - cos)) as Vec;
}

/** Where the camera is and where it looks, in scene space, from the bone's row-major world matrix.
 *  `look` turns from the bone's own direction: yaw about its up (positive = left), then pitch
 *  about the turned right (positive = up). */
export function firstPersonView(
  world: readonly number[],
  look: {yaw: number; pitch: number}
): {position: Vec; forward: Vec; up: Vec} {
  const up = normalize(toScene([world[2], world[6], world[10]])),
    turned = rotate(normalize(toScene([world[1], world[5], world[9]])), up, look.yaw),
    right = normalize(cross(turned, up));
  return {
    position: toScene([world[3], world[7], world[11]]),
    forward: normalize(rotate(turned, right, look.pitch)),
    up: normalize(rotate(up, right, look.pitch)),
  };
}
