// One codec for flat-graph node IDs (review E-3). Graph code used to recognise IDs with
// startsWith('flow:') and split(':') in many files; decode with parseNodeId and build with
// nodeId (or the existing encoders flatId, branchId, animId, tableId, qteId, which agree).
//
// Formats (action, link, start and card IDs never contain ':' or '|'):
//   startCard:<uid>                start card (XML format 6 <Start>)
//   conditionCard:<uid>            condition card
//   transition:<link>              transition card
//   qte:<id>                       QTE node                    (qteId)
//   notify:<owner>|<local>         notify/feature row; <local> may contain ':'
//   shared:<name>                  shared endpoint (shared:outputPose)
//   <graphId(scope)>|<local>       node inside a non-root graph scope (flatId)
//   anything else                  root node: action uid, entry, blend IDs, notes
import type {GraphRef} from './state.ts';
import {graphId} from './state.ts';

export type ScopeRef = Exclude<GraphRef, {kind: 'root'}>;
export type NodeRef =
  | {kind: 'startCard'; uid: string}
  | {kind: 'conditionCard'; uid: string}
  | {kind: 'transition'; link: string}
  | {kind: 'qte'; id: string}
  | {kind: 'notify'; owner: string; local: string}
  | {kind: 'shared'; name: string}
  | {kind: 'scoped'; scope: ScopeRef; local: string}
  | {kind: 'plain'; id: string};

const after = (text: string, prefix: string) => (text.startsWith(prefix) ? text.slice(prefix.length) : undefined);

/** graphId(scope) back to the scope; undefined for 'root' and anything else. */
export function parseScope(text: string): ScopeRef | undefined {
  const [kind, first, ...rest] = text.split(':');
  if (!first) return undefined;
  switch (kind) {
    case 'start':
      return rest.length ? undefined : {kind, action: first};
    case 'link':
      return rest.length ? undefined : {kind: 'link', link: first};
    case 'anim':
      return rest.length === 1
        ? rest[0]
          ? {kind: 'anim', action: first, step: rest[0]}
          : {kind: 'anim', action: first}
        : undefined;
    default:
      return undefined;
  }
}

export function parseNodeId(id: string): NodeRef {
  let rest: string | undefined;
  if ((rest = after(id, 'startCard:')) !== undefined) {
    if (rest) return {kind: 'startCard', uid: rest};
  } else if ((rest = after(id, 'conditionCard:')) !== undefined) {
    if (rest) return {kind: 'conditionCard', uid: rest};
  } else if ((rest = after(id, 'transition:')) !== undefined) {
    if (rest) return {kind: 'transition', link: rest};
  } else if ((rest = after(id, 'qte:')) !== undefined) {
    if (rest) return {kind: 'qte', id: rest};
  } else if ((rest = after(id, 'notify:')) !== undefined) {
    const cut = rest.indexOf('|');
    if (cut > 0) return {kind: 'notify', owner: rest.slice(0, cut), local: rest.slice(cut + 1)};
  } else if ((rest = after(id, 'shared:')) !== undefined) {
    if (rest) return {kind: 'shared', name: rest};
  } else {
    const cut = id.indexOf('|');
    const scope = cut > 0 ? parseScope(id.slice(0, cut)) : undefined;
    if (scope) return {kind: 'scoped', scope, local: id.slice(cut + 1)};
  }
  return {kind: 'plain', id};
}

export function nodeId(ref: NodeRef): string {
  switch (ref.kind) {
    case 'startCard':
      return 'startCard:' + ref.uid;
    case 'conditionCard':
      return 'conditionCard:' + ref.uid;
    case 'transition':
      return 'transition:' + ref.link;
    case 'qte':
      return 'qte:' + ref.id;
    case 'notify':
      return `notify:${ref.owner}|${ref.local}`;
    case 'plain':
      return ref.id;
    case 'shared':
      return 'shared:' + ref.name;
    case 'scoped':
      return `${graphId(ref.scope)}|${ref.local}`;
  }
}
