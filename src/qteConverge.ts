import type {QteNode, Outcome} from './qte.ts';
import {qteTarget} from './qtePreview.ts';
// The converging-lines look of a timing (splitArc) QTE: runtime 0.12.246 ui/QteConverge.h (keep the two in step).
// Two hairlines run from the screen's edges and meet in the middle at the target time. Sizes are pixels at 1080 lines.
type Timed = Pick<QteNode, 'speed' | 'successWindow' | 'perfectWindow'>;
type Shown = Pick<QteNode, 'feedback' | 'delay' | 'reducedMotion'>;
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOut5 = (t: number) => 1 - Math.pow(1 - clamp01(t), 5);
export const easeIn = (t: number) => clamp01(t) ** 2;
/** Seconds: the whole run (2.4 s at speed 1), the approach (until the lines meet), the windows either side. */
export function convergeTiming(q: Timed) {
  const total = 2.4 / Math.max(0.1, q.speed);
  return {total, approach: qteTarget * total, perfect: q.perfectWindow * total, success: q.successWindow * total};
}
/** The speed whose lines meet after `seconds`. */
export const speedForApproach = (seconds: number) => Math.min(10, Math.max(0.1, (qteTarget * 2.4) / seconds));
/** How far the lines have come at `elapsed`: 0 at the edges, 1 met in the middle. */
export const convergeHead = (q: Timed, elapsed: number) => elapsed / convergeTiming(q).approach;
/** Converging lines have crossed once the success window is over. */
export const convergeMissed = (q: Timed, progress: number) => progress > qteTarget + q.successWindow;
export const quality = (o: Outcome) => (o === 'perfect' ? 1 : 0.62);
/** The mockup's bloom makes a broad soft light about this much brighter; the game (and this preview) draws such
 *  lights this much brighter instead of blurring. */
export const glowGain = 2.2;
/** The whole look's opacity: full while running, gone over the last .45 s of the result's time on screen. */
export function convergeUi(q: Shown, outcome: Outcome | null, t: number) {
  if (!outcome) return 1;
  const shown = Math.max(q.feedback ?? 1.35, q.delay);
  return 1 - clamp01((t - (shown - 0.45)) / 0.45);
}
/** Darkening around the band (in over the first .3 s of the run). */
export const convergeFocus = (q: Shown, outcome: Outcome | null, t: number, elapsed: number) =>
  0.75 * convergeUi(q, outcome, t) * clamp01(elapsed / 0.3);
/** The brief white lift on a success. */
export const convergeFlash = (outcome: Outcome | null, t: number) =>
  !outcome || outcome === 'failure' ? 0 : 0.1 * quality(outcome) * Math.exp(-t * 10);
/** A miss drains the world's colour: in by .25 s, back by 2.1 s (peak .9). */
export const desatSeconds = 2.1;
export const convergeDesat = (t: number) =>
  t < 0 || t >= desatSeconds ? 0 : easeOut(t / 0.25) * (1 - easeOut((t - 1.5) / 0.6)) * 0.9;
/** How far each line starts from the middle: the farther screen edge, in drawing units. */
export const convergeReach = (width: number, x: number, unit: number) => (unit > 0 ? Math.max(x, width - x) / unit : 0);
export const keyColor = (o: Outcome | null) => (!o ? '#F2E8D5' : o === 'failure' ? '#BEA096' : '#FFD696');
export function keyScale(q: Shown, outcome: Outcome | null, t: number) {
  if (q.reducedMotion || !outcome || outcome === 'failure') return 1;
  return 1 - 0.12 * Math.sin(clamp01(t / 0.18) * Math.PI);
}
/** A stable random number in [0, 1) for particle `b` of session `a` (the runtime's integer hash). */
export function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A particle under drag k and gravity g (down positive) after t seconds, in closed form. */
export function fly(x: number, y: number, vx: number, vy: number, k: number, g: number, t: number) {
  const e = Math.exp(-k * t),
    f = (1 - e) / k;
  return {x: x + vx * f, y: y + vy * f + (g / k) * (t - f), vx: vx * e, vy: vy * e + (g / k) * (1 - e)};
}
export const sparkCount = (o: Outcome) => (o === 'perfect' ? 64 : 26);
export function sparkOf(session: number, i: number, o: Outcome) {
  const s = session >>> 0;
  const side = hash(s, i * 4) < 0.5 ? -1 : 1;
  const speed = (250 + hash(s, i * 4 + 1) * 1300) * (o === 'perfect' ? 1 : 0.6);
  return {vx: side * speed, vy: (hash(s, i * 4 + 2) - 0.5) * 170, life: 0.35 + hash(s, i * 4 + 3) * 0.7};
}
export const ashCount = 240;
export function ashOf(session: number, i: number) {
  const s = ((session >>> 0) ^ 0x9e3779b9) >>> 0;
  const back = Math.pow(hash(s, i * 7), 1.8);
  return {
    side: i % 2 ? 1 : -1,
    back,
    y: (hash(s, i * 7 + 5) - 0.5) * 3,
    vx: (hash(s, i * 7 + 1) - 0.5) * 40,
    vy: -(8 + hash(s, i * 7 + 2) * 50),
    life: 1 + hash(s, i * 7 + 3) * 1.3,
    wobble: hash(s, i * 7 + 4) * 6,
  };
}
