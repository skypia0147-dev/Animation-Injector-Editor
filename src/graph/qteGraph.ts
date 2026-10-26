import type {Workspace} from '../workspace.ts';
import {newQte, outcomes, qteTypes, type Outcome} from '../qte.ts';
import type {FlatNode} from './flat.ts';
import type {GraphEdge, Pin} from './projection.ts';
import {graphPosition, moveNodes} from './projection.ts';
import {qteMembers, qteRulePin, qtePinRule, copyQteRules} from './qteGroups.ts';
import {animId} from './blends.ts';
import {tr} from '../i18n/korean.ts';
export const qteId = (id: string) => 'qte:' + id;
/** An event QTE's cards (runtime 0.12.248): the event that starts it, and an event a result sends. */
export const qteEventId = (id: string) => 'qte-event:' + id;
export const qteEmitId = (id: string, k: Outcome) => `qte-emit:${id}:${k}`;
/** The QTE card a card of an event QTE belongs to ('qte:<id>'), or ''. */
export const qteCardOf = (id: string) => {
  const m = /^qte-(?:event|emit):([^:]+)/.exec(id);
  return m ? 'qte:' + m[1] : '';
};
export const resultPin = (k: Outcome): Pin => (k === 'success' ? 'pass' : k === 'failure' ? 'fail' : 'perfect');
export function projectQtes(w: Workspace, nodes: FlatNode[], edges: GraphEdge[]) {
  // Lookups by id, first match like find() (a project has hundreds of QTEs, each wired a few times).
  const byId = new Map<string, FlatNode>();
  const indexNode = (n: FlatNode) => {
    if (!byId.has(n.id)) byId.set(n.id, n);
  };
  nodes.forEach(indexNode);
  const actions = new Map<string, (typeof w.actions)[number]>();
  for (const a of w.actions) if (!actions.has(a.uid)) actions.set(a.uid, a);
  const qtes = w.qtes ?? [],
    firstOfGroup = new Map<string, (typeof qtes)[number]>(),
    groups = new Map<string, typeof qtes>();
  for (const q of qtes)
    if (q.group) {
      if (!firstOfGroup.has(q.group)) firstOfGroup.set(q.group, q);
      const list = groups.get(q.group);
      if (list) list.push(q);
      else groups.set(q.group, [q]);
    }
  // qteVisualId and qteMembers (qteGroups.ts) over the indexes.
  const visualId = (q: (typeof qtes)[number]) => 'qte:' + (q.group ? firstOfGroup.get(q.group)!.id : q.id);
  const membersOf = (q: (typeof qtes)[number]) => (q.group ? groups.get(q.group)! : [q]);
  const wire = (source: string, target: string, pin: Pin) => {
    const s = byId.get(source),
      d = byId.get(target);
    if (!s || !d) return;
    if (!s.outputs.includes(pin)) s.outputs = [...s.outputs, pin];
    if (!d.inputs.includes('trigger')) d.inputs = [...d.inputs, 'trigger'];
    edges.push({id: `qte-edge:${source}>${target}:${pin}`, source, target, pin, targetPin: 'trigger'});
  };
  const seen = new Set<string>();
  for (const q of qtes) {
    const id = visualId(q);
    if (seen.has(id)) continue;
    seen.add(id);
    // The first QTE of its visual id is q itself (or the group's first), as qteMembers(w, id) finds it.
    const members = membersOf(q),
      grouped = !!q.group,
      owner = actions.get(q.owner),
      source = owner ? animId(owner.uid, 'clip_' + (q.step || owner.config.entry)) : '';
    const origin = byId.get(source)?.position ?? {x: 200, y: 200};
    const outputs: Pin[] = grouped
      ? members.flatMap(m =>
          outcomes
            .filter(k => m.results[k].mode === 'transition')
            .flatMap(k => [qteRulePin(m.id, k), ...(m.results[k].partnerTo ? [qteRulePin(m.id, k, true)] : [])])
        )
      : [
          'pass',
          'fail',
          'perfect',
          // A pair's QTE that hands over has a victim pin too, chosen or not (an empty one is dragged from); an
          // event's QTE its partner's (runtime 0.12.264: asked during a pair, the partner goes there).
          ...outcomes
            .filter(
              k =>
                q.results[k].partnerTo ||
                (q.results[k].mode === 'transition' && (q.eventStart !== undefined || !!owner?.pair))
            )
            .map(k => `choice:${k}:partner` as Pin),
        ];
    nodes.push({
      id,
      original: id,
      kind: 'qte',
      title: q.group || q.name || 'QTE',
      summary: grouped
        ? tr('{size}개 동작 · {length}개 규칙 · {v2} · {speed}×', {
            size: new Set(members.filter(m => m.owner).map(m => m.owner)).size,
            length: members.length,
            v2: qteTypes[q.type ?? 'splitArc'],
            speed: q.speed,
          })
        : `${qteTypes[q.type ?? 'splitArc']} · ${q.control ? tr('일반 공격') : q.key} · ${q.at.basis === 'event' ? q.at.event : q.at.seconds + tr('초')} · ${q.speed}×`,
      scope: {kind: 'root'},
      action: q.owner || undefined,
      ...(q.eventStart !== undefined ? {eventQte: true} : {}),
      inputs: ['trigger'],
      outputs,
      position: graphPosition(w, {kind: 'root'}, id, {x: origin.x + 320, y: origin.y + 160}),
    });
    indexNode(nodes.at(-1)!);
    // An event's QTE (runtime 0.12.248): the event card before it and an event card after each result that
    // sends one, so the canvas reads event -> QTE -> event as the declaration does.
    if (q.eventStart !== undefined) {
      const at = nodes.at(-1)!.position;
      nodes.push({
        id: qteEventId(q.id),
        original: qteEventId(q.id),
        kind: 'markerReceive',
        title: tr('QTE 시작 · 이벤트'),
        summary: q.eventStart || tr('이벤트 이름을 지정하세요'),
        scope: {kind: 'root'},
        inputs: [],
        outputs: ['trigger'],
        position: graphPosition(w, {kind: 'root'}, qteEventId(q.id), {x: at.x - 340, y: at.y}),
      });
      indexNode(nodes.at(-1)!);
      for (const [i, k] of outcomes.entries()) {
        const r = q.results[k];
        if (r.mode !== 'event') continue;
        nodes.push({
          id: qteEmitId(q.id, k),
          original: qteEmitId(q.id, k),
          kind: 'eventEmit',
          title: tr('이벤트 발생'),
          summary: r.event || tr('이벤트 이름을 지정하세요'),
          scope: {kind: 'root'},
          inputs: ['trigger'],
          outputs: [],
          position: graphPosition(w, {kind: 'root'}, qteEmitId(q.id, k), {x: at.x + 340, y: at.y + i * 150}),
        });
        indexNode(nodes.at(-1)!);
      }
    }
  }
  for (const q of qtes) {
    const owner = actions.get(q.owner),
      id = visualId(q);
    if (owner) wire(animId(owner.uid, 'clip_' + (q.step || owner.config.entry)), id, 'trigger');
    if (q.eventStart !== undefined) {
      wire(qteEventId(q.id), id, 'trigger');
      for (const k of outcomes) if (q.results[k].mode === 'event') wire(id, qteEmitId(q.id, k), resultPin(k));
    }
    for (const k of outcomes) {
      const r = q.results[k];
      if (r.mode !== 'transition') continue;
      if (r.card) wire(id, 'conditionCard:' + r.card, q.group ? qteRulePin(q.id, k) : resultPin(k));
      for (const [uid, pin] of [
        [r.to, q.group ? qteRulePin(q.id, k) : resultPin(k)],
        [r.partnerTo, q.group ? qteRulePin(q.id, k, true) : `choice:${k}:partner`],
      ] as [string, Pin][]) {
        const a = actions.get(uid);
        if (a) wire(id, animId(a.uid, 'clip_' + a.config.entry), pin);
      }
    }
  }
  // A result that sends an event goes on where that event is received (10-18, docs/mockup-qte-redesign): a dashed
  // line from the result to each event card listening for it, so an HKX's QTE no longer looks cut off.
  const receivers = new Map<string, string[]>();
  const listen = (event: string, node: string) => {
    if (!event || !byId.has(node)) return;
    const list = receivers.get(event);
    if (!list) receivers.set(event, [node]);
    else if (!list.includes(node)) list.push(node);
  };
  for (const l of w.links) if (l.mode === 'event') listen(l.event, 'transition:' + l.id);
  for (const s of w.starts) if (s.mode === 'event') listen(s.event, 'startCard:' + s.uid);
  for (const q of qtes) if (q.eventStart) listen(q.eventStart, qteEventId(q.id));
  const drawn = new Map<string, GraphEdge>();
  for (const q of qtes)
    for (const k of outcomes) {
      const r = q.results[k];
      if (r.mode !== 'event' || !r.event) continue;
      // An event QTE's result already has its "이벤트 발생" card: the line leaves that card.
      const emit = q.eventStart !== undefined ? qteEmitId(q.id, k) : '',
        source = emit && byId.has(emit) ? emit : visualId(q),
        pin: Pin = emit && byId.has(emit) ? 'trigger' : resultPin(k),
        from = byId.get(source);
      if (!from) continue;
      for (const target of receivers.get(r.event) ?? []) {
        const key = `${source}>${target}:${pin}`;
        if (target === source) continue;
        // The actions whose own QTE sends the event to themselves (the starter): their wait for it is this line
        // (FlatGraph merges it, docs/mockup-qte-redesign/qte-listen-merge). Not an event QTE's (no action).
        const sender = !emit && q.owner && r.recipient !== 'partner' ? q.owner : '';
        const known = drawn.get(key);
        if (known) {
          if (sender && !known.viaFrom!.includes(sender)) known.viaFrom!.push(sender);
          continue;
        }
        if (!from.outputs.includes(pin)) from.outputs = [...from.outputs, pin];
        const to = byId.get(target)!;
        if (!to.inputs.includes('trigger')) to.inputs = [...to.inputs, 'trigger'];
        const edge: GraphEdge = {
          id: `qte-via:${key}`,
          source,
          target,
          pin,
          targetPin: 'trigger',
          via: r.event,
          viaFrom: sender ? [sender] : [],
        };
        drawn.set(key, edge);
        edges.push(edge);
      }
    }
}
export function addQte(w: Workspace, position: {x: number; y: number}) {
  const q = newQte(w),
    id = qteId(q.id);
  return {workspace: moveNodes({...w, qtes: [...(w.qtes ?? []), q]}, {kind: 'root'}, {[id]: position}), id};
}
/** A pair action whose HKX sends an event: its step, and whose clip sends it ('partner': the victim's, "2_"). */
export type QteSender = {action: string; step: string; role: 'self' | 'partner'};
/** The pair actions whose HKX sends an event, shown beside an event's QTE (docs/mockup-qte-redesign/
 *  event-qte-pair-aware, 10-19). `clipSenders` reads a clip's annotations (who sends the event in it); a clip it
 *  cannot read sends nothing. */
export function pairEventSenders(
  w: Workspace,
  clipSenders: (clip: string) => Set<'self' | 'partner'> | undefined
): QteSender[] {
  const out: QteSender[] = [];
  for (const a of w.actions) {
    if (!a.pair) continue;
    for (const role of ['self', 'partner'] as const) {
      const step = a.config.steps.find(s => clipSenders(s.clip)?.has(role));
      if (step) out.push({action: a.uid, step: step.id, role});
    }
  }
  return out;
}
export function connectQte(
  w: Workspace,
  source: string,
  target: string,
  pin: string | undefined,
  nodes: FlatNode[]
): Workspace | undefined {
  if (!source.startsWith('qte:') && !target.startsWith('qte:')) return;
  const n = structuredClone(w),
    members = qteMembers(n, source.startsWith('qte:') ? source : target),
    q = members[0];
  if (!q) throw Error(tr('QTE가 없습니다.'));
  if (target.startsWith('qte:')) {
    const s = nodes.find(n => n.id === source);
    if (s?.id.startsWith('qte-event:')) throw Error(tr('이벤트 카드는 자기 QTE에만 연결됩니다.'));
    // An event start card going nowhere onto a QTE: the event starts that QTE (runtime 0.12.248), and the card
    // becomes the QTE's own event card.
    const start = source.startsWith('startCard:') ? n.starts.find(x => 'startCard:' + x.uid === source) : undefined;
    if (start) {
      if (start.mode !== 'event') throw Error(tr('QTE는 이벤트 시작 카드로만 시작합니다.'));
      if (start.to) throw Error(tr('이미 목적지가 있는 시작 카드입니다. 목적지를 비운 뒤 QTE에 이으세요.'));
      if (q.group) throw Error(tr('묶음 QTE는 이벤트로 시작할 수 없습니다.'));
      q.eventStart = start.event;
      q.owner = '';
      q.step = '';
      q.inputOwner = 'player';
      n.starts = n.starts.filter(x => x !== start);
      n.order = n.order.filter(x => x !== start.uid);
      return n;
    }
    if (s?.kind !== 'hkxPlay' || !s.action) throw Error(tr('HKX 출력에서 QTE 시작 입력에 연결하세요.'));
    if (q.eventStart !== undefined) delete q.eventStart;
    if (!q.group) {
      q.owner = s.action;
      q.step = s.step ?? '';
    } else if (!members.some(m => m.owner === s.action)) {
      const detached = members.filter(m => !m.owner),
        template = members.filter(m => m.owner === q.owner);
      const added = detached.length ? detached : copyQteRules(n, template, q.group, s.action);
      for (const m of added) {
        m.owner = s.action;
        m.step = s.step ?? '';
      }
    }
  } else {
    const d = nodes.find(n => n.id === target);
    if (d?.kind !== 'hkxPlay' || !d.action)
      throw Error(tr('결과를 HKX에 연결하세요. 이벤트 전송은 QTE 디테일에서 설정합니다.'));
    const r = qtePinRule(members, pin ?? '');
    if (!r) throw Error(tr('규칙의 성공·실패·완벽 결과를 선택하세요.'));
    // An event's QTE (runtime 0.12.249) starts the player's and the partner's own ordinary actions (0.12.264).
    if (r.q.eventStart !== undefined && n.actions.find(a => a.uid === d.action)?.pair)
      throw Error(tr('이벤트로 시작하는 QTE는 일반 동작으로만 전환합니다.'));
    r.q.results[r.outcome].mode = 'transition';
    r.q.results[r.outcome][r.partner ? 'partnerTo' : 'to'] = d.action;
  }
  return n;
}
