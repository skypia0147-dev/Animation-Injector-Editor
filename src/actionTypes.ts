import {clone, createProject} from './model.ts';
import type {Project} from './model.ts';
import {defaultPair} from './workspace.ts';
import type {Action, Workspace} from './workspace.ts';
import {pairTrackKeys} from './pairTimeline.ts';
import {tr} from './i18n/korean.ts';

export const actionKinds = ['single', 'pair'] as const;
export type ActionKind = (typeof actionKinds)[number];
export const actionKindLabels = {
  get single() {
    return tr('일반');
  },
  get pair() {
    return tr('페어');
  },
};
export type ActionVariant = {config: Project; pair: Action['pair']; clipWindows?: Action['clipWindows']};
export const actionKind = (a: Action): ActionKind => (a.pair ? 'pair' : a.config.kind);
// Runtime chain layouts are inferred by graph editing, not playback types.
export const playbackKinds = ['single', 'pair'] as const;
export const playbackKind = (a: Action) => (a.pair ? 'pair' : 'single');
export function switchPlaybackKind(w: Workspace, id: string, kind: ActionKind): Workspace {
  const a = w.actions.find(a => a.uid === id);
  if (!a) throw new Error(tr('동작을 찾을 수 없습니다.'));
  if (kind === playbackKind(a)) return w;
  const restore =
    kind === 'single' && a.pair
      ? (Object.keys(a.variants)
          .filter(k => k !== 'pair')
          .at(-1) as ActionKind | undefined)
      : undefined;
  return switchActionKind(w, id, restore ?? kind);
}

// Identity, inputs and external links belong to the action; mode-specific settings are retained separately.
export function switchActionKind(w: Workspace, id: string, kind: ActionKind): Workspace {
  const original = w.actions.find(a => a.uid === id);
  if (!original) throw new Error(tr('동작을 찾을 수 없습니다.'));
  if (!actionKinds.includes(kind)) throw new Error(tr('지원하지 않는 동작 유형입니다.'));
  if (actionKind(original) === kind) return w;
  const link = w.links.find(l => l.partnerTo && (kind === 'pair' ? l.to === id || l.partnerTo === id : l.from === id));
  if (link)
    throw new Error(
      link.id + tr(': 양쪽 일반 전환의 역할과 맞지 않습니다. 해당 연결의 대상 목적지를 먼저 해제하세요.')
    );
  const param = w.parameters.find(p => p.action === id && p.field === 'lossBlend' && kind !== 'pair');
  if (param) throw new Error(param.label + tr(': 유형 전환 전에 이 제작 매개변수 연결을 해제하세요.'));
  const next = clone(w),
    a = next.actions.find(a => a.uid === id)!,
    old = a.config;
  delete a.variants[actionKind(a)];
  a.variants[actionKind(a)] = {
    config: clone(old),
    pair: clone(a.pair),
    ...(a.clipWindows ? {clipWindows: clone(a.clipWindows)} : {}),
  };
  const cached = a.variants[kind];
  let p: Project, pair: Action['pair'];
  if (cached) {
    p = clone(cached.config);
    pair = clone(cached.pair);
    delete a.variants[kind];
  } else {
    p = clone(old);
    pair = null;
    const selected = clone(old.steps.find(s => s.id === old.entry) ?? old.steps[0] ?? createProject().steps[0]);
    p.steps = [selected];
    p.entry = selected.id;
    if (kind === 'pair' || a.pair) {
      p.steps[0].clip = '';
      p.steps[0].localPath = '';
      p.steps[0].attack = '';
    }
    if (kind === 'pair') {
      pair = defaultPair();
      p.graph = ['RootBehaviorGraph'];
      p.rotationLocked = false;
      delete p.carryRelease;
      p.attack = '';
      for (const key of pairTrackKeys) {
        const t = pair.timeline[key];
        const from = key === 'cost' ? old.cost.at : old.slots[key].from;
        const until = key === 'cost' ? t.until : old.slots[key].until;
        if ([from, until].every(m => m.basis !== 'end' && !m.fallback)) {
          Object.assign(t, {
            enabled: key === 'cost' ? old.cost.enabled : old.slots[key].enabled,
            from: clone(from),
            until: clone(until),
            stamina: old.cost.stamina,
            magicka: old.cost.magicka,
          });
        }
      }
      for (const slot of Object.values(p.slots)) slot.enabled = false;
      p.cost.enabled = false;
    } else if (a.pair) {
      const base = createProject();
      p.graph = base.graph;
      p.slots = base.slots;
      p.cost = {...base.cost, enabled: false};
      p.attack = '';
    }
  }
  // Keep shared authoring edits when restoring a previously visited type.
  for (const key of [
    'name',
    'actionId',
    'inputs',
    'events',
    'air',
    'enterBlend',
    'exitBlend',
    'exit',
    'recovery',
  ] as const)
    Object.assign(p, {[key]: clone(old[key])});
  if (cached?.clipWindows) a.clipWindows = clone(cached.clipWindows);
  else delete a.clipWindows;
  a.config = p;
  a.pair = pair;
  return next;
}
