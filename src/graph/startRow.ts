/** How an action starts, shown under its HKX card's title (10-20, mockup A "시작" row): a key or an event (the
 *  row picks its start card), only through other actions (a transition, a condition route, a QTE result, a carry:
 *  any line from another action into this card), or nothing yet (the row offers to add a start key or event). */
import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {gamepadXml} from '../keys.ts';
import {tr} from '../i18n/korean.ts';

export type StartRow = {tone: 'set' | 'via' | 'none'; text: string; node?: string};

export function startRow(
  w: Workspace,
  n: FlatNode,
  graph: {nodes: FlatNode[]; edges: GraphEdge[]}
): StartRow | undefined {
  const a = n.kind === 'hkxPlay' ? w.actions.find(a => a.uid === n.action) : undefined;
  if (!a || n.step !== a.config.entry) return undefined;
  const start = a.config.start;
  if (start.mode === 'input') {
    const input = [...a.config.inputs, ...w.sharedInputs].find(i => i.id === start.input);
    // The key's own name (Num0, G), as its input card shows it.
    const key = input?.key || (input?.gamepad ? gamepadXml(input.gamepad) : '—');
    return {
      tone: 'set',
      text: tr('키 {key}', {key}) + (start.onKeyUp ? tr(' · 뗄 때') : ''),
      node: `start:${a.uid}|keyInput`,
    };
  }
  if (start.mode === 'event')
    return {
      tone: 'set',
      text: tr('이벤트 {v0}', {v0: start.event || tr('미지정')}),
      node: `start:${a.uid}|markerReceive`,
    };
  // No start of its own: other actions may still lead here, through this action's own steps on the way (its state
  // node, an entry blend or condition in the document's graph; the canvas folds some of them away).
  const byId = new Map(graph.nodes.map(x => [x.id, x]));
  const names = new Set<string>(),
    seen = new Set<string>();
  const walk = (id: string, hops: number) => {
    if (seen.has(id) || hops > 6) return;
    seen.add(id);
    for (const e of graph.edges) {
      if (e.target !== id) continue;
      const source = byId.get(e.source);
      if (!source?.action) continue;
      if (source.action !== a.uid) {
        const from = w.actions.find(x => x.uid === source.action);
        if (from) names.add(from.config.name || from.config.actionId);
      } else if (!source.id.startsWith('start:')) walk(source.id, hops + 1);
    }
  };
  walk(n.id, 0);
  // A transition shared by many actions is one card on the canvas: name every action whose link leads here.
  for (const l of w.links)
    if ((l.to === a.uid || l.partnerTo === a.uid) && l.from !== a.uid) {
      const from = w.actions.find(x => x.uid === l.from);
      if (from) names.add(from.config.name || from.config.actionId);
    }
  // A QTE whose result starts this action (10-20: an event's QTE belongs to no action, so its line was not seen and
  // the card read "no way to start"): named by its action, or by the event that asks it.
  for (const q of w.qtes ?? [])
    if (Object.values(q.results).some(r => r.mode === 'transition' && (r.to === a.uid || r.partnerTo === a.uid))) {
      const owner = w.actions.find(x => x.uid === q.owner);
      if (owner && owner.uid !== a.uid) names.add(owner.config.name || owner.config.actionId);
      else if (q.eventStart !== undefined) names.add(tr('이벤트 {v0} QTE', {v0: q.eventStart || tr('미지정')}));
    }
  if (names.size) {
    const list = [...names];
    return {
      tone: 'via',
      text: tr('← 전환으로만 ({v0})', {
        v0: list[0] + (list.length > 1 ? tr(' 외 {v0}', {v0: list.length - 1}) : ''),
      }),
    };
  }
  return {tone: 'none', text: tr('시작 방법 없음')};
}
