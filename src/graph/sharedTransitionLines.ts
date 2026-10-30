import type {FlatNode} from './flat.ts';
import type {GraphEdge} from './projection.ts';

/**
 * A transition card this many HKX or more lead to (an event transition several HKX share, graph/sharing.ts) is drawn
 * without its lines (docs/mockup-arrange-branches B, 10-30: Dynamic Block Hit's 76 lines into one card covered the
 * graph). Each HKX shows the card's number instead, and the card how many use it. A line is drawn while its HKX,
 * the transition card or the line itself is chosen, so it is cut and joined as any other line. Fewer HKX: lines.
 */
export const STUB_SOURCES = 3;

export type StubLines = {
  /** Each line not drawn: its id and the transition card it goes to. */
  lines: Map<string, string>;
  /** An HKX card's marks: the line and the transition card's number. */
  marks: Map<string, {edge: string; mark: string}[]>;
  /** A transition card's number and how many HKX lead to it. */
  cards: Map<string, {mark: string; count: number}>;
};

const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`);

export function stubLines(nodes: Pick<FlatNode, 'id' | 'kind'>[], edges: GraphEdge[]): StubLines {
  const kind = new Map(nodes.map(n => [n.id, n.kind]));
  const into = new Map<string, GraphEdge[]>();
  for (const e of edges)
    if (kind.get(e.target) === 'transition' && kind.get(e.source) === 'hkxPlay')
      into.set(e.target, [...(into.get(e.target) ?? []), e]);
  const result: StubLines = {lines: new Map(), marks: new Map(), cards: new Map()};
  let number = 0;
  // Numbered in the cards' order.
  for (const n of nodes) {
    const list = into.get(n.id);
    if (!list || new Set(list.map(e => e.source)).size < STUB_SOURCES) continue;
    const mark = circled(++number);
    result.cards.set(n.id, {mark, count: new Set(list.map(e => e.source)).size});
    for (const e of list) {
      result.lines.set(e.id, n.id);
      result.marks.set(e.source, [...(result.marks.get(e.source) ?? []), {edge: e.id, mark}]);
    }
  }
  return result;
}

/** A line is drawn unless it is one of `stubs` and neither of its cards nor the line itself is chosen. */
export const drawnLine = (stubs: StubLines, e: GraphEdge, chosen: Set<string>, selectedEdge: string) =>
  !stubs.lines.has(e.id) || chosen.has(e.source) || chosen.has(e.target) || e.id === selectedEdge;
