import type {Workspace} from '../workspace.ts';

// An HKX card's start and end blends (XML format 6: <Action enter>, <Exit blend>): items of the card, whose node ids
// are the card's blendIn and blendOut (graph/flat.ts).
export const animId = (action: string, local: string) => `anim:${action}:|${local}`;

/** The action and the blend (enter or exit) a blend item's id names. */
export function blendOf(w: Workspace, id: string): {action: string; kind: 'enter' | 'exit'} | undefined {
  const m = /^anim:([^:]+):\|(blendIn|blendOut)$/.exec(id);
  if (!m || !w.actions.some(a => a.uid === m[1])) return;
  return {action: m[1], kind: m[2] === 'blendIn' ? 'enter' : 'exit'};
}
/** A blend item's time in seconds. */
export function blendSeconds(w: Workspace, id: string): number | undefined {
  const b = blendOf(w, id);
  const a = b && w.actions.find(a => a.uid === b.action);
  return a ? (b!.kind === 'enter' ? a.config.enterBlend : a.config.exitBlend) : undefined;
}
/** Set a blend item's time (0~5 s). */
export function editBlend(w: Workspace, id: string, patch: {seconds: number}): Workspace {
  const b = blendOf(w, id);
  if (!b) return w;
  const seconds = Math.min(5, Math.max(0, patch.seconds));
  return {
    ...w,
    actions: w.actions.map(a =>
      a.uid === b.action
        ? {...a, config: {...a.config, ...(b.kind === 'enter' ? {enterBlend: seconds} : {exitBlend: seconds})}}
        : a
    ),
  };
}
