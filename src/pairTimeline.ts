import {mark} from './model.ts';
import type {Mark} from './model.ts';
import type {Effect, Pair} from './workspace.ts';

export const pairTrackKeys = ['rotate', 'iframe', 'armor', 'cost'] as const;
export type PairTrackKey = (typeof pairTrackKeys)[number];
export type PairTrack = {
  enabled: boolean;
  from: Mark;
  until: Mark;
  role: string;
  source: string;
  stamina: number;
  magicka: number;
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
        role: 'initiator',
        // Kept for older projects' shape; a clip time has no sender to filter (runtime 0.12.275).
        source: 'any',
        stamina: 0,
        magicka: 0,
      },
    ])
  ) as PairTimeline;
const ops = {
  rotate: ['rotateOn', 'rotateOff'],
  iframe: ['iframeOn', 'iframeOff'],
  armor: ['armorOn', 'armorOff'],
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
          ...(key === 'cost' ? {stamina: String(t.stamina), magicka: String(t.magicka)} : {}),
        },
      });
    });
  }
  return result;
}
