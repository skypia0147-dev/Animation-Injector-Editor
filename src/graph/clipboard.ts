import {qteMembers, copyQteRules, uniqueQteGroup} from './qteGroups.ts';
import type {Workspace, Action} from '../workspace.ts';
import {addAction, fileActionId, uid} from '../workspace.ts';
import type {ViewGraph} from './navigation.ts';
import {addItem, conditionCardId, flatGraph, startCardId, transitionId} from './flat.ts';
import {nodeSettings, applyNodeSettings} from './nodeSettings.ts';
import {animId} from './blends.ts';
import {rows} from '../timeline/model.ts';
import {moveNodes, addComment, editComment, layoutKey} from './projection.ts';
import {parseNodeId} from './nodeRef.ts';
import {newCardUid, newStartUid, refAction, refCard, type Ref} from '../cards.ts';
import {tr} from '../i18n/korean.ts';

// Copying cards (XML format 6): HKX cards with their items, start cards, condition cards, transitions, QTEs and notes.
// A destination among the copied cards goes to its copy; one outside them keeps going where it went, when that is in
// the document pasted into.

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
    nodes = g.nodes.filter(n => selected.has(n.id) && n.kind !== 'entry' && n.kind !== 'eventRegistry');
  if (!nodes.length) throw Error(tr('복사할 카드를 선택하세요.'));
  return structuredClone({
    format: 'ai-nodes-1',
    workspace: w,
    graph: {nodes, edges: g.edges.filter(e => selected.has(e.source) && selected.has(e.target))},
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
  let n = structuredClone(w);
  const source = clip.workspace;
  const actions = new Map<string, string>(),
    cards = new Map<string, string>(),
    map = new Map<string, string>();
  const ox = Math.min(...clip.graph.nodes.map(n => n.position.x)),
    oy = Math.min(...clip.graph.nodes.map(n => n.position.y));
  const position = (node: ViewGraph['nodes'][number]) => ({
    x: at.x + node.position.x - ox,
    y: at.y + node.position.y - oy,
  });
  const items = new Set(clip.cardItems ?? []);
  // HKX cards: the whole action (its features and moments come with it).
  for (const node of clip.graph.nodes.filter(n => n.kind === 'hkxPlay')) {
    const old = source.actions.find(a => a.uid === node.action);
    if (!old || actions.has(old.uid)) continue;
    const fresh = addAction(n, old.pair ? 'pair' : 'single');
    const copy: Action = {
      ...structuredClone(old),
      uid: fresh.uid,
      position: position(node),
      config: {
        ...structuredClone(old.config),
        actionId: fileActionId(n.actions, fresh.uid, old.config.steps[0].clip),
        name: old.config.name + tr(' 복사'),
      },
    };
    n.actions.push(copy);
    actions.set(old.uid, copy.uid);
    const id = animId(copy.uid, 'clip_' + copy.config.entry);
    map.set(node.id, id);
    // Its timeline layout and its parameters.
    const timeline = source.layout['timeline_' + layoutKey(old.uid)];
    if (timeline) n.layout['timeline_' + layoutKey(copy.uid)] = structuredClone(timeline);
    for (const p of source.parameters.filter(p => p.action === old.uid)) {
      let pid = p.id + '_copy',
        index = 2;
      while (n.parameters.some(p => p.id === pid)) pid = p.id + '_copy' + index++;
      n.parameters.push({...structuredClone(p), id: pid, action: copy.uid});
    }
  }
  for (const a of n.actions)
    if (a.pair?.carry && [...actions.values()].includes(a.uid))
      a.pair.carry.putdownAction =
        actions.get(a.pair.carry.putdownAction) ??
        (n.actions.some(x => x.uid === a.pair!.carry!.putdownAction) ? a.pair.carry.putdownAction : '');
  // Condition cards first named (their copies' uids), then filled (they may go to one another).
  const cardNodes = clip.graph.nodes.filter(x => parseNodeId(x.id).kind === 'conditionCard');
  for (const node of cardNodes) {
    const old = (parseNodeId(node.id) as {uid: string}).uid;
    const fresh = newCardUid(n);
    n.cards.push({uid: fresh, tests: [], guards: [], rows: [], false: null, position: position(node)});
    cards.set(old, fresh);
    map.set(node.id, conditionCardId(fresh));
  }
  const remap = (r: Ref): Ref => {
    const a = refAction(r),
      c = refCard(r);
    if (a) return actions.has(a) ? {action: actions.get(a)!} : n.actions.some(x => x.uid === a) ? r : null;
    if (c) return cards.has(c) ? {card: cards.get(c)!} : n.cards.some(x => x.uid === c) ? r : null;
    return null;
  };
  const copied = (r: Ref): Ref => {
    const a = refAction(r),
      c = refCard(r);
    return a && actions.has(a) ? {action: actions.get(a)!} : c && cards.has(c) ? {card: cards.get(c)!} : null;
  };
  for (const [old, fresh] of cards) {
    const o = source.cards.find(c => c.uid === old)!,
      c = n.cards.find(c => c.uid === fresh)!;
    c.tests = structuredClone(o.tests);
    c.guards = [...o.guards];
    c.rows = o.rows.map(r => ({...r, guards: [...r.guards], to: remap(r.to)}));
    if (o.true !== undefined) c.true = remap(o.true);
    c.false = remap(o.false);
  }
  for (const node of clip.graph.nodes) {
    const ref = parseNodeId(node.id);
    if (ref.kind === 'startCard') {
      const o = source.starts.find(s => s.uid === ref.uid);
      if (!o) continue;
      const fresh = newStartUid(n);
      n.starts.push({...structuredClone(o), uid: fresh, xmlId: undefined, to: remap(o.to), position: position(node)});
      map.set(node.id, startCardId(fresh));
    } else if (ref.kind === 'transition') {
      const o = source.links.find(l => l.id === ref.link);
      // A transition is its source's: copied with its HKX card (or pasted onto the HKX chosen).
      const from = o && (actions.get(o.from) ?? (owner && n.actions.some(a => a.uid === owner) ? owner : ''));
      if (!o || !from) continue;
      const id = uid(
        'link',
        n.links.map(l => l.id)
      );
      const to = remap(o.card ? {card: o.card} : o.to ? {action: o.to} : null);
      const a = n.actions.find(a => a.uid === from)!,
        input = source.actions.find(x => x.uid === o.from)?.config.inputs.find(i => i.id === o.input);
      let inputId = o.input;
      if (
        input &&
        !a.config.inputs.some(
          i => i.id === input.id && i.key === input.key && i.gamepad === input.gamepad && i.control === input.control
        )
      ) {
        let k = 1;
        while (a.config.inputs.some(i => i.id === 'binding' + k)) k++;
        inputId = 'binding' + k;
        a.config.inputs.push({...structuredClone(input), id: inputId});
      }
      n.links.push({
        ...structuredClone(o),
        id,
        from,
        to: refAction(to),
        card: refCard(to) || undefined,
        input: inputId,
        partnerTo: actions.get(o.partnerTo) ?? (n.actions.some(x => x.uid === o.partnerTo) ? o.partnerTo : ''),
        position: position(node),
      });
      map.set(node.id, transitionId(id));
    } else if (node.kind === 'qte') {
      const all = qteMembers(source, node.id);
      if (!all.length) continue;
      // The rules of the HKX cards copied with it; without them one unattached rule per kind of rule.
      const keys = new Set<string>();
      const rules = all.some(q => actions.has(q.owner))
        ? all.filter(q => actions.has(q.owner))
        : all.filter(q => {
            const {id: _, owner: _o, step: _s, ...value} = q,
              key = JSON.stringify(value);
            if (keys.has(key)) return false;
            keys.add(key);
            return true;
          });
      const group = rules[0].group ? uniqueQteGroup(n, rules[0].group + tr(' 복사')) : undefined;
      const added = copyQteRules(n, rules, group);
      for (const [i, q] of added.entries()) {
        q.owner = actions.get(rules[i].owner) ?? '';
        q.step = q.owner ? (n.actions.find(a => a.uid === q.owner)?.config.entry ?? '') : '';
        // A result goes on to what was copied with it.
        for (const r of Object.values(q.results))
          if (r.mode === 'transition') {
            const to = copied(r.card ? {card: r.card} : r.to ? {action: r.to} : null);
            r.to = refAction(to);
            r.card = refCard(to) || undefined;
            r.partnerTo = actions.get(r.partnerTo) ?? '';
            if (!r.to && !r.card) Object.assign(r, {mode: 'continue', to: '', partnerTo: ''});
          }
      }
      map.set(node.id, 'qte:' + added[0].id);
    } else if (node.kind === 'comment') {
      const r = addComment(n, {kind: 'root'}, position(node));
      n = editComment(r.workspace, {kind: 'root'}, r.id!, node.summary);
      map.set(node.id, r.id!);
    } else if (node.kind !== 'hkxPlay' && !items.has(node.id) && node.action && owner && !actions.has(node.action)) {
      // An item alone onto the chosen HKX card: its kind, with its settings.
      const a = source.actions.find(a => a.uid === node.action);
      const row = a && node.notify ? rows(source, a).find(r => r.id === node.notify) : undefined;
      const kind = row ? 'notify:' + row.kind : node.kind === 'blend' ? 'blend' : node.original;
      try {
        const r = addItem(n, owner, kind, node.original === 'blendIn');
        n = r.workspace;
        const settings = nodeSettings(source, node.id);
        if (settings) applyNodeSettings(n, r.id, settings);
        map.set(node.id, r.id);
      } catch {
        /* An item the chosen card cannot take is left out. */
      }
    }
  }
  const layout: Record<string, {x: number; y: number}> = {};
  for (const node of clip.graph.nodes) {
    const id = map.get(node.id);
    if (id) layout[id] = position(node);
  }
  n = moveNodes(n, {kind: 'root'}, layout);
  const drawn = new Set(flatGraph(n).nodes.map(x => x.id));
  return {workspace: n, ids: [...new Set(map.values())].filter(id => drawn.has(id) || id.startsWith('@'))};
}
