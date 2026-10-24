import type {Workspace} from '../workspace.ts';
import {flatGraph, type FlatNode} from './flat.ts';
import {pasteNodes} from './clipboard.ts';
import {blendNodes} from './blends.ts';
import {ruleNode} from './sharing.ts';
import {layoutKey} from './projection.ts';
import {handOverFollowed} from './conditionBinding.ts';

/** Retire the runtime owner, retaining independently editable definitions as drafts. */
export function retirePlayback(w: Workspace, owner: string, preserveFeatures = true): Workspace {
  w = handOverFollowed(w, owner);
  const action = w.actions.find(a => a.uid === owner);
  if (!action) return w;
  const graph = flatGraph(w),
    links = new Set(w.links.filter(l => l.from === owner || l.to === owner).map(l => l.id));
  const owned = (id: string) =>
    id === owner ||
    id.startsWith(`anim:${owner}:`) ||
    id.startsWith(`start:${owner}|`) ||
    id.startsWith(`transition:${owner}:`) ||
    id.startsWith(`notify:${owner}|`) ||
    id.startsWith(`flow:${owner}:`) ||
    id === `conditionTable:${owner}` ||
    id.startsWith(`blend:${owner}:`) ||
    [...links].some(l => id.startsWith(`link:${l}|`) || id === `blend:link:${l}`);
  const replacements = new Map<string, string>();
  // Shared definitions survive on their other playback paths; do not duplicate them.
  for (const group of w.sharedRules ?? []) {
    const ids = group.members.map(m => ruleNode(group.kind, m, w));
    const survivor = ids.find(id => !owned(id));
    if (survivor) for (const id of ids.filter(owned)) replacements.set(id, survivor);
  }
  let next = structuredClone(w);
  const preserve = (node: FlatNode) => {
    const result = pasteNodes(
      next,
      {format: 'ai-nodes-1', workspace: w, graph: {nodes: [node], edges: []}},
      node.position,
      owner
    );
    next = result.workspace;
    const id = result.ids[0],
      draft = next.drafts!.find(d => d.id === id)!;
    draft.owner = '';
    // Start scope includes actor/on-key-up semantics beyond the displayed key.
    if (node.scope.kind === 'start' && ['keyInput', 'markerReceive'].includes(node.kind))
      draft.value.config.start = structuredClone(action.config.start);
    if (node.kind === 'carry' && draft.value.pair?.carry && action.pair?.carry)
      draft.value.pair.carry.putdownAction = action.pair.carry.putdownAction;
    replacements.set(node.id, id);
    return draft;
  };
  for (const node of graph.nodes) {
    if (
      !owned(node.id) ||
      replacements.has(node.id) ||
      ['state', 'hkxPlay', 'findPartner', 'pairedPlay', 'blend', 'result', 'conditionBranch', 'entry'].includes(
        node.kind
      )
    )
      continue;
    if (!preserveFeatures && !['keyInput', 'markerReceive', 'comment'].includes(node.kind)) continue;
    if (node.kind === 'outputPose' && w.sharedOutputPose) continue;
    preserve(node);
  }
  if (action.flow?.tests.length) {
    const original = graph.nodes.find(n => n.id.startsWith(`flow:${owner}:`));
    if (original) {
      const draft = preserve({...original, id: `conditionTable:${owner}`, kind: 'conditionTable'});
      draft.value.flow = structuredClone(action.flow);
      for (const test of action.flow.tests) replacements.set(`flow:${owner}:${test.id}`, draft.id);
    }
  }
  const remap = (id: string) => replacements.get(id) ?? (owned(id) ? '' : id);
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
  next.links = next.links.filter(l => !links.has(l.id));
  for (const l of next.links) if (l.partnerTo === owner) l.partnerTo = '';
  next.parameters = next.parameters.filter(p => p.action !== owner);
  next.conditionTables = next.conditionTables?.filter(id => id !== owner);
  next.sharedRules = next.sharedRules
    ?.map(g => ({...g, members: g.members.filter(m => !owned(ruleNode(g.kind, m, w)))}))
    .filter(g => g.members.length > 1);
  for (const a of [...next.actions, ...(next.drafts ?? []).map(d => d.value)]) {
    for (const test of a.flow?.tests ?? []) {
      for (const port of ['pass', 'fail'] as const) {
        const end = test[port];
        if (end && 'action' in end && end.action === owner) delete test[port];
      }
      if (test.space?.candidate === owner) test.space.candidate = '';
    }
    // A fan's kept fail into it too: the fan rewrites the chain from these (graph/conditionFans.ts applyFans).
    for (const fan of a.flow?.fans ?? [])
      for (const [id, to] of Object.entries(fan.fails)) if ('action' in to && to.action === owner) delete fan.fails[id];
    if (a.pair?.carry?.putdownAction === owner) a.pair.carry.putdownAction = '';
  }
  for (const d of next.drafts ?? [])
    if (d.owner === owner) {
      d.owner = '';
      d.from = '';
      d.to = '';
    }
  const blends = blendNodes(w);
  next.blends = blends
    .filter(b => !replacements.has(b.id) && (preserveFeatures || (!owned(b.source) && !owned(b.target))))
    .map(b => ({...b, source: remap(b.source), target: remap(b.target)}));
  // Generated blend IDs must not collide when an action UID is reused.
  let index = 1;
  for (const b of next.blends)
    if (owned(b.id)) {
      const old = b.id;
      while (next.blends.some(b => b.id === `blend:detached${index}`)) index++;
      b.id = `blend:detached${index++}`;
      const layout = next.layout[layoutKey('root')],
        pos = layout?.[layoutKey(old)];
      if (pos) layout[layoutKey(b.id)] = pos;
    }
  next.disconnections = next.disconnections?.flatMap(e => {
    const bindings = e.bindings.filter(b => !owned(b.source) && !owned(b.target));
    return bindings.length
      ? [{...e, source: remap(e.source) || bindings[0].source, target: remap(e.target) || bindings[0].target, bindings}]
      : [];
  });
  const layout = next.layout[layoutKey('root')];
  if (layout) for (const node of graph.nodes.filter(n => owned(n.id))) delete layout[layoutKey(node.id)];
  return next;
}

// Only top-level authoring documents are repaired, never Action snapshots inside drafts.
export function repairEmptyPlaybacks(w: Workspace): Workspace {
  for (const a of w.actions.filter(a => a.config.steps.length === 0)) w = retirePlayback(w, a.uid);
  return w;
}
