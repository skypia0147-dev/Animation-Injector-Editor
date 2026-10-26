import type {Workspace} from '../workspace.ts';
import type {GraphEdge} from './projection.ts';
import {addFlat, connectFlat, setDestination, deleteFlat} from './flat.ts';
import {addConnected, type AddOption} from './contextAdd.ts';
import {deleteChecklistNode} from './checklist.ts';
import {parseNodeId} from './nodeRef.ts';
import {removeQteRule, qteMembers, qtePinRule} from './qteGroups.ts';
import {setPutdown} from '../carry.ts';
import {tr} from '../i18n/korean.ts';

export type GraphCommand =
  | {type: 'add'; owner: string; kind: string; position: {x: number; y: number}}
  | {type: 'addConnected'; source: string; option: AddOption; position: {x: number; y: number}}
  | {type: 'connect'; source: string; target: string; port?: string}
  | {type: 'disconnect'; edge: GraphEdge}
  | {type: 'delete'; id: string};

/** Cutting a line: the destination it drew leads nowhere now; a line into a transition deletes the transition (a
 *  transition is its source's). A QTE's line takes its result back to "continue"; a carry's its putdown. */
export function disconnectEdge(w: Workspace, e: GraphEdge): Workspace {
  const from = parseNodeId(e.source),
    to = parseNodeId(e.target);
  // A line drawn once for equal transition cards (sharing.ts) stands for each of them: its origins.
  const parts = e.origins?.length ? e.origins : [e];
  if (from.kind === 'startCard' || from.kind === 'conditionCard' || from.kind === 'transition')
    return parts.reduce((n, o) => setDestination(n, o.source, o.pin ?? e.pin, null), w);
  if (to.kind === 'transition') return parts.reduce((n, o) => deleteFlat(n, o.target), w);
  // A dashed line to an event's listener only shows where a QTE result's event goes: its result says so.
  if (e.via) throw Error(tr('이벤트로 이어지는 선입니다. QTE 결과에서 이벤트를 바꾸세요.'));
  if (from.kind === 'qte') return deleteQteLine(w, e);
  // An event QTE's start line: as deleting its event card, the QTE stays, detached.
  if (e.source.startsWith('qte-event:')) return deleteFlat(w, e.source);
  // An HKX's line into its QTE: that action's rules leave a group the others keep; the last one stays, unattached.
  if (to.kind === 'qte') {
    const action = /^anim:([^:]+):/.exec(e.source)?.[1] ?? '';
    let n = w;
    for (;;) {
      const members = qteMembers(n, e.target),
        own = members.find(q => q.owner === action);
      if (!own || !members.some(q => q.owner && q.owner !== action)) break;
      const after = removeQteRule(n, e.target, own.id);
      if (after === n) break;
      n = after;
    }
    if (n !== w) return n;
    const next = structuredClone(w);
    const members = qteMembers(next, e.target),
      own = members.filter(q => q.owner === action);
    for (const q of own.length ? own : members) {
      q.owner = '';
      q.step = '';
    }
    return next;
  }
  // A carry's line to its putdown: the putdown is chosen again.
  if ((e.pin.startsWith('embedded:') && e.pin.includes('carry')) || /^anim:[^:]+:\|carry$/.test(e.source)) {
    const owner = w.actions.find(a => e.source.startsWith(`anim:${a.uid}:`));
    if (owner?.pair?.carry) return setPutdown(w, owner.uid, '');
  }
  // An HKX card's line to one of its own items (a feature, a moment): cutting it takes the item off.
  const owner = /^anim:([^:]+):\|clip_/.exec(e.source)?.[1];
  if (
    owner &&
    (e.target.startsWith(`anim:${owner}:`) ||
      e.target.startsWith(`notify:${owner}|`) ||
      e.target === `start:${owner}|stateCondition`)
  )
    return deleteFlat(w, e.target);
  throw Error(tr('이 선은 끊을 수 없습니다. 카드를 지우세요.'));
}
function deleteQteLine(w: Workspace, e: GraphEdge): Workspace {
  const n = structuredClone(w),
    r = qtePinRule(qteMembers(n, e.source), e.pin);
  if (!r) throw Error(tr('QTE 결과를 찾지 못했습니다.'));
  const result = r.q.results[r.outcome];
  if (r.partner) result.partnerTo = '';
  else {
    result.mode = 'continue';
    result.to = '';
    delete result.card;
    result.partnerTo = '';
  }
  return n;
}

// One invocation is one document edit. View-only grouping and focus stay outside.
export function executeGraphCommand(w: Workspace, command: GraphCommand): {workspace: Workspace; id?: string} {
  switch (command.type) {
    case 'add':
      return addFlat(w, command.owner, command.kind, command.position);
    case 'addConnected':
      return addConnected(w, command.source, command.option, command.position);
    case 'connect':
      return {workspace: connectFlat(w, command.source, command.target, command.port)};
    case 'disconnect':
      return {workspace: disconnectEdge(w, command.edge)};
    case 'delete':
      return {workspace: deleteChecklistNode(w, command.id)};
  }
}
