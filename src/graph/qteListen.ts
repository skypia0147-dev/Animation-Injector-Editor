import type {Workspace} from '../workspace.ts';
import {outcomes, type Outcome} from '../qte.ts';
import type {FlatNode} from './flat.ts';
import {flatGraph} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {qteMembers} from './qteGroups.ts';
import {animId} from './blends.ts';
import {executeGraphCommand} from './commands.ts';
import {reuseConnection} from './reuseConnection.ts';
import {tr} from '../i18n/korean.ts';

// An action's QTE that sends an event to the action itself, which waits for that event to move on: the canvas draws
// the two as one line from the QTE's result (10-18, docs/mockup-qte-redesign/qte-listen-merge). The XML keeps the
// action's <Connect event="…">; cutting or drawing the QTE's line changes the result and that wait together.

export const pinOutcome = (pin: string): Outcome | undefined =>
  pin === 'pass' ? 'success' : pin === 'fail' ? 'failure' : pin === 'perfect' ? 'perfect' : undefined;

/** Which waits each QTE event line stands for. A wait stays drawn when the action's own HKX sends the event too
 *  (`sendsItself`): the QTE is then not the only way on. */
export function listenMerges(
  edges: GraphEdge[],
  nodes: Map<string, Pick<FlatNode, 'kind' | 'action'>>,
  sendsItself: (action: string, event: string) => boolean
) {
  const hidden = new Set<string>(),
    merged = new Map<string, GraphEdge[]>();
  for (const v of edges) {
    if (!v.via || !v.viaFrom?.length) continue;
    for (const action of v.viaFrom) {
      if (sendsItself(action, v.via)) continue;
      const wait = edges.find(
        e =>
          !e.via &&
          e.target === v.target &&
          nodes.get(e.source)?.kind === 'hkxPlay' &&
          nodes.get(e.source)?.action === action
      );
      if (!wait) continue;
      hidden.add(wait.id);
      merged.set(v.id, [...(merged.get(v.id) ?? []), wait]);
    }
  }
  return {hidden, merged};
}

/** Cutting a merged line: the QTE's rules that send its event to their own action go on ("계속"), and each of
 *  those actions stops waiting for the event unless another of its own QTE rules still sends it. */
export function cutQteListen(
  w: Workspace,
  line: GraphEdge,
  waits: GraphEdge[],
  actionOf: (node: string) => string | undefined
): Workspace {
  const k = pinOutcome(line.pin);
  if (!k || !line.via) return w;
  const owners = new Set(waits.map(e => actionOf(e.source)).filter(Boolean) as string[]);
  let next = structuredClone(w);
  for (const q of qteMembers(next, line.source)) {
    const r = q.results[k];
    if (owners.has(q.owner) && r.mode === 'event' && r.event === line.via && r.recipient !== 'partner') {
      r.mode = 'continue';
      r.event = '';
    }
  }
  for (const wait of waits) {
    const a = actionOf(wait.source);
    const still = (next.qtes ?? []).some(
      q =>
        q.owner === a &&
        q.eventStart === undefined &&
        outcomes.some(
          o => q.results[o].mode === 'event' && q.results[o].event === line.via && q.results[o].recipient !== 'partner'
        )
    );
    if (!still) next = executeGraphCommand(next, {type: 'disconnect', edge: wait}).workspace;
  }
  return next;
}

/** Drawing a QTE result onto a "전환 이벤트" card: the result sends that event to the QTE's action, and the action
 *  waits for it (joining the card's shared transition). undefined: not a QTE result onto an event transition. */
export function connectQteToEvent(w: Workspace, qteCard: string, pin: string, target: string): Workspace | undefined {
  const k = pinOutcome(pin),
    link = /^link:(.+)\|markerReceive$/.exec(target);
  if (!k || !link || !qteCard.startsWith('qte:')) return undefined;
  const transition = w.links.find(l => l.id === link[1]);
  if (!transition || transition.mode !== 'event' || !transition.event) return undefined;
  const members = qteMembers(w, qteCard);
  if (members.length !== 1) throw Error(tr('묶음 QTE는 디테일의 "규칙별 설정"에서 규칙마다 결과 이벤트를 고르세요.'));
  let next = structuredClone(w);
  const q = next.qtes!.find(x => x.id === members[0].id)!;
  q.results[k] = {...q.results[k], mode: 'event', event: transition.event, recipient: 'self'};
  // An event QTE has no action: it only sends the event.
  if (!q.owner || q.eventStart !== undefined) return next;
  if (next.links.some(l => l.from === q.owner && l.mode === 'event' && l.event === transition.event)) return next;
  const owner = next.actions.find(a => a.uid === q.owner)!,
    raw = flatGraph(next),
    play = raw.nodes.find(n => n.id === animId(owner.uid, 'clip_' + (q.step || owner.config.entry))),
    card = raw.nodes.find(n => n.id === target);
  const joined = reuseConnection(next, play, card);
  if (!joined) throw Error(tr('이 동작이 이 전환 이벤트를 기다리도록 만들 수 없습니다.'));
  next = joined;
  return next;
}
