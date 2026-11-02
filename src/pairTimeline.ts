import {mark} from './model.ts';
import type {Mark} from './model.ts';
import type {Effect, Pair} from './workspace.ts';

export const pairTrackKeys = ['rotate', 'iframe', 'armor', 'time', 'cost'] as const;
export type PairTrackKey = (typeof pairTrackKeys)[number];
export type PairTrack = {
  enabled: boolean;
  from: Mark;
  until: Mark;
  role: string;
  stamina: number;
  magicka: number;
  health: number;
  /** The time track's multiplier and its real seconds to reach it and back (11-01); the others leave them. */
  factor: number;
  ease: number;
};
export type PairTimeline = Record<PairTrackKey, PairTrack>;
export const defaultPairTimeline = (): PairTimeline =>
  Object.fromEntries(
    pairTrackKeys.map(key => [
      key,
      {
        enabled: false,
        from: mark(key === 'cost' ? 0.05 : 0),
        until: mark(0.8),
        // The time scale is the player's: whichever role the player plays (11-01).
        role: key === 'time' ? 'player' : 'initiator',
        stamina: 0,
        magicka: 0,
        health: 0,
        factor: 0.5,
        ease: 0,
      },
    ])
  ) as PairTimeline;
const ops = {
  rotate: ['rotateOn', 'rotateOff'],
  iframe: ['iframeOn', 'iframeOff'],
  armor: ['armorOn', 'armorOff'],
  time: ['timeOn', 'timeOff'],
  cost: ['cost'],
} as const;

// Keep authored effects untouched; timeline tracks compile to clip-time effects (role = target, both left out).
export function pairTimelineEffects(pair: Pair): Effect[] {
  const result: Effect[] = [];
  const ids = new Set(pair.effects.map(e => e.id));
  for (const key of pairTrackKeys) {
    const t = pair.timeline[key];
    if (!t.enabled) continue;
    ops[key].forEach((op, index) => {
      const m = index ? t.until : t.from;
      let id = 'timeline_' + key + '_' + index;
      while (ids.has(id)) id += '_';
      ids.add(id);
      result.push({
        id,
        values: {
          op,
          ...(t.role && t.role !== 'both' ? {target: t.role} : {}),
          at: String(m.seconds),
          ...(key === 'cost'
            ? {stamina: String(t.stamina), magicka: String(t.magicka), health: String(t.health ?? 0)}
            : {}),
          ...(key === 'time' && !index ? {factor: String(t.factor), ...(t.ease ? {ease: String(t.ease)} : {})} : {}),
        },
      });
    });
  }
  return result;
}
