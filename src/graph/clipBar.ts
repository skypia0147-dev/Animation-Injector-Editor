import type {Mark} from '../model.ts';
import {fmt} from './hkxMoments.ts';
import {tr} from '../i18n/korean.ts';

// The one-line clip bar (docs/mockup-clip-bar): a moment or a window on the clip, its value written at the end of the
// line. A time is seconds from the clip's start, or counted from the end: {end: 0} is 「끝」, an older {end: 0.2} stays
// until it is moved while the clip's length is known. There is no 「끝나기 전」 to choose any more.

export type BarTime = number | {end: number};
export const atEnd: BarTime = {end: 0};
/** How close (seconds) a time must be to the clip's length to be 「끝」. */
const endSlack = 0.005;

export const isEnd = (t: BarTime) => typeof t !== 'number' && t.end <= endSlack;
/** Seconds from the start; an end-relative time needs the clip's length. */
export function barSeconds(t: BarTime, length?: number): number | undefined {
  if (typeof t === 'number') return t;
  return length === undefined ? undefined : Math.max(0, length - t.end);
}
export function barText(t: BarTime): string {
  if (typeof t === 'number') return fmt(t) + tr('초');
  return isEnd(t) ? tr('끝') : tr('끝') + ' − ' + fmt(t.end) + tr('초');
}
/** A dragged or typed time: at the clip's length it is 「끝」. */
export function settle(t: number, length?: number): BarTime {
  return length !== undefined && t >= length - endSlack ? atEnd : Math.round(Math.max(0, t) * 100) / 100;
}
/** Draws to the start, the end and the HKX's annotation times within `near` seconds; else to the hundredth. */
export function snapTime(t: number, length: number, points: number[], near: number): number {
  let best: number | undefined;
  for (const p of [0, length, ...points])
    if (Math.abs(t - p) <= near && (best === undefined || Math.abs(t - p) < Math.abs(t - best))) best = p;
  return best ?? Math.round(Math.min(length, Math.max(0, t)) * 100) / 100;
}
/** What a typed value means: seconds, or 「끝」/end. Anything else is not a time. */
export function readTyped(text: string): BarTime | undefined {
  const s = text.trim().replace(/초$/, '').trim();
  if (s === tr('끝') || s.toLowerCase() === 'end') return atEnd;
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : undefined;
}

// ── Marks ───────────────────────────────────────────────────────────────────────────────────────
/** A clip mark (seconds from the start, or before the end) as a bar time. */
export const markToBar = (m: Mark): BarTime => (m.basis === 'end' ? {end: m.seconds} : m.seconds);
/** A bar time back into the mark: a clip time, never an event; 「끝」 is the end itself. */
export function barToMark(m: Mark, t: BarTime): Mark {
  const base: Mark = {...m, event: '', fallback: false, fallbackBasis: 'seconds'};
  if (typeof t === 'number') return {...base, basis: 'seconds', seconds: t};
  return {...base, basis: 'end', seconds: isEnd(t) ? 0 : t.end};
}
/** The end trigger keeps 0.05 s before the clip's end when it sits at 「끝」 (the runtime's default). */
export const exitSlack = 0.05;
export const exitToBar = (m: Mark): BarTime => (m.seconds <= exitSlack + endSlack ? atEnd : {end: m.seconds});
/** An end trigger is always counted from the end: a time from the start needs the clip's length. */
export function barToExit(m: Mark, t: BarTime, length?: number): Mark | undefined {
  const base: Mark = {...m, basis: 'end', event: '', fallback: false, fallbackBasis: 'end'};
  if (typeof t !== 'number') return {...base, seconds: isEnd(t) ? exitSlack : Math.max(exitSlack, t.end)};
  if (length === undefined) return undefined;
  return {...base, seconds: Math.max(exitSlack, Math.round((length - t) * 100) / 100)};
}
/** A close that the model keeps counted from the end (an HKX's key detection window): a time from the start needs the
 *  clip's length. */
export function barToEndMark(m: Mark, t: BarTime, length?: number): Mark | undefined {
  const base: Mark = {...m, basis: 'end', event: '', fallback: false, fallbackBasis: 'end'};
  if (typeof t !== 'number') return {...base, seconds: isEnd(t) ? 0 : t.end};
  if (length === undefined) return undefined;
  return {...base, seconds: Math.max(0, Math.round((length - t) * 100) / 100)};
}
/** A clip-time function's or a point's seconds: 「끝」 is the clip's length (or stays where it was if unknown). */
export const barToSeconds = (t: BarTime, length: number | undefined, keep: number) =>
  typeof t === 'number' ? t : (barSeconds(t, length) ?? keep);
