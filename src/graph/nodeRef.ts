// One codec for flat-graph node IDs (review E-3). Graph code used to recognise IDs with
// startsWith('flow:') and split(':') in many files; decode with parseNodeId and build with
// nodeId (or the existing encoders flatId, branchId, animId, tableId, qteId, which agree).
//
// Formats (action and link IDs never contain ':' or '|'):
//   flow:<owner>:<test>            condition branch            (branchId)
//   conditionTable:<owner>         condition table view node   (tableId)
//   qte:<id>                       QTE node                    (qteId)
//   notify:<owner>|<local>         notify/feature row; <local> may contain ':'
//   draft:<n>                      unconnected draft node
//   shared:<name>                  shared endpoint (shared:outputPose)
//   <graphId(scope)>|<local>       node inside a non-root graph scope (flatId)
//   anything else                  root node: action uid, entry, blend IDs, notes
import type {GraphRef} from './state.ts';
import {graphId} from './state.ts';

export type ScopeRef = Exclude<GraphRef, {kind: 'root'}>;
export type NodeRef =
  | {kind: 'branch'; owner: string; test: string}
  | {kind: 'table'; owner: string}
  | {kind: 'qte'; id: string}
  | {kind: 'notify'; owner: string; local: string}
  | {kind: 'draft'; id: string}
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
  if ((rest = after(id, 'flow:')) !== undefined) {
    const cut = rest.indexOf(':');
    if (cut > 0) return {kind: 'branch', owner: rest.slice(0, cut), test: rest.slice(cut + 1)};
  } else if ((rest = after(id, 'conditionTable:')) !== undefined) {
    if (rest) return {kind: 'table', owner: rest};
  } else if ((rest = after(id, 'qte:')) !== undefined) {
    if (rest) return {kind: 'qte', id: rest};
  } else if ((rest = after(id, 'notify:')) !== undefined) {
    const cut = rest.indexOf('|');
    if (cut > 0) return {kind: 'notify', owner: rest.slice(0, cut), local: rest.slice(cut + 1)};
  } else if (/^draft:\d+$/.test(id)) {
    return {kind: 'draft', id};
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
    case 'branch':
      return `flow:${ref.owner}:${ref.test}`;
    case 'table':
      return 'conditionTable:' + ref.owner;
    case 'qte':
      return 'qte:' + ref.id;
    case 'notify':
      return `notify:${ref.owner}|${ref.local}`;
    case 'draft':
    case 'plain':
      return ref.id;
    case 'shared':
      return 'shared:' + ref.name;
    case 'scoped':
      return `${graphId(ref.scope)}|${ref.local}`;
  }
}

/** Action that owns the node, when the ID itself names one. */
export function nodeOwner(ref: NodeRef): string | undefined {
  switch (ref.kind) {
    case 'branch':
    case 'table':
    case 'notify':
      return ref.owner;
    case 'scoped':
      return 'action' in ref.scope ? ref.scope.action : undefined;
    default:
      return undefined;
  }
}

/** Test ID of a condition branch node (flow:<owner>:<test>), else undefined. */
export function branchTest(id: string): string | undefined {
  const ref = parseNodeId(id);
  return ref.kind === 'branch' ? ref.test : undefined;
}

/** True when the node lies directly inside the given graph scope (<graphId(scope)>|<local>). */
export function inScope(id: string, scope: ScopeRef): boolean {
  const ref = parseNodeId(id);
  return ref.kind === 'scoped' && graphId(ref.scope) === graphId(scope);
}
