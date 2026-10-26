import type {Workspace} from '../workspace.ts';
import {flatGraph} from './flat.ts';
import {ruleNode} from './sharing.ts';
import {layoutKey} from './projection.ts';
import {refAction, type Ref} from '../cards.ts';

/** Delete an HKX card (an action) with what is its own: its transitions (from it or to it), its items. What went to it
 *  leads nowhere now: starts, card rows, Trues, Falses and QTE results wait for another destination; QTEs it started
 *  stay, unattached. `_keep` is unused (format 6 keeps no detached items). */
export function retirePlayback(w: Workspace, owner: string, _keep = true): Workspace {
  const action = w.actions.find(a => a.uid === owner);
  if (!action) return w;
  const graph = flatGraph(w),
    links = new Set(w.links.filter(l => l.from === owner || l.to === owner).map(l => l.id));
  const owned = (id: string) =>
    id === owner ||
    id.startsWith(`anim:${owner}:`) ||
    id.startsWith(`start:${owner}|`) ||
    id.startsWith(`notify:${owner}|`) ||
    [...links].some(l => id === `transition:${l}`);
  const next = structuredClone(w);
  const gone = (r: Ref): Ref => (refAction(r) === owner ? null : r);
  for (const s of next.starts) s.to = gone(s.to);
  for (const c of next.cards) {
    for (const r of c.rows) r.to = gone(r.to);
    if (c.true !== undefined) c.true = gone(c.true);
    c.false = gone(c.false);
  }
  for (const q of next.qtes ?? []) {
    if (q.owner === owner) {
      q.owner = '';
      q.step = '';
    }
    for (const r of Object.values(q.results)) {
      if (r.to === owner) {
        r.to = '';
        r.mode = 'continue';
      }
      if (r.partnerTo === owner) r.partnerTo = '';
    }
  }
  next.actions = next.actions.filter(a => a.uid !== owner);
  next.order = next.order.filter(u => u !== owner);
  next.links = next.links.filter(l => !links.has(l.id));
  for (const l of next.links) if (l.partnerTo === owner) l.partnerTo = '';
  next.parameters = next.parameters.filter(p => p.action !== owner);
  next.sharedRules = next.sharedRules
    ?.map(g => ({...g, members: g.members.filter(m => !owned(ruleNode(g.kind, m, w)))}))
    .filter(g => g.members.length > 1);
  for (const a of next.actions) if (a.pair?.carry?.putdownAction === owner) a.pair.carry.putdownAction = '';
  const layout = next.layout[layoutKey('root')];
  if (layout) for (const node of graph.nodes.filter(n => owned(n.id))) delete layout[layoutKey(node.id)];
  return next;
}
