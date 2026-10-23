import type {Action, Effect} from './workspace.ts';

/** An ordinary action's clip-time functions (runtime 0.12.274, <Action><Effects><Do at>): they change the actor
 *  playing it, so they hold no target. Windows, costs and the shot are its own slots (Rotate, IFrame, HyperArmor,
 *  Cost, FireArrow) and ending a pair is a pair's. */
export const ordinaryEffectOps = [
  'hide',
  'show',
  'spell',
  'stateOn',
  'stateOff',
  'shake',
  'stopVelocity',
  'timeOn',
  'timeOff',
  'ragdoll',
];
/** A clip's time functions: a pair's (pair.effects) or an ordinary action's (config.effects). */
export const clipEffects = (a: Action): Effect[] => (a.pair ? a.pair.effects : (a.config.effects ?? []));
/** Replaces them; an ordinary action without any keeps no list. */
export function setClipEffects(a: Action, effects: Effect[]) {
  if (a.pair) a.pair.effects = effects;
  else if (effects.length) a.config.effects = effects;
  else delete a.config.effects;
}
