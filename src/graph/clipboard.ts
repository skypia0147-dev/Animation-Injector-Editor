import {qteMembers, copyQteRules, uniqueQteGroup, remapQtePin} from './qteGroups.ts';
import type {Workspace} from '../workspace.ts';
import {addAction} from '../workspace.ts';
import type {ViewGraph} from './navigation.ts';
import {addFlat, addDetachedCondition, connectFlat, flatGraph, flatNode} from './flat.ts';
import {nodeSettings, applyNodeSettings} from './nodeSettings.ts';
import {animId, blendNodes} from './blends.ts';
import {draftWorkspace, draftScope} from './drafts.ts';
import {rows} from '../timeline/model.ts';
import {readExpression, insertExpression} from './conditionExpression.ts';
import {moveNodes, addComment, editComment, layoutKey} from './projection.ts';
import {copyWorkspaceInto} from './copyWorkspace.ts';
import {compactGraph, ruleNode} from './sharing.ts';
import {tableProjection} from './conditionTables.ts';
import {sourceWindow} from './clipWindows.ts';
import {tr} from '../i18n/korean.ts';

export type NodeClipboard = {
  format: 'ai-nodes-1';
  workspace: Workspace;
  graph: ViewGraph;
  complete?: boolean;
  cardItems?: string[];
};
export let nodeClipboard: NodeClipboard | undefined;
export function setNodeClipboard(value: NodeClipboard) {
  nodeClipboard = value;
}
export function copyNodes(w: Workspace, g: ViewGraph, ids: string[]): NodeClipboard {
  const selected = new Set(ids),
    nodes = g.nodes.filter(n => selected.has(n.id) && n.kind !== 'entry');
  if (!nodes.length) throw Error(tr('복사할 카드를 선택하세요. 진입 카드는 하나만 사용합니다.'));
  const complete = tableProjection(w, compactGraph(w, flatGraph(w))).nodes.every(
    n => n.kind === 'entry' || selected.has(n.id)
  );
  return structuredClone({
    format: 'ai-nodes-1',
    workspace: w,
    complete,
    graph: {
      nodes,
      edges: g.edges.filter(e => selected.has(e.source) && selected.has(e.target) && !e.id.startsWith('operand:')),
    },
  });
}
export function pasteNodes(
  w: Workspace,
  clip: NodeClipboard,
  at: {x: number; y: number},
  owner: string
): {workspace: Workspace; ids: string[]} {
  if (clip.format !== 'ai-nodes-1' || !clip.graph.nodes.length || clip.graph.nodes.length > 1000)
    throw Error(tr('지원하지 않는 카드 클립보드입니다.'));
  if (clip.complete && !clip.cardItems && sourceCompatible(w, clip.workspace))
    return copyWorkspaceInto(w, clip.workspace, clip.graph, at);
  let n = structuredClone(w);
  const source = clip.workspace,
    map = new Map<string, string>(),
    owners = new Map<string, string>();
  const cardCopies: {
    old: Workspace['actions'][number];
    copy: Workspace['actions'][number];
    step: string;
    source: string;
    target: string;
  }[] = [];
  const ox = Math.min(...clip.graph.nodes.map(n => n.position.x)),
    oy = Math.min(...clip.graph.nodes.map(n => n.position.y));
  const position = (node: ViewGraph['nodes'][number]) => ({
    x: at.x + node.position.x - ox,
    y: at.y + node.position.y - oy,
  });
  // Playback contexts are duplicated first. Only their own playback settings are copied.
  for (const node of clip.graph.nodes.filter(n => n.kind === 'hkxPlay')) {
    const old = source.actions.find(a => a.uid === node.action);
    if (!old) throw Error(tr('원본 재생 설정을 찾지 못했습니다.'));
    if (clip.cardItems && owners.has(old.uid)) {
      map.set(node.id, animId(owners.get(old.uid)!, 'clip_' + node.step));
      continue;
    }
    const r = addFlat(n, '', 'playNode', position(node));
    n = r.workspace;
    const a = n.actions.at(-1)!;
    if (clip.cardItems) {
      const selectedSteps = new Set(
        clip.graph.nodes.filter(v => v.kind === 'hkxPlay' && v.action === old.uid).map(v => v.step)
      );
      const steps = old.config.steps.filter(s => selectedSteps.has(s.id));
      const step = steps.find(s => s.id === old.config.entry) ?? steps[0];
      const copy = {
        ...structuredClone(old),
        uid: a.uid,
        nodeAuthored: true,
        position: a.position,
        config: {
          ...structuredClone(old.config),
          actionId: a.config.actionId,
          name: old.config.name + tr(' 복사'),
          entry: step.id,
          steps: structuredClone(steps),
          start: {...structuredClone(old.config.start), mode: 'none' as const},
        },
      };
      delete copy.flow;
      copy.clipWindows = Object.fromEntries(steps.map(s => [s.id, structuredClone(sourceWindow(old, s.id).value)]));
      if (copy.pair?.carry) copy.pair.carry.putdownAction = '';
      n.actions[n.actions.length - 1] = copy;
      const target = animId(copy.uid, 'clip_' + node.step);
      owners.set(old.uid, copy.uid);
      map.set(node.id, target);
      cardCopies.push({old, copy, step: step.id, source: node.id, target});
      continue;
    }
    if (old.pair) {
      a.pair = structuredClone(old.pair);
      a.pair.effects = [];
      a.pair.effectsEnabled = false;
      delete a.pair.carry;
      for (const value of Object.values(a.pair.timeline))
        if (value && typeof value === 'object' && 'enabled' in value) value.enabled = false;
    }
    const step = old.config.steps.find(s => s.id === node.step) ?? old.config.steps[0];
    a.config.steps = [{...structuredClone(step), id: a.config.entry}];
    delete a.config.steps[0].recovery;
    a.config.name = old.config.name + tr(' 복사');
    a.config.kind = 'single';
    const settings = nodeSettings(source, node.id);
    if (settings) applyNodeSettings(n, r.id, settings);
    owners.set(old.uid, a.uid);
    map.set(node.id, r.id);
  }
  const routeOwner = (id?: string) => owners.get(id ?? '') ?? owner ?? n.actions[0]?.uid;
  for (const node of clip.graph.nodes.filter(n => n.kind !== 'hkxPlay' && !clip.cardItems?.includes(n.id))) {
    const a = source.drafts?.find(d => d.id === node.id)?.value ?? source.actions.find(a => a.uid === node.action),
      dest = routeOwner(node.action);
    let id = '';
    if (node.kind === 'qte') {
      const rules = qteMembers(source, node.id);
      if (!rules.length) throw Error(tr('원본 QTE를 찾지 못했습니다.'));
      const group = rules[0].group ? uniqueQteGroup(n, rules[0].group + tr(' 복사')) : undefined;
      const keys = new Set<string>(),
        template = rules.filter(q => {
          const {id, owner, step, ...value} = q,
            key = JSON.stringify(value);
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        });
      const added = copyQteRules(n, template, group);
      id = 'qte:' + added[0].id;
      for (let i = 0; i < template.length; i++) map.set('qte:' + template[i].id, 'qte:' + added[i].id);
      for (const q of added)
        for (const value of Object.values(q.results)) {
          if (value.mode === 'transition') {
            value.mode = 'continue';
            value.to = '';
            value.partnerTo = '';
          }
        }
      n = moveNodes(n, {kind: 'root'}, {[id]: position(node)});
    } else if (node.kind === 'comment') {
      const r = addComment(n, {kind: 'root'}, position(node));
      n = editComment(r.workspace, {kind: 'root'}, r.id!, node.summary);
      id = r.id!;
    } else if (node.kind === 'conditionTable') {
      const r = addFlat(n, dest, node.kind, position(node));
      n = r.workspace;
      id = r.id;
      const d = n.drafts!.find(d => d.id === id)!;
      {
        if (!a?.flow) throw Error(tr('원본 조건 규칙을 찾지 못했습니다.'));
        d.value.flow = structuredClone(a.flow);
        for (const test of d.value.flow.tests) {
          for (const port of ['pass', 'fail'] as const) {
            const end = test[port];
            if (end && 'action' in end) {
              const mapped = owners.get(end.action);
              if (mapped) test[port] = {action: mapped};
              else delete test[port];
            }
          }
          if (test.space) test.space.candidate = owners.get(test.space.candidate) ?? '';
        }
      }
    } else if (node.kind === 'conditionBranch') {
      if (!dest || !a?.flow) throw Error(tr('조건을 붙여넣을 HKX를 선택하거나 함께 복사하세요.'));
      const key = node.id.split(':')[2];
      const r = addDetachedCondition(n, dest, position(node));
      n = r.workspace;
      const f = n.actions.find(a => a.uid === dest)!.flow!;
      const previous = new Set(f.tests.map(t => t.id));
      const imported = insertExpression(f, readExpression(a.flow, key)),
        t = f.tests.find(t => t.id === imported)!;
      const placeholder = r.id.split(':')[2];
      f.tests = f.tests.filter(t => t.id !== placeholder);
      t.id = placeholder;
      id = r.id;
      for (const test of f.tests)
        if ((!previous.has(test.id) || test.id === placeholder) && test.space)
          test.space.candidate = owners.get(test.space.candidate) ?? '';
    } else if (node.kind === 'blend') {
      const r = addFlat(n, dest, 'blend', position(node));
      n = r.workspace;
      id = r.id;
      n.blends!.find(b => b.id === id)!.seconds = blendNodes(source).find(b => b.id === node.id)!.seconds;
    } else {
      const draft = source.drafts?.find(d => d.id === node.id);
      const row = a && rows(source, a).find(r => r.id === node.notify),
        kind = draft?.kind ?? (row ? 'notify:' + row.kind : node.kind);
      const context =
        a?.pair && !n.actions.find(a => a.uid === dest)?.pair
          ? {...n, actions: [...n.actions, {...a, uid: 'clipboardContext'}]}
          : n;
      const r = addFlat(context, context === n ? dest : 'clipboardContext', kind, position(node));
      n = r.workspace;
      if (context !== n) n.actions = n.actions.filter(a => a.uid !== 'clipboardContext');
      id = r.id;
      const d = n.drafts!.find(d => d.id === id)!;
      d.owner = dest;
      if (draft) {
        d.value = structuredClone(draft.value);
        d.kind = draft.kind;
        d.local = draft.local;
        d.notify = draft.notify;
        d.from = '';
        d.to = '';
      } else if (a) {
        if (a.pair && !d.value.pair) d.value = addAction({...n, actions: []}, 'pair');
        if (node.kind === 'keyInput' || node.kind === 'markerReceive') {
          const link =
            node.scope.kind === 'link'
              ? source.links.find(l => l.id === (node.scope as {link: string}).link)
              : undefined;
          const input = a.config.inputs.find(i => i.id === (link?.input ?? a.config.start.input));
          d.value.config.start = {
            ...d.value.config.start,
            mode: node.kind === 'markerReceive' ? 'event' : 'input',
            event: link?.event ?? a.config.start.event,
          };
          if (input) {
            d.value.config.inputs = [structuredClone(input)];
            d.value.config.start.input = input.id;
          }
        } else {
          const settings = nodeSettings(source, node.id);
          if (settings) {
            const temp = draftWorkspace(n, d),
              scope = draftScope(d),
              target = d.notify
                ? `notify:${d.value.uid}|${d.notify}`
                : scope.kind === 'start'
                  ? `start:${d.value.uid}|${d.local}`
                  : animId(d.value.uid, d.local);
            applyNodeSettings(temp, target, settings);
            d.value = temp.actions[0];
          }
        }
        if (d.value.pair?.carry) d.value.pair.carry.putdownAction = owners.get(d.value.pair.carry.putdownAction) ?? '';
      }
    }
    map.set(node.id, id);
  }
  // Rebuild only internal wires. Draft attachment can change the visual identity.
  const pending = clip.graph.edges.filter(
    e => !clip.cardItems?.includes(e.source) && !clip.cardItems?.includes(e.target)
  );
  let passes = 0;
  while (pending.length && passes++ <= clip.graph.edges.length) {
    let progress = false,
      last = '';
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i],
        s = map.get(e.source),
        t = map.get(e.target);
      if (!s || !t) {
        pending.splice(i, 1);
        continue;
      }
      try {
        const before = flatGraph(n).nodes;
        const next = connectFlat(n, s, t, remapQtePin(e.pin, map));
        const after = flatGraph(next).nodes;
        for (const [oldId, mapped] of map)
          if (!after.some(n => n.id === mapped)) {
            const previous = before.find(n => n.id === mapped);
            if (!previous) continue;
            const candidates = after.filter(n => !before.some(b => b.id === n.id) && n.kind === previous.kind);
            if (candidates.length === 1) map.set(oldId, candidates[0].id);
            else if (previous.kind === 'conditionTable') {
              const owner = next.actions.find(a => a.flow && !n.actions.find(b => b.uid === a.uid)?.flow);
              if (owner) map.set(oldId, 'conditionTable:' + owner.uid);
            }
          }
        n = next;
        pending.splice(i, 1);
        progress = true;
      } catch (err) {
        last = String(err);
      }
    }
    if (!progress) throw Error(tr('복사한 내부 연결을 복원하지 못했습니다: ') + last);
  }
  if (clip.cardItems) {
    // Clone owned values directly; visual attachment wires are not independent objects.
    const originals = blendNodes(source);
    n.blends ??= blendNodes(n);
    for (const c of cardCopies) {
      const timeline = source.layout['timeline_' + layoutKey(c.old.uid)];
      if (timeline) n.layout['timeline_' + layoutKey(c.copy.uid)] = structuredClone(timeline);
      const ownedBlends = originals.filter(
        b => clip.cardItems!.includes(b.id) && clip.graph.nodes.some(v => v.id === b.id && v.action === c.old.uid)
      );
      const local = (id: string) =>
        ownedBlends.some(b => b.id === id)
          ? `blend:${c.copy.uid}:copy:${id}`
          : (map.get(id) ??
            (id === c.old.uid
              ? animId(c.copy.uid, 'clip_' + c.copy.config.entry)
              : id.replace(`:${c.old.uid}:`, `:${c.copy.uid}:`).replace(`:${c.old.uid}|`, `:${c.copy.uid}|`)));
      for (const b of ownedBlends) {
        const target = b.target.endsWith('|outputPose') ? animId(c.copy.uid, 'outputPose') : c.target;
        const start = target === c.target ? 'entry' : c.target;
        const id = local(b.id);
        n.blends = n.blends.filter(x => x.id !== id);
        n.blends.push({id, source: start, target, seconds: b.seconds});
      }
      for (const id of clip.cardItems.filter(id => clip.graph.nodes.some(v => v.id === id && v.action === c.old.uid)))
        map.set(id, local(id));
      for (const p of source.parameters.filter(p => p.action === c.old.uid)) {
        let id = p.id + '_copy',
          index = 2;
        while (n.parameters.some(p => p.id === id)) id = p.id + '_copy' + index++;
        n.parameters.push({...structuredClone(p), id, action: c.copy.uid});
      }
      const oldCarry = c.old.pair?.carry;
      if (c.copy.pair?.carry && oldCarry) c.copy.pair.carry.putdownAction = owners.get(oldCarry.putdownAction) ?? '';
      const itemIds = new Set(
        clip.graph.nodes.filter(v => clip.cardItems!.includes(v.id) && v.action === c.old.uid).map(v => v.id)
      );
      for (const cut of source.disconnections ?? []) {
        const bindings = cut.bindings
          .filter(
            b =>
              (itemIds.has(b.source) || itemIds.has(b.target)) &&
              [b.source, b.target].every(id => !id.startsWith(`anim:${c.old.uid}:|clip_`) || map.has(id))
          )
          .map(b => ({...b, source: local(b.source), target: local(b.target)}));
        if (bindings.length) {
          n.disconnections ??= [];
          n.disconnections.push({...cut, source: local(cut.source), target: local(cut.target), bindings});
        }
      }
    }
    for (const group of source.sharedRules ?? []) {
      const members = group.members.map(m => map.get(ruleNode(group.kind, m, source))).filter((x): x is string => !!x);
      if (members.length > 1) {
        n.sharedRules ??= [];
        n.sharedRules.push({kind: 'node', members});
      }
    }
  }
  const layout: Record<string, {x: number; y: number}> = {};
  for (const node of clip.graph.nodes) {
    const id = map.get(node.id);
    if (id) layout[id] = position(node);
  }
  n = moveNodes(n, {kind: 'root'}, layout);
  return {workspace: n, ids: [...new Set(map.values())]};
}
function sourceCompatible(w: Workspace, s: Workspace) {
  return w.id === s.id && JSON.stringify(w.parameters) === JSON.stringify(s.parameters);
}
