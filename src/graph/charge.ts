import type {Ref} from '../cards.ts';
import type {Workspace} from '../workspace.ts';

/** The HKX a destination plays: an action, or every action a condition card (and the cards it leads to) may pick. */
export function refActions(w: Workspace, ref: Ref | undefined, seen = new Set<string>()): string[] {
  if (!ref) return [];
  if ('action' in ref) return [ref.action];
  if (seen.has(ref.card)) return [];
  seen.add(ref.card);
  const c = w.cards.find(c => c.uid === ref.card);
  if (!c) return [];
  return [...c.rows.map(r => r.to), c.true, c.false].flatMap(r => refActions(w, r ?? null, seen));
}

/** The HKX that play while a charge's key is held (runtime ActionLinks, 10-31: a move transition and a charge end
 *  read that key): a looping HKX, one a hold start plays, and one an end or move transition of such an HKX plays.
 *  A charge end's destination comes after the charge. */
export function chargeActions(w: Workspace): Set<string> {
  const out = new Set<string>(w.actions.filter(a => a.config.loop).map(a => a.uid));
  for (const s of w.starts)
    if (s.mode === 'input' && s.press === 'hold') for (const u of refActions(w, s.to)) out.add(u);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of w.links) {
      if ((l.mode !== 'end' && l.mode !== 'move') || !out.has(l.from)) continue;
      for (const u of refActions(w, l.card ? {card: l.card} : l.to ? {action: l.to} : null))
        if (!out.has(u)) {
          out.add(u);
          grew = true;
        }
    }
  }
  return out;
}
