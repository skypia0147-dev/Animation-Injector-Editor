import type {QteNode, Outcome} from './qte.ts';
import {convergeUi, keyScale} from './qteConverge.ts';
import {keyCodes} from './keys.ts';
// The names the game shows (runtime QteMenu.cpp KeyLabel); any other key is shown by its code.
const shownNames: Record<number, string> = {
  18: 'E',
  16: 'Q',
  19: 'R',
  17: 'W',
  30: 'A',
  31: 'S',
  32: 'D',
  33: 'F',
  34: 'G',
  35: 'H',
  36: 'J',
  37: 'K',
  38: 'L',
  44: 'Z',
  45: 'X',
  46: 'C',
  47: 'V',
  48: 'B',
  49: 'N',
  50: 'M',
  20: 'T',
  21: 'Y',
  22: 'U',
  23: 'I',
  24: 'O',
  25: 'P',
  57: 'Space',
  28: 'Enter',
  256: 'LMB',
  257: 'RMB',
  258: 'MMB',
};
const codeOf = (key: string) => {
  if (/^code:\d+$/.test(key)) return Number(key.slice(5));
  const lower = key.toLowerCase();
  return Object.entries(keyCodes).find(([name]) => name.toLowerCase() === lower)?.[1] ?? 0;
};
/** A key's name in the QTE as the game shows it: Mouse1 is LMB, Tab is "Key 15", no key is ''. */
export const qteKeyName = (key: string) => {
  const code = key ? codeOf(key) : 0;
  return code ? (shownNames[code] ?? `Key ${code}`) : '';
};
// How a QTE shows its input key (runtime 0.12.246 ui/QteFace.h; keep the two in step).
// hint: the key's name under the widget and a hint line. circle: the key in the circle's middle, no text.
// single: a rapid press of one press is its key alone: no bar, no time line, no text, no result.
// converge: the converging lines show the key's name bare in the middle.
// A mouse button is named like any key (LMB, RMB, MMB) since runtime 0.12.258; it was drawn as a mouse before.
export type QteFaceMode = 'hint' | 'circle' | 'single' | 'converge';
export const qteFaceMode = (q: Pick<QteNode, 'type' | 'pressCount' | 'design'>): QteFaceMode =>
  (q.type ?? 'splitArc') === 'splitArc'
    ? q.design === 'converge'
      ? 'converge'
      : 'circle'
    : q.type === 'rapidPress' && (q.pressCount ?? 10) === 1
      ? 'single'
      : 'hint';
/** A one-press QTE's key is this much larger than the key inside the circle. */
export const singleScale = 1.4;
/** How long a one-press QTE plays its press. */
export const pressSeconds = 0.38;
export type QteLook = {scale: number; alpha: number; flash: number};
const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** The key at `t` seconds after the result (or waiting, with no outcome). */
export function qteLook(q: QteNode, outcome: Outcome | null, t: number): QteLook {
  if (!outcome) return {scale: 1, alpha: 1, flash: 0};
  if (qteFaceMode(q) === 'converge')
    return {scale: keyScale(q, outcome, t), alpha: convergeUi(q, outcome, t), flash: 0};
  if (qteFaceMode(q) === 'single') {
    if (outcome === 'failure') return {scale: 1, alpha: 0, flash: 0};
    if (q.reducedMotion) return {scale: 1, alpha: clamp(1 - t / 0.25), flash: 0};
    const scale = t < 0.06 ? 1 - 0.14 * (t / 0.06) : t < 0.16 ? 0.86 + 0.2 * ((t - 0.06) / 0.1) : 1.06;
    const alpha = t < 0.16 ? 1 : clamp(1 - (t - 0.16) / (pressSeconds - 0.16));
    return {scale, alpha, flash: 0.55 * clamp(1 - t / 0.2)};
  }
  const k = q.reducedMotion ? 0.28 : clamp(t / Math.max(0.001, (q.feedback ?? 1.35) * 0.85));
  return {scale: 1, alpha: 1 - k, flash: 0};
}
