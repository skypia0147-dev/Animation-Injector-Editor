import {uniqueQteGroup, remapQtePin} from './qteGroups.ts';
import type {Workspace} from '../workspace.ts';
import {blendNodes} from './blends.ts';
import {moveNodes, addComment, editComment} from './projection.ts';
import type {ViewGraph} from './navigation.ts';
import {tr} from '../i18n/korean.ts';
// A complete selection can be copied in one pass without replaying UI connections.
export function copyWorkspaceInto(w: Workspace, source: Workspace, g: ViewGraph, at: {x: number; y: number}) {
  let n = structuredClone(w);
  const copy = structuredClone(source),
    ids = new Map<string, string>();
  const used = new Set([
    ...n.actions.map(a => a.uid),
    ...n.links.map(l => l.id),
    ...blendNodes(n).map(b => b.id),
    ...(n.drafts ?? []).map(d => d.id),
  ]);
  const fresh = (id: string, prefix: string) => {
    let i = 1;
    while (used.has(prefix + i)) i++;
    const value = prefix + i;
    used.add(value);
    ids.set(id, value);
    return value;
  };
  for (const a of copy.actions) fresh(a.uid, 'copyAction');
  for (const l of copy.links) fresh(l.id, 'copyLink');
  for (const b of blendNodes(copy)) fresh(b.id, 'copyBlend');
  for (const d of copy.drafts ?? []) fresh(d.id, 'draft:');
  const remap = (id: string): string => {
    if (ids.has(id)) return ids.get(id)!;
    if (id.startsWith('conditionTable:')) return 'conditionTable:' + remap(id.slice(15));
    const [head, ...tail] = id.split('|'),
      parts = head.split(':');
    if (['start', 'anim', 'flow', 'transition', 'link'].includes(parts[0]) && ids.has(parts[1])) {
      parts[1] = ids.get(parts[1])!;
      return parts.join(':') + (tail.length ? '|' + tail.join('|') : '');
    }
    if (parts[0] === 'notify' && ids.has(parts[1]))
      return 'notify:' + ids.get(parts[1]) + (tail.length ? '|' + tail.join('|') : '');
    if (ids.has(head)) return ids.get(head) + (tail.length ? '|' + tail.join('|') : '');
    return id;
  };
  const actionNames = new Set(n.actions.map(a => a.config.actionId));
  const groups = new Map<string, string>();
  for (const q of copy.qtes ?? [])
    if (q.group && !groups.has(q.group)) groups.set(q.group, uniqueQteGroup(n, q.group + tr(' 복사')));
  const qteIds = new Set(n.qtes?.map(q => q.id));
  for (const q of copy.qtes ?? []) {
    let i = 1;
    while (qteIds.has('QTE' + i)) i++;
    const old = 'qte:' + q.id;
    q.id = 'QTE' + i;
    qteIds.add(q.id);
    ids.set(old, 'qte:' + q.id);
    if (q.group) q.group = groups.get(q.group);
    q.owner = remap(q.owner);
    for (const r of Object.values(q.results)) {
      r.to = remap(r.to);
      r.partnerTo = remap(r.partnerTo);
    }
  }
  n.qtes = [...(n.qtes ?? []), ...(copy.qtes ?? [])];
  for (const a of copy.actions) {
    a.uid = remap(a.uid);
    let name = a.config.actionId + 'Copy',
      i = 2;
    while (actionNames.has(name)) name = a.config.actionId + 'Copy' + i++;
    actionNames.add(name);
    a.config.actionId = name;
    a.config.name += tr(' 복사');
    if (a.pair?.carry) a.pair.carry.putdownAction = remap(a.pair.carry.putdownAction);
    for (const t of a.flow?.tests ?? []) {
      if (t.space) t.space.candidate = remap(t.space.candidate);
      for (const p of ['pass', 'fail'] as const) {
        const end = t[p];
        if (end && 'action' in end) end.action = remap(end.action);
      }
    }
  }
  for (const l of copy.links) {
    l.id = remap(l.id);
    l.from = remap(l.from);
    l.to = remap(l.to);
    l.partnerTo = remap(l.partnerTo);
  }
  const blends = blendNodes(source).map(b => ({
    ...b,
    id: remap(b.id),
    source: remap(b.source),
    target: remap(b.target),
  }));
  for (const d of copy.drafts ?? []) {
    d.id = remap(d.id);
    d.owner = remap(d.owner);
    if (d.from) d.from = remap(d.from);
    if (d.to) d.to = remap(d.to);
    if (d.value.pair?.carry) d.value.pair.carry.putdownAction = remap(d.value.pair.carry.putdownAction);
    for (const t of d.value.flow?.tests ?? []) {
      if (t.space) t.space.candidate = remap(t.space.candidate);
      for (const p of ['pass', 'fail'] as const) {
        const end = t[p];
        if (end && 'action' in end) end.action = remap(end.action);
      }
    }
  }
  for (const s of copy.sharedRules ?? []) s.members = s.members.map(remap);
  n.blends = [...structuredClone(blendNodes(w)), ...blends];
  n.actions.push(...copy.actions);
  n.links.push(...copy.links);
  n.drafts = [...(n.drafts ?? []), ...(copy.drafts ?? [])];
  n.sharedRules = [...(n.sharedRules ?? []), ...(copy.sharedRules ?? [])];
  n.conditionTables = [...(n.conditionTables ?? []), ...(copy.conditionTables ?? []).map(remap)];
  n.sharedOutputPose ||= source.sharedOutputPose;
  for (const cut of copy.disconnections ?? []) {
    cut.pin = remapQtePin(cut.pin, ids);
    cut.source = remap(cut.source);
    cut.target = remap(cut.target);
    for (const b of cut.bindings) {
      b.pin = remapQtePin(b.pin, ids);
      b.source = remap(b.source);
      b.target = remap(b.target);
    }
  }
  n.disconnections = [...(n.disconnections ?? []), ...(copy.disconnections ?? [])];
  const minX = Math.min(...g.nodes.map(n => n.position.x)),
    minY = Math.min(...g.nodes.map(n => n.position.y));
  for (const node of g.nodes.filter(n => n.kind === 'comment')) {
    const added = addComment(n, {kind: 'root'});
    n = editComment(added.workspace, {kind: 'root'}, added.id!, node.summary);
    ids.set(node.id, added.id!);
  }
  const layout = Object.fromEntries(
    g.nodes
      .filter(n => n.kind !== 'entry' && n.id !== 'shared:outputPose')
      .map(node => [remap(node.id), {x: at.x + node.position.x - minX, y: at.y + node.position.y - minY}])
  );
  return {workspace: moveNodes(n, {kind: 'root'}, layout), ids: Object.keys(layout)};
}
