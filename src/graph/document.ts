import {shareUnchanged} from './historySharing.ts';
import type {Workspace, Action} from '../workspace.ts';
import type {DocumentAction} from './state.ts';
import {tr} from '../i18n/korean.ts';

// The graph is the editable document. Workspace is a temporary adapter for the
// existing inspectors and XML backend, not a second persisted source of truth.
export type AuthorNode = {id: string; kind: string; data: any};
export type AuthorEdge = {id: string; source: string; target: string; role: string};
/** Schema 9 (XML format 6): an action has no start of its own (starts and condition cards are the meta's). */
export type AuthorGraph = {
  schema: 9;
  meta: Omit<Workspace, 'actions' | 'links' | 'schema'>;
  nodes: AuthorNode[];
  edges: AuthorEdge[];
  optional: {drafts: boolean; blends: boolean};
};

// Capture and lower share records instead of copying them: documents are never changed in place (edit()
// changes a copy; development builds freeze the rendered one). Lowering the history's present, whose unchanged
// records are the previous present's, gives a document whose unchanged records are the previous document's,
// so the rendered document's sharing stops at them (2026-09-30: an edit copied Grapple three times here).
export function captureGraph(w: Workspace): AuthorGraph {
  const {actions, links, schema, ...meta} = w;
  const g: AuthorGraph = {
    schema: 9,
    meta,
    nodes: [],
    edges: [],
    optional: {drafts: false, blends: false},
  };
  const node = (id: string, kind: string, data: any) => {
    g.nodes.push({id, kind, data});
    return id;
  };
  const edge = (source: string, target: string, role: string) =>
    g.edges.push({id: `e${g.edges.length + 1}`, source, target, role});
  for (const a of actions) {
    const {config, ...settings} = a;
    const {steps, inputs, entry, ...common} = config;
    const owner = node(`action:${a.uid}`, 'settings', {...settings, config: common});
    for (const s of steps) {
      const id = node(`play:${a.uid}:${s.id}`, 'play', s);
      edge(owner, id, 'owns');
      if (entry === s.id) edge(owner, id, 'entry');
    }
    for (const input of inputs) edge(owner, node(`input:${a.uid}:${input.id}`, 'input', input), 'owns');
  }
  for (const l of links) {
    const {from, to, partnerTo, input, ...value} = l;
    const id = node(`link:${l.id}`, 'link', value);
    edge(`action:${from}`, id, 'flow');
    // A transition with no destination yet, or one to a condition card (`card`, kept in its data), has no action
    // to point at (10-28 review E-16: the edge went to a missing `action:` node and every edit was refused).
    if (to) edge(id, `action:${to}`, 'flow');
    if (partnerTo) edge(id, `action:${partnerTo}`, 'partner');
    if (input) edge(id, `input:${from}:${input}`, 'input');
  }
  return g;
}

export function lowerGraph(g: AuthorGraph): Workspace {
  if (
    !g ||
    ((g.schema as number) !== 8 && g.schema !== 9) ||
    !g.meta ||
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges) ||
    !g.optional ||
    typeof g.optional.drafts !== 'boolean' ||
    typeof g.optional.blends !== 'boolean' ||
    g.nodes.length > 20000 ||
    g.edges.length > 60000
  )
    throw Error(tr('카드 문서 형식 오류'));
  const kinds = ['settings', 'play', 'input', 'link', 'draft', 'blend'];
  const ids = new Map<string, AuthorNode>();
  for (const n of g.nodes) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      !n.id ||
      ids.has(n.id) ||
      !kinds.includes(n.kind) ||
      !n.data ||
      typeof n.data !== 'object'
    )
      throw Error(tr('카드 ID 또는 형식 오류'));
    ids.set(n.id, n);
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (!e || typeof e.id !== 'string' || edgeIds.has(e.id) || !ids.has(e.source) || !ids.has(e.target))
      throw Error(tr('연결 ID 또는 연결 대상 오류'));
    edgeIds.add(e.id);
    const s = ids.get(e.source)!.kind,
      t = ids.get(e.target)!.kind;
    const valid =
      e.role === 'owns'
        ? s === 'settings' && ['play', 'input'].includes(t)
        : e.role === 'entry'
          ? s === 'settings' && t === 'play'
          : e.role === 'input'
            ? s === 'link' && t === 'input'
            : e.role === 'partner'
              ? s === 'link' && t === 'settings'
              : e.role === 'flow' && ((s === 'settings' && t === 'link') || (s === 'link' && t === 'settings'));
    if (!valid) throw Error(tr('지원하지 않는 연결 역할: ') + e.id);
  }
  // The edges by role and endpoint, in document order (a scan of every edge per lookup ran on each edit).
  const bySource = new Map<string, AuthorEdge[]>(),
    byTarget = new Map<string, AuthorEdge[]>();
  const index = (map: Map<string, AuthorEdge[]>, key: string, e: AuthorEdge) => {
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  };
  for (const e of g.edges) {
    index(bySource, e.role + '|' + e.source, e);
    index(byTarget, e.role + '|' + e.target, e);
  }
  const related = (id: string, role: string, out = true) =>
    ((out ? bySource : byTarget).get(role + '|' + id) ?? []).map(e => ids.get(out ? e.target : e.source)!);
  const one = (id: string, role: string, out = true, required = false) => {
    const ns = related(id, role, out);
    if (ns.length > 1 || (required && !ns.length)) throw Error(id + ': ' + role + tr(' 연결 개수 오류'));
    return ns[0];
  };
  const ownerOf = (n: AuthorNode) => one(n.id, 'owns', false, true)!;
  for (const n of g.nodes.filter(n => ['play', 'input'].includes(n.kind))) ownerOf(n);
  const w = {...g.meta, schema: 9, actions: [], links: []} as unknown as Workspace & {
    drafts?: unknown;
    blends?: unknown;
  };
  for (const n of g.nodes.filter(n => n.kind === 'settings')) {
    const a = {...n.data} as Action,
      children = related(n.id, 'owns');
    const entry = one(n.id, 'entry');
    if (entry && ownerOf(entry).id !== n.id) throw Error(n.id + tr(': 다른 동작의 입력/진입 참조'));
    a.config = {
      ...a.config,
      steps: children.filter(c => c.kind === 'play').map(c => c.data),
      inputs: children.filter(c => c.kind === 'input').map(c => c.data),
      entry: entry?.data.id ?? '',
    };
    w.actions.push(a);
  }
  for (const n of g.nodes.filter(n => n.kind === 'link')) {
    const from = one(n.id, 'flow', false, true)!,
      to = one(n.id, 'flow', true),
      input = one(n.id, 'input');
    if (input && ownerOf(input).id !== from.id) throw Error(n.id + tr(': 입력 소유 범위 오류'));
    w.links.push({
      ...n.data,
      from: from.data.uid,
      to: to?.data.uid ?? '',
      partnerTo: one(n.id, 'partner')?.data.uid ?? '',
      input: input?.data.id ?? '',
    });
  }
  if (g.optional.drafts) w.drafts = g.nodes.filter(n => n.kind === 'draft').map(n => n.data);
  if (g.optional.blends) w.blends = g.nodes.filter(n => n.kind === 'blend').map(n => n.data);
  return w;
}

export type AuthorHistory = {present: AuthorGraph; past: AuthorGraph[]; future: AuthorGraph[]};
export function authorReducer(s: AuthorHistory, a: DocumentAction): AuthorHistory {
  if (a.type === 'undo')
    return s.past.length ? {present: s.past.at(-1)!, past: s.past.slice(0, -1), future: [s.present, ...s.future]} : s;
  if (a.type === 'redo')
    return s.future.length ? {present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1)} : s;
  const next = a.type === 'edit' && a.graph ? a.graph : captureGraph(a.next);
  if (a.type === 'adopt') return {present: next, past: [], future: []};
  if (a.type === 'replace') return {...s, present: next};
  const present = shareUnchanged(s.present, next);
  if (present === s.present) return s;
  return {present, past: [...s.past, s.present].slice(-100), future: []};
}
