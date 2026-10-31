/** How an action starts, shown under its HKX card's title (10-20, mockup A "시작" row): a start card going to it (the
 *  row picks it), only through condition cards or other actions (a transition, a QTE result), or nothing yet (the row
 *  offers to add a start key or event). */
import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {gamepadXml, gameControlLabel} from '../keys.ts';
import {pressName, refAction, refCard, type Ref} from '../cards.ts';
import {tr} from '../i18n/korean.ts';

export type StartRow = {tone: 'set' | 'via' | 'none'; text: string; node?: string};

export function startRow(
  w: Workspace,
  n: FlatNode,
  _graph?: {nodes: FlatNode[]; edges: GraphEdge[]}
): StartRow | undefined {
  const a = n.kind === 'hkxPlay' ? w.actions.find(a => a.uid === n.action) : undefined;
  if (!a || n.step !== a.config.entry) return undefined;
  const own = w.starts.filter(s => refAction(s.to) === a.uid);
  if (own.length) {
    const s = own[0];
    const text =
      s.mode === 'input'
        ? (s.control
            ? gameControlLabel(s.control)
            : tr('키 {key}', {key: s.key || (s.gamepad ? gamepadXml(s.gamepad) : '—')})) +
          (s.press !== 'down' ? ' · ' + pressName(s.press) : '')
        : tr('이벤트 {v0}', {v0: s.event || tr('미지정')});
    return {
      tone: 'set',
      text: text + (own.length > 1 ? tr(' 외 {v0}', {v0: own.length - 1}) : ''),
      node: 'startCard:' + s.uid,
    };
  }
  // Reached through condition cards: the cards that can play it.
  const reaches = (r: Ref, seen = new Set<string>()): boolean => {
    if (refAction(r) === a.uid) return true;
    const c = w.cards.find(c => c.uid === refCard(r));
    if (!c || seen.has(c.uid)) return false;
    seen.add(c.uid);
    return [...c.rows.map(r => r.to), c.true ?? null, c.false].some(r => reaches(r, seen));
  };
  const names = new Set<string>();
  if (w.starts.some(s => refCard(s.to) && reaches(s.to))) names.add(tr('조건 카드'));
  // A transition shared by many actions is one card on the canvas: name every action whose link leads here.
  for (const l of w.links)
    if ((l.to === a.uid || l.partnerTo === a.uid || (l.card && reaches({card: l.card}))) && l.from !== a.uid) {
      const from = w.actions.find(x => x.uid === l.from);
      if (from) names.add(from.config.name || from.config.actionId);
    }
  // A carry's putdown: its key on the carrying pair starts it.
  for (const x of w.actions)
    if (x.pair?.carry?.putdownAction === a.uid && x.uid !== a.uid) names.add(x.config.name || x.config.actionId);
  // A QTE whose result starts this action: named by its action, or by the event that asks it.
  for (const q of w.qtes ?? [])
    if (
      Object.values(q.results).some(
        r => r.mode === 'transition' && (r.to === a.uid || r.partnerTo === a.uid || (r.card && reaches({card: r.card})))
      )
    ) {
      const owner = w.actions.find(x => x.uid === q.owner);
      if (owner && owner.uid !== a.uid) names.add(owner.config.name || owner.config.actionId);
      else if (q.eventStart !== undefined) names.add(tr('이벤트 {v0} QTE', {v0: q.eventStart || tr('미지정')}));
    }
  if (names.size) {
    const list = [...names];
    return {
      tone: 'via',
      text: tr('전환으로만 ({v0})', {
        v0: list[0] + (list.length > 1 ? tr(' 외 {v0}', {v0: list.length - 1}) : ''),
      }),
    };
  }
  return {tone: 'none', text: tr('시작 방법 없음')};
}
