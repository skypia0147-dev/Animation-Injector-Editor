// Small fixed-size linear algebra for the ragdoll calculator (ragdollSim/sim.ts). Row-major: a 3x3 is m[r*3+c], a
// 4x4 m[r*4+c]; vectors are columns. Quaternions are [w, x, y, z]. Each function mirrors the numpy expression of
// HKX_Edit's ragdoll_sim.py it replaces.
export type V3 = [number, number, number];
export type M3 = number[];
export type M4 = number[];
export type Q = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: V3) => Math.sqrt(dot(a, a));
/** _unit: a vector shorter than 1e-12 stays as it is. */
export const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [a[0], a[1], a[2]];
};
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const eye3 = (): M3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const zero3 = (): M3 => [0, 0, 0, 0, 0, 0, 0, 0, 0];
export function mul3(a: M3, b: M3): M3 {
  const o = zero3();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export const mulV3 = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const transpose3 = (m: M3): M3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export const det3 = (m: M3) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
/** The inverse, or null when singular (np.linalg.inv raises). */
export function inv3(m: M3): M3 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || d === 0) return null;
  const i = 1 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * i,
    (m[2] * m[7] - m[1] * m[8]) * i,
    (m[1] * m[5] - m[2] * m[4]) * i,
    (m[5] * m[6] - m[3] * m[8]) * i,
    (m[0] * m[8] - m[2] * m[6]) * i,
    (m[2] * m[3] - m[0] * m[5]) * i,
    (m[3] * m[7] - m[4] * m[6]) * i,
    (m[1] * m[6] - m[0] * m[7]) * i,
    (m[0] * m[4] - m[1] * m[3]) * i,
  ];
}
export const skew = (r: V3): M3 => [0, -r[2], r[1], r[2], 0, -r[0], -r[1], r[0], 0];

export const eye4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  return o;
}
/** General 4x4 inverse (np.linalg.inv). */
export function inv4(m: M4): M4 {
  const a = m.slice(),
    o = eye4();
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r * 4 + c]) > Math.abs(a[p * 4 + c])) p = r;
    if (p !== c)
      for (let k = 0; k < 4; k++) {
        [a[c * 4 + k], a[p * 4 + k]] = [a[p * 4 + k], a[c * 4 + k]];
        [o[c * 4 + k], o[p * 4 + k]] = [o[p * 4 + k], o[c * 4 + k]];
      }
    const d = a[c * 4 + c];
    for (let k = 0; k < 4; k++) {
      a[c * 4 + k] /= d;
      o[c * 4 + k] /= d;
    }
    for (let r = 0; r < 4; r++)
      if (r !== c) {
        const f = a[r * 4 + c];
        if (f !== 0)
          for (let k = 0; k < 4; k++) {
            a[r * 4 + k] -= f * a[c * 4 + k];
            o[r * 4 + k] -= f * o[c * 4 + k];
          }
      }
  }
  return o;
}
export const rot4 = (m: M4): M3 => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
export const pos4 = (m: M4): V3 => [m[3], m[7], m[11]];
export function frame4(r: M3, t: V3): M4 {
  return [r[0], r[1], r[2], t[0], r[3], r[4], r[5], t[1], r[6], r[7], r[8], t[2], 0, 0, 0, 1];
}
export const columnNorm = (m: M4, c: number) => Math.hypot(m[c], m[4 + c], m[8 + c]);
/** m with the columns of its 3x3 normalized (ragdoll_data._unscaled). */
export function unscaled(m: M4): M4 {
  const o = m.slice();
  for (let c = 0; c < 3; c++) {
    const n = columnNorm(o, c);
    if (n > 1e-9) for (let r = 0; r < 3; r++) o[r * 4 + c] /= n;
  }
  return o;
}

export function quatMat(q: Q): M3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}
export function matQuat(m: M3): Q {
  const t = m[0] + m[4] + m[8];
  let q: Q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [0.25 * s, (m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [(m[7] - m[5]) / s, 0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[2] - m[6]) / s, (m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[3] - m[1]) / s, (m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s];
  }
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
/** Rotation vector (axis * angle) of a rotation (_rotvec). */
export function rotvec(m: M3): V3 {
  const c = clamp((m[0] + m[4] + m[8] - 1) * 0.5, -1, 1);
  const ang = Math.acos(c);
  const s = Math.sin(ang);
  const k = s > 1e-6 ? ang / (2 * s) : 0.5;
  return [(m[7] - m[5]) * k, (m[2] - m[6]) * k, (m[3] - m[1]) * k];
}
/** Blend two rigid frames: position lerp, rotation slerp (_interp). */
export function interp(a: M4, b: M4, f: number): M4 {
  const qa = matQuat(rot4(a));
  let qb = matQuat(rot4(b));
  let d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (d < 0) {
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    d = -d;
  }
  d = clamp(d, -1, 1);
  let q: Q;
  if (d > 0.9995) q = qa.map((v, i) => v + f * (qb[i] - v)) as Q;
  else {
    const th = Math.acos(d),
      sa = Math.sin((1 - f) * th),
      sb = Math.sin(f * th),
      st = Math.sin(th);
    q = qa.map((v, i) => (sa * v + sb * qb[i]) / st) as Q;
  }
  const n = Math.hypot(...q);
  q = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  const pa = pos4(a),
    pb = pos4(b);
  return frame4(quatMat(q), [pa[0] + f * (pb[0] - pa[0]), pa[1] + f * (pb[1] - pa[1]), pa[2] + f * (pb[2] - pa[2])]);
}
/** The unit eigenvector of the largest eigenvalue of a symmetric 3x3 (cyclic Jacobi): the principal axis numpy's
 *  SVD gives for a point cloud's covariance, up to sign. */
export function principalAxis(s: M3): V3 {
  const a = s.slice(),
    v = eye3();
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-24) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1),
        sn = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p],
          akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - sn * akq;
        a[k * 3 + q] = sn * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k],
          aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - sn * aqk;
        a[q * 3 + k] = sn * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p],
          vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - sn * vkq;
        v[k * 3 + q] = sn * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 3; k++) if (a[k * 4] > a[best * 4]) best = k;
  return unit([v[best], v[3 + best], v[6 + best]]);
}
