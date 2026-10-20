import {shareUnchanged} from './historySharing.ts';
import type {Workspace} from '../workspace.ts';
import type {AuthorGraph} from './document.ts';
export type GraphRef =
  | {kind: 'root'}
  | {kind: 'anim'; action: string; step?: string}
  | {kind: 'start'; action: string}
  | {kind: 'link'; link: string};
export type ResourceKind = 'project' | 'inputs' | 'markers' | 'parameters' | 'effects' | 'preferences';
export type Selection =
  | {kind: 'notify'; action: string; id: string}
  | {kind: 'state'; action: string}
  | {kind: 'link'; link: string}
  | {kind: 'resource'; id: ResourceKind}
  | {kind: 'node'; graph: GraphRef; node: string};
export const rootGraph: GraphRef = {kind: 'root'};
export const graphId = (g: GraphRef): string =>
  g.kind === 'root'
    ? 'root'
    : g.kind === 'link'
      ? 'link:' + g.link
      : g.kind + ':' + g.action + (g.kind === 'anim' ? ':' + (g.step ?? '') : '');
export type UIState = {graph: GraphRef; tabs: GraphRef[]; selection: Selection};
export const initialUI: UIState = {graph: rootGraph, tabs: [rootGraph], selection: {kind: 'resource', id: 'project'}};
export type UIAction =
  | {type: 'select'; selection: Selection}
  | {type: 'open'; graph: GraphRef}
  | {type: 'close'; graph: GraphRef}
  | {type: 'reset'};
export function uiReducer(s: UIState, a: UIAction): UIState {
  if (a.type === 'reset') return initialUI;
  if (a.type === 'select') return {...s, selection: a.selection};
  if (a.type === 'open')
    return {
      ...s,
      graph: a.graph,
      tabs: s.tabs.some(g => graphId(g) === graphId(a.graph)) ? s.tabs : [...s.tabs, a.graph],
      selection: {kind: 'node', graph: a.graph, node: ''},
    };
  if (a.graph.kind === 'root') return s;
  const tabs = s.tabs.filter(g => graphId(g) !== graphId(a.graph));
  return {
    ...s,
    tabs,
    graph: graphId(s.graph) === graphId(a.graph) ? rootGraph : s.graph,
    selection: {kind: 'resource', id: 'project'},
  };
}
export type DocumentState = {present: Workspace; past: Workspace[]; future: Workspace[]};
export type DocumentAction =
  // `graph`: captureGraph(next) already computed by the caller (the edit round-trip check).
  | {type: 'edit'; next: Workspace; graph?: AuthorGraph}
  | {type: 'adopt'; next: Workspace}
  // The present document without a history step (an import's own layout, applied once it is drawn).
  | {type: 'replace'; next: Workspace}
  | {type: 'undo'}
  | {type: 'redo'};
export function documentReducer(s: DocumentState, a: DocumentAction): DocumentState {
  if (a.type === 'adopt') return {present: a.next, past: [], future: []};
  if (a.type === 'replace') return {...s, present: a.next};
  if (a.type === 'undo')
    return s.past.length ? {present: s.past.at(-1)!, past: s.past.slice(0, -1), future: [s.present, ...s.future]} : s;
  if (a.type === 'redo')
    return s.future.length ? {present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1)} : s;
  if (s.present === a.next) return s;
  const present = shareUnchanged(s.present, a.next);
  if (present === s.present) return s;
  return {present, past: [...s.past, s.present].slice(-100), future: []};
}
