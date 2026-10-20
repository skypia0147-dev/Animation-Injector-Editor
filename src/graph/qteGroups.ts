import type {Workspace} from '../workspace.ts';
import {newQte, qteXmlId, type QteNode, type Outcome, outcomes} from '../qte.ts';
export function qteMembers(w: Workspace, id: string): QteNode[] {
  const q = w.qtes?.find(q => 'qte:' + q.id === id);
  return q ? (q.group ? w.qtes!.filter(x => x.group === q.group) : [q]) : [];
}
export function qteVisualId(w: Workspace, q: QteNode) {
  return 'qte:' + (q.group ? w.qtes!.find(x => x.group === q.group)!.id : q.id);
}
export function qteRulePin(id: string, k: Outcome, partner = false) {
  return `choice:${id}:${k}${partner ? ':partner' : ''}` as const;
}
export function qtePinRule(members: QteNode[], pin: string) {
  const parts = pin.split(':');
  const grouped = parts[0] === 'choice' && outcomes.includes(parts[2] as Outcome);
  const q = grouped ? members.find(q => q.id === parts[1]) : members[0];
  const outcome = (
    grouped
      ? parts[2]
      : pin === 'pass'
        ? 'success'
        : pin === 'fail'
          ? 'failure'
          : pin === 'perfect'
            ? 'perfect'
            : parts[1]
  ) as Outcome;
  return q && outcomes.includes(outcome) ? {q, outcome, partner: pin.endsWith(':partner')} : undefined;
}
export function copyQteRules(w: Workspace, rules: QteNode[], group: string | undefined, owner = '') {
  const result: QteNode[] = [];
  for (const old of rules) {
    const q = {...structuredClone(old), id: newQte(w).id, group, owner};
    // A copy is a new rule: it takes its own automatic id, not the original's XML id.
    delete q.xmlId;
    (w.qtes ??= []).push(q);
    result.push(q);
  }
  return result;
}
export function uniqueQteGroup(w: Workspace, base: string) {
  let name = base,
    i = 2;
  while (w.qtes?.some(q => q.group === name)) name = base + ' ' + i++;
  return name;
}
export function disconnectQte(w: Workspace, source: string, target: string, pin: string, sourceAction?: string) {
  const members = qteMembers(w, source.startsWith('qte:') ? source : target);
  if (target.startsWith('qte:')) {
    // An event QTE's start line: the QTE no longer starts from its event.
    if (source.startsWith('qte-event:')) for (const q of members) delete q.eventStart;
    else for (const q of members) if (!sourceAction || q.owner === sourceAction) q.owner = '';
  } else {
    const r = qtePinRule(members, pin);
    if (r) {
      if (r.partner) r.q.results[r.outcome].partnerTo = '';
      else r.q.results[r.outcome].mode = 'continue';
    }
  }
}

export function remapQtePin(pin: string, map: Map<string, string>) {
  const parts = pin.split(':');
  if (parts[0] === 'choice' && outcomes.includes(parts[2] as Outcome) && map.has('qte:' + parts[1]))
    parts[1] = map.get('qte:' + parts[1])!.slice(4);
  return parts.join(':');
}
export function removeQteRule(w: Workspace, visual: string, id: string) {
  const n = structuredClone(w),
    members = qteMembers(n, visual),
    removed = members.find(q => q.id === id);
  if (!removed || members.length < 2) return w;
  const replacement = members[0] === removed ? members[1] : undefined;
  const map = new Map<string, string>();
  if (replacement) map.set('qte:' + replacement.id, 'qte:' + removed.id);
  // Keep the displayed group identity when its first internal rule is removed.
  n.qtes = n.qtes!.filter(q => q !== removed);
  // The replacement keeps its XML id: the inner id moves for the card, not for the file (it once wrote the
  // removed rule's id under the replacement's action).
  if (replacement) {
    replacement.xmlId = qteXmlId(replacement);
    replacement.id = removed.id;
  }
  n.disconnections = n.disconnections?.flatMap(c => {
    const bindings = c.bindings
      .filter(b => !(b.source === visual && b.pin.startsWith('choice:' + id + ':')))
      .map(b => ({...b, pin: remapQtePin(b.pin, map)}));
    return bindings.length ? [{...c, pin: remapQtePin(c.pin, map), bindings}] : [];
  });
  return n;
}
