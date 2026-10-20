// When a canvas card draws again. Cards read the document through a context that keeps one identity (the
// latest values, see FlatGraph), so a document change alone redraws none of them; each card redraws when its
// own inputs change:
//   - its node data or its item list (both keep their objects while equal, graph/renderCache.ts)
//   - its action's version: an edit confined to actions bumps the versions of the actions it changed
//   - the epoch: any other change (project settings, links, registry, drafts, an action's name, a carry, an
//     action added, removed or moved, the language) bumps it and every card draws
//   - the selection, when it enters or leaves the card
// The rendered document shares unchanged parts with the previous one (WorkspaceApp), so "changed" is identity.
import type {Workspace} from '../workspace.ts';

/** The actions an edit changed when nothing else did, or null when the change reaches past them. */
export function localChanges(previous: Workspace, next: Workspace): string[] | null {
  const a = previous as Record<string, unknown>,
    b = next as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (key !== 'actions' && a[key] !== b[key]) return null;
  if (previous.actions.length !== next.actions.length) return null;
  const changed: string[] = [];
  previous.actions.forEach((before, i) => {
    const after = next.actions[i];
    if (before !== after) changed.push(after.uid);
  });
  for (const uid of changed) {
    const before = previous.actions.find(x => x.uid === uid),
      after = next.actions.find(x => x.uid === uid)!;
    // Other cards show these: names in pickers and summaries, the carry that fixes its putdown in third person.
    if (
      !before ||
      before.config.name !== after.config.name ||
      before.config.actionId !== after.config.actionId ||
      before.pair?.carry !== after.pair?.carry
    )
      return null;
  }
  return changed;
}

export type GateState = {document: Workspace | null; shared: unknown[]; epoch: number; versions: Map<string, number>};
export const gateState = (): GateState => ({document: null, shared: [], epoch: 0, versions: new Map()});
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
/** Advances the state to `next`. `shared` holds what else every card depends on (the language, the registry
 *  and library views): any of them changing is a change for every card. */
export function advanceGate(
  state: GateState,
  next: Workspace,
  shared: unknown[]
): {epoch: number; versions: Map<string, number>} {
  if (state.document !== next || !same(state.shared, shared)) {
    const local = state.document && same(state.shared, shared) ? localChanges(state.document, next) : null;
    if (local) for (const uid of local) state.versions.set(uid, (state.versions.get(uid) ?? 0) + 1);
    else state.epoch++;
    state.document = next;
    state.shared = shared;
  }
  return {epoch: state.epoch, versions: new Map(state.versions)};
}
