import type {Workspace} from '../workspace.ts';
import {activeConditionFlow} from './conditionExpression.ts';
import {tr} from '../i18n/korean.ts';

export type BlendNode = {id: string; source: string; target: string; seconds: number};
export const animId = (action: string, local: string) => `anim:${action}:|${local}`;
export function blendNodes(w: Workspace): BlendNode[] {
  if (w.blends) return w.blends;
  const nodes = w.actions.flatMap(a => [
    ...(a.enterBlendEnabled
      ? a.nodeAuthored && a.config.start.mode === 'none' && w.links.some(l => l.to === a.uid)
        ? w.links
            .filter(l => l.to === a.uid && l.blend === undefined)
            .map(l => ({
              id: `blend:link:${l.id}`,
              source: `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
              target: animId(a.uid, 'clip_' + a.config.entry),
              seconds: a.config.enterBlend,
            }))
        : [
            {
              id: animId(a.uid, 'blendIn'),
              source:
                a.config.start.mode === 'none'
                  ? 'entry'
                  : `start:${a.uid}|${a.config.start.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
              target: a.nodeAuthored ? animId(a.uid, 'clip_' + a.config.entry) : a.uid,
              seconds: a.config.enterBlend,
            },
          ]
      : []),
    ...(a.exitBlendEnabled
      ? [
          {
            id: animId(a.uid, 'blendOut'),
            source: a.nodeAuthored ? animId(a.uid, 'clip_' + a.config.entry) : a.uid,
            target: animId(a.uid, 'outputPose'),
            seconds: a.config.exitBlend,
          },
        ]
      : []),
  ]);
  return [
    ...nodes,
    ...w.links
      .filter(l => l.blend !== undefined)
      .map(l => {
        const a = w.actions.find(a => a.uid === l.to)!;
        return {
          id: `blend:link:${l.id}`,
          source: `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
          target: a.nodeAuthored ? animId(a.uid, 'clip_' + a.config.entry) : a.uid,
          seconds: l.blend!,
        };
      }),
  ];
}
function endpoint(w: Workspace, id: string) {
  for (const a of w.actions) {
    if (id === a.uid) return {action: a, step: ''};
    const step = a.config.steps.find(s => id === animId(a.uid, 'clip_' + s.id));
    if (step) return {action: a, step: step.id};
  }
}
export function blendBinding(w: Workspace, b: BlendNode) {
  if (!b.source || !b.target) throw Error(tr('블렌드 양쪽을 연결하세요.'));
  // Behind a start card that is gone: behind the one that replaced it (a key start swapped for an event one), or,
  // with none (deleted, moved to a selecting action), the action is entered from elsewhere, as blendNodes reads it.
  const started = /^start:([^|]+)\|/.exec(b.source)?.[1],
    mode = started && w.actions.find(a => a.uid === started)?.config.start.mode;
  if (mode)
    b = {
      ...b,
      source: mode === 'none' ? 'entry' : `start:${started}|${mode === 'event' ? 'markerReceive' : 'keyInput'}`,
    };
  const target = endpoint(w, b.target),
    source = endpoint(w, b.source);
  for (const a of w.actions) {
    if (b.target === animId(a.uid, 'outputPose') && source?.action.uid === a.uid)
      return {kind: 'exit' as const, action: a.uid, key: `exit:${a.uid}`, label: tr('종료')};
  }
  if (target && (!target.step || target.step === target.action.config.entry)) {
    const mode = target.action.config.start.mode;
    const start =
      mode !== 'none' && b.source === `start:${target.action.uid}|${mode === 'event' ? 'markerReceive' : 'keyInput'}`;
    if (source && w.links.filter(l => l.from === source.action.uid && l.to === target.action.uid).length > 1)
      throw Error(tr('여러 입력이 같은 HKX로 연결되어 있습니다. 해당 키/이벤트 카드 뒤에 블렌드를 연결하세요.'));
    const link = w.links.find(
      l =>
        l.to === target.action.uid &&
        (source?.action.uid === l.from ||
          b.source === `link:${l.id}|result` ||
          b.source === `link:${l.id}|${l.mode === 'event' ? 'markerReceive' : 'keyInput'}`)
    );
    if (link) {
      const from = w.actions.find(a => a.uid === link.from)!;
      if (
        !from.pair &&
        !target.action.pair &&
        from.config.steps.length === 1 &&
        target.action.config.steps.length === 1
      )
        return {
          kind: 'link' as const,
          action: target.action.uid,
          link: link.id,
          key: `link:${link.id}`,
          label: tr('동작 간 · 직접 전환'),
        };
    }
    if (start || b.source === 'entry' || link)
      return {
        kind: 'enter' as const,
        action: target.action.uid,
        key: `enter:${target.action.uid}`,
        label: link ? tr('동작 간 · 대상 진입') : tr('시작'),
      };
  }
  throw Error(tr('입력 → 블렌드 → 동작, 동작 → 블렌드 → 출력 포즈, 또는 전환으로 연결된 동작/HKX 사이에 연결하세요.'));
}
export function lowerBlends(w: Workspace): Workspace {
  if (!w.blends) return w;
  const next = structuredClone(w),
    seen = new Map<string, number>();
  for (const a of next.actions) {
    a.enterBlendEnabled = a.exitBlendEnabled = false;
  }
  for (const l of next.links) delete l.blend;
  for (const b of w.blends) {
    if (!Number.isFinite(b.seconds) || b.seconds < 0 || b.seconds > 5) throw Error(tr('블렌드 시간은 0~5초입니다.'));
    const role = blendBinding(w, b);
    const actions = role.kind === 'enter' ? entryBlendActions(w, role.action) : [role.action];
    for (const action of actions) {
      const key = role.kind === 'enter' ? `enter:${action}` : role.key;
      if (seen.has(key) && seen.get(key) !== b.seconds)
        throw Error(
          tr('{label} 블렌드가 충돌합니다 ({v1}). 같은 동작의 진입 블렌드 시간은 공유됩니다.', {
            label: role.label,
            v1: w.actions.find(a => a.uid === action)?.config.name,
          })
        );
      seen.set(key, b.seconds);
    }
    const a = next.actions.find(a => a.uid === role.action)!;
    if (role.kind === 'link') next.links.find(l => l.id === role.link)!.blend = b.seconds;
    else if (role.kind === 'enter') {
      for (const action of actions) {
        const destination = next.actions.find(a => a.uid === action)!;
        destination.enterBlendEnabled = true;
        destination.config.enterBlend = b.seconds;
      }
    } else {
      a.exitBlendEnabled = true;
      a.config.exitBlend = b.seconds;
    }
  }
  return next;
}
export function editBlend(w: Workspace, id: string, patch: Partial<BlendNode>): Workspace {
  const members = w.sharedRules?.find(g => g.kind === 'node' && g.members.includes(id))?.members ?? [id];
  return {
    ...w,
    blends: blendNodes(w).map(b =>
      b.id === id
        ? {...b, ...patch, id}
        : patch.seconds !== undefined && members.includes(b.id)
          ? {...b, seconds: patch.seconds}
          : b
    ),
  };
}

// Conditions select a destination before playback starts. An entry blend placed
// before the flow therefore applies to every reachable playback candidate.
export function entryBlendActions(w: Workspace, owner: string): string[] {
  const original = w.actions.find(a => a.uid === owner)?.flow;
  if (!original || original.detached) return [owner];
  const flow = activeConditionFlow(original),
    seen = new Set<string>(),
    actions = new Set([owner]);
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const test = flow.tests.find(t => t.id === id);
    if (!test) return;
    for (const target of [test.pass, test.fail]) {
      if (!target) continue;
      if ('node' in target) visit(target.node);
      else if (w.actions.some(a => a.uid === target.action)) actions.add(target.action);
    }
  };
  visit(flow.entry);
  return [...actions];
}
