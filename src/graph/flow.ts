import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';
import {portLabel} from './pinTargets.ts';
import {presentCard} from './cardPresentation.ts';
import {tr} from '../i18n/korean.ts';

// Where a card is reached from and where it goes on (Details, 11-12): the canvas says it with lines, which have to be
// followed; here they are a list. Read from the canvas's own view (graph/checklist.ts), so it says what is drawn.

type View = {nodes: FlatNode[]; edges: GraphEdge[]};
/** A card at the other end of a line: `pin` names the output the line leaves (성공, True, 가해자 …), '' when the card
 *  has one way on; `event` is the event a QTE result sends to it. */
export type FlowEnd = {node: string; title: string; kind: string; pin: string; event?: string};
/** Where the card goes: a card it goes to, or (via) a transition or QTE of its own and where that goes. */
export type FlowOut = {via?: {node: string; title: string; kind: string}; ends: FlowEnd[]};
/** What leads to the card, and what leads to that (the titles one step further back). */
export type FlowIn = FlowEnd & {before: string[]};
export type CardFlow = {incoming: FlowIn[]; outgoing: FlowOut[]};

/** A card a flow passes through on its way to an HKX or a condition: its own destinations are what matter. */
const passes = (n: FlatNode) => n.kind === 'transition' || n.kind === 'qte';
/** The cards with one way on: the pin's name ("도착") says nothing. */
const single = (n: FlatNode) => n.kind === 'hkxPlay' || n.kind === 'startCard' || n.kind === 'markerReceive';

export function cardFlow(w: Workspace, view: View, id: string): CardFlow {
  const byId = new Map<string, FlatNode>();
  for (const n of view.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const node = byId.get(id);
  if (!node) return {incoming: [], outgoing: []};
  // A transition is told from its HKX's others by how it is taken (its summary: the key's press, its window); its
  // title is only its key.
  const title = (n: FlatNode) =>
    n.id.startsWith('transition:') && n.summary ? tr('전환') + ' · ' + n.summary : presentCard(w, n).title;
  const name = (n: FlatNode) => presentCard(w, n).title.split(' · ').slice(1).join(' · ') || presentCard(w, n).title;
  // A condition's row is its number on the card; alone in a list it needs its word. A pin that only says "도착"
  // (a transition's one way on) says nothing.
  const pin = (from: FlatNode, e: GraphEdge) => {
    // A carry's other way on: the HKX it puts its partner down with.
    if (e.origins?.some(o => o.source.endsWith('|carry'))) return tr('내려놓기');
    if (single(from)) return '';
    const label = portLabel(from, e.pin);
    if (from.kind === 'conditionCard' && String(e.pin).startsWith('row:')) return tr('{n}번 행', {n: label});
    return label === tr('도착') ? '' : label;
  };
  const end = (from: FlatNode, e: GraphEdge, to: FlatNode): FlowEnd => ({
    node: to.id,
    title: title(to),
    kind: to.kind,
    pin: pin(from, e),
    ...(e.via ? {event: e.via} : {}),
  });
  const outgoing: FlowOut[] = [];
  const direct: FlowEnd[] = [];
  for (const e of view.edges) {
    if (e.source !== id) continue;
    const to = byId.get(e.target);
    if (!to) continue;
    const ends = passes(to)
      ? view.edges.flatMap(x => {
          const t = x.source === to.id ? byId.get(x.target) : undefined;
          return t ? [end(to, x, t)] : [];
        })
      : [];
    // A transition or QTE that goes nowhere yet is itself where the card goes.
    if (ends.length) outgoing.push({via: {node: to.id, title: title(to), kind: to.kind}, ends});
    else direct.push(end(node, e, to));
  }
  if (direct.length) outgoing.unshift({ends: direct});
  const incoming: FlowIn[] = [];
  for (const e of view.edges) {
    if (e.target !== id) continue;
    const from = byId.get(e.source);
    if (!from) continue;
    // One step further back; through a transition or QTE, the HKX it belongs to as well (several cards before may
    // be transitions of one key from different HKX).
    const before = [
      ...new Set(
        view.edges.flatMap(x => {
          const s = x.target === from.id ? byId.get(x.source) : undefined;
          if (!s) return [];
          if (!passes(s)) return [title(s)];
          const owners = view.edges.flatMap(y => {
            const o = y.target === s.id ? byId.get(y.source) : undefined;
            return o ? [name(o)] : [];
          });
          return [(owners.length ? [...new Set(owners)].join(', ') + ' → ' : '') + title(s)];
        })
      ),
    ];
    incoming.push({
      node: from.id,
      title: title(from),
      kind: from.kind,
      pin: pin(from, e),
      ...(e.via ? {event: e.via} : {}),
      before,
    });
  }
  return {incoming, outgoing};
}
/** How many cards the flow's lines reach (a group's ends, each once). */
export const flowCount = (out: FlowOut[]) => out.reduce((n, g) => n + g.ends.length, 0);
