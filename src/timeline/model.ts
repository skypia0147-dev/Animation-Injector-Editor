import {recoveryRule, recoveryStep, isRecovery} from '../clipRecovery.ts';
import {sourceWindow, setSourceWindow} from '../graph/clipWindows.ts';
import {clone, mark} from '../model.ts';
import type {Mark} from '../model.ts';
import type {Action, Workspace, Effect} from '../workspace.ts';
import {uid} from '../workspace.ts';
import {cameraReset} from '../sharedSettings.ts';
import {layoutKey} from '../graph/projection.ts';
import {t} from '../i18n/index.ts';
import {opInfo, pairRoleLabels, type EventOp} from '../eventRegistry.ts';
import {tr} from '../i18n/korean.ts';
import {clipEffects, ordinaryEffectOps, setClipEffects} from '../clipEffects.ts';
export type Meta = {duration: number; tracks: number; annotations: {time: number; text: string; track: string}[]};
export type Row = {
  id: string;
  kind: string;
  label: string;
  from: Mark;
  until?: Mark;
  role?: string;
  transition?: boolean;
  effect?: Effect;
  group?: {on: Effect; off: Effect};
};
export const slots = ['rotate', 'iframe', 'armor'] as const;
export const names: Record<string, string> = {
  rotate: 'notify.rotate',
  iframe: 'notify.iframe',
  armor: 'notify.hyperArmor',
  cost: 'notify.staminaCost',
  recovery: 'notify.recovery',
  vanillaCancel: 'notify.vanillaCancel',
  hide: 'notify.weaponHide',
  show: 'notify.weaponShow',
  spell: 'notify.spell',
  ragdoll: 'notify.ragdoll',
  strike: 'notify.strike',
  sound: 'notify.sound',
  globalSet: 'notify.globalSet',
  modEvent: 'notify.modEvent',
  shake: 'notify.cameraShake',
  cancel: 'notify.pairCancel',
  timeOn: 'notify.timeScale',
  timeOff: 'timeline.restoreTime',
  stopVelocity: 'timeline.stopVelocity',
  stateOn: 'notify.stateOn',
  stateOff: 'notify.stateOff',
};
export const title = (kind: string) => {
  const base: Record<string, string> = {
    rotateOn: 'rotate',
    rotateOff: 'rotate',
    iframeOn: 'iframe',
    iframeOff: 'iframe',
    armorOn: 'armor',
    armorOff: 'armor',
  };
  const k = base[kind] ?? kind;
  // A function without its own row name is called what the registry calls it (활 발사 had shown as fireArrow).
  return (
    (names[k] ? t(names[k]) : (opInfo[k as EventOp]?.label ?? k)) +
    (kind.endsWith('Off') && kind !== 'timeOff' ? ' · ' + t('timeline.endEffect') : '')
  );
};
/** A function's target, as shown on timeline rows. */
export const roleTitle = (role: string) => pairRoleLabels[role] ?? role;
export function rows(w: Workspace, a: Action, step?: string): Row[] {
  const p = a.config,
    items: Row[] = [];
  for (const c of a.cancels ?? [])
    items.push({
      id: 'cancel:' + c.id,
      kind: 'vanillaCancel',
      label: tr('바닐라 전환 · ') + c.to,
      from: c.open,
      until: c.close,
    });
  for (const s of p.steps.filter(s => (!step || s.id === step) && a.clipWindows?.[s.id])) {
    const win = sourceWindow(a, s.id).value;
    items.push({
      id: 'clipWindow:' + s.id,
      kind: 'transition',
      label: s.label + tr(' · 공통 감지 구간'),
      from: win.open,
      until: win.close,
      transition: true,
    });
  }
  for (const l of w.links.filter(
    l => l.from === a.uid && !(a.nodeAuthored && l.mode === 'input' && a.clipWindows?.[p.entry])
  ))
    items.push({
      id: 'link:' + l.id,
      kind: 'transition',
      label: l.mode === 'input' ? (p.inputs.find(i => i.id === l.input)?.key ?? l.input) : l.event,
      from: l.window ? l.open : {...mark(), basis: 'event', event: l.event},
      until: l.window ? l.close : undefined,
      transition: true,
    });
  if (a.pair) {
    for (const key of [...slots, 'cost'] as const) {
      const s = a.pair.timeline[key];
      if (s.enabled)
        items.push({
          id: 'pair:' + key,
          kind: key,
          label: title(key),
          from: s.from,
          until: key === 'cost' ? undefined : s.until,
          role: s.role,
        });
    }
    const grouped = new Set<string>();
    for (const [key, value] of Object.entries(w.layout[layout(a.uid)] ?? {})) {
      if (!key.startsWith('range_') || !value.text) continue;
      try {
        const spec = JSON.parse(value.text),
          on = a.pair.effects.find(e => e.id === spec.on),
          off = a.pair.effects.find(e => e.id === spec.off);
        if (on && off && slots.includes(spec.kind) && !grouped.has(on.id) && !grouped.has(off.id)) {
          grouped.add(on.id);
          grouped.add(off.id);
          items.push({
            id: 'range:' + key,
            kind: spec.kind,
            label: title(spec.kind),
            from: effectMark(on),
            until: effectMark(off),
            role: on.values.target ?? 'both',
            group: {on, off},
          });
        }
      } catch {
        /* Ignore damaged editor grouping; preserve the executable effects as separate points. */
      }
    }
    for (const e of a.pair.effects.filter(e => !grouped.has(e.id)))
      items.push({
        id: 'effect:' + e.id,
        kind: e.values.op,
        label: title(e.values.op),
        from: effectMark(e),
        role: e.values.target ?? 'both',
        effect: e,
      });
  } else {
    for (const key of slots) {
      const s = p.slots[key];
      if (key === 'rotate' && p.rotationLocked)
        items.push({id: key, kind: key, label: tr('회전 · 전 구간 금지'), from: mark(), until: mark(0, 'end')});
      else if (s.enabled) items.push({id: key, kind: key, label: title(key), from: s.from, until: s.until});
    }
    if (p.cost.enabled) items.push({id: 'cost', kind: 'cost', label: title('cost'), from: p.cost.at});
    // Clip-time functions on the actor playing it (runtime 0.12.274).
    for (const e of p.effects ?? [])
      items.push({id: 'effect:' + e.id, kind: e.values.op, label: title(e.values.op), from: effectMark(e), effect: e});
  }
  if (p.recovery.enabled && (!step || !p.steps.find(s => s.id === step)?.recovery))
    items.push({id: 'recovery', kind: 'recovery', label: title('recovery'), from: p.recovery.at});
  for (const s of p.steps)
    if (s.recovery && (!step || s.id === step))
      items.push({
        id: 'recovery:' + s.id,
        kind: 'recovery',
        label: title('recovery') + ' · ' + s.label,
        from: s.recovery.at,
      });
  return items;
}
export function patch(w: Workspace, action: string, id: string, change: {from?: Mark; until?: Mark}): Workspace {
  if (id === 'rotate' && w.actions.find(a => a.uid === action)?.config.rotationLocked) return w;
  if (id.startsWith('range:')) {
    const a = w.actions.find(a => a.uid === action)!,
      r = rows(w, a).find(r => r.id === id);
    if (!r?.group) return w;
    let n = w;
    if (change.from) n = patch(n, action, 'effect:' + r.group.on.id, {from: change.from});
    if (change.until) n = patch(n, action, 'effect:' + r.group.off.id, {from: change.until});
    return n;
  }
  const n = clone(w),
    a = n.actions.find(a => a.uid === action);
  if (!a) return w;
  const p = a.config;
  if (id === 'runtime:carryRelease') {
    if (p.carryRelease && change.from) p.carryRelease.at = change.from;
  } else if (id === 'runtime:carryFix') {
    // Plain seconds only: the runtime reads <Fix at> as seconds from the lift clip's start.
    if (a.pair?.carry?.fix && change.from?.basis === 'seconds')
      a.pair.carry.fix.at = {...change.from, fallback: false, fallbackBasis: 'seconds'};
  } else if (id === 'runtime:cameraRestore') return w;
  else if (id.startsWith('clipWindow:')) {
    const step = id.slice(11),
      win = sourceWindow(a, step).value;
    Object.assign(
      a,
      setSourceWindow(a, step, {
        ...win,
        ...(change.from ? {open: change.from} : {}),
        ...(change.until ? {close: change.until} : {}),
      })
    );
  } else if (id.startsWith('cancel:')) {
    const c = a.cancels.find(c => c.id === id.slice(7));
    if (c) {
      if (change.from) c.open = change.from;
      if (change.until) c.close = change.until;
    }
  } else if (id.startsWith('link:')) {
    const l = n.links.find(l => l.id === id.slice(5));
    if (l) {
      if (change.from) l.open = change.from;
      if (change.until) l.close = change.until;
    }
  } else if (id.startsWith('effect:')) {
    // A pair effect runs at a clip time; an event moment is a registry function (format 3).
    const e = clipEffects(a).find(e => e.id === id.slice(7));
    if (e && change.from?.basis === 'seconds') e.values.at = String(change.from.seconds);
  } else if (id.startsWith('pair:') && a.pair) {
    const key = id.slice(5) as keyof typeof a.pair.timeline;
    Object.assign(a.pair.timeline[key], change);
  } else if (slots.includes(id as any)) Object.assign(p.slots[id as (typeof slots)[number]], change);
  else if (id === 'cost' && change.from) p.cost.at = change.from;
  else if (isRecovery(id) && change.from) {
    const rule = recoveryRule(p, id);
    if (rule) rule.at = change.from;
  }
  return n;
}
export function remove(w: Workspace, action: string, id: string): Workspace {
  if (id.startsWith('range:')) {
    const a = w.actions.find(a => a.uid === action)!,
      r = rows(w, a).find(r => r.id === id);
    if (!r?.group) return w;
    let n = remove(remove(w, action, 'effect:' + r.group.on.id), action, 'effect:' + r.group.off.id);
    delete n.layout[layout(action)]?.[id.slice(6)];
    return n;
  }
  const n = clone(w),
    a = n.actions.find(a => a.uid === action)!;
  if (id === 'runtime:carryRelease') delete a.config.carryRelease;
  else if (id === 'runtime:carryFix' && a.pair?.carry) a.pair.carry.fix = null;
  else if (id === 'runtime:cameraRestore') a.cameraEnabled = false;
  else if (id.startsWith('cancel:')) a.cancels = a.cancels.filter(c => c.id !== id.slice(7));
  else if (id.startsWith('effect:'))
    setClipEffects(
      a,
      clipEffects(a).filter(e => e.id !== id.slice(7))
    );
  else if (id.startsWith('pair:') && a.pair)
    a.pair.timeline[id.slice(5) as keyof typeof a.pair.timeline].enabled = false;
  else if (slots.includes(id as any)) {
    a.config.slots[id as (typeof slots)[number]].enabled = false;
    if (id === 'rotate') a.config.rotationLocked = false;
  } else if (id === 'cost') a.config.cost.enabled = false;
  else if (id.startsWith('recovery:')) {
    const s = a.config.steps.find(s => s.id === recoveryStep(id));
    if (s) delete s.recovery;
  } else if (id === 'recovery') a.config.recovery.enabled = false;
  else throw Error(t('timeline.ruleEdit'));
  return n;
}
// Runtime point settings use the same data as card fields, without creating a
// second authoring node in flatGraph's notification projection.
export function timelineRows(w: Workspace, a: Action, step?: string): Row[] {
  const result = rows(w, a, step);
  if (a.config.carryRelease)
    result.push({
      id: 'runtime:carryRelease',
      kind: 'carryRelease',
      label: t('node.carryRelease'),
      from: a.config.carryRelease.at,
    });
  if (a.pair?.carry?.fix)
    result.push({id: 'runtime:carryFix', kind: 'carryFix', label: t('node.carryFix'), from: a.pair.carry.fix.at});
  if (a.cameraEnabled && a.camera) {
    const c = a.camera;
    result.push({
      id: 'runtime:cameraRestore',
      kind: 'cameraRestore',
      label: tr('카메라 복구'),
      from: c.restore === 'event' ? {...mark(), basis: 'event', event: cameraReset(w, c) || ''} : mark(0, 'end'),
    });
  }
  return result;
}
export function add(
  w: Workspace,
  action: string,
  kind: string,
  time: number,
  track = 1,
  step?: string
): {workspace: Workspace; id: string} {
  const n = clone(w),
    a = n.actions.find(a => a.uid === action)!;
  let id = kind;
  if (kind === 'recovery' && step && !a.pair) {
    const clip = a.config.steps.find(s => s.id === step);
    if (!clip) throw Error(tr('이동키 취소를 적용할 HKX를 선택하세요.'));
    if (clip.recovery) throw Error(tr('이 HKX에는 이미 이동키 취소가 있습니다. 연결된 카드에서 시각을 수정하세요.'));
    clip.recovery = {enabled: true, at: mark(time), blend: 0.15};
    id = 'recovery:' + step;
    return {workspace: assignTrack(n, action, id, track), id};
  }
  const existing = rows(w, a).find(r => r.kind === kind);
  if (kind === 'vanillaCancel') {
    if (a.pair) throw Error(tr('페어의 종료/전환 기능을 사용하세요.'));
    const id = uid(
      'cancel',
      a.cancels.map(c => c.id)
    );
    a.cancels.push({id, to: 'vanilla:Attack', open: mark(time), close: mark(0, 'end'), buffered: true, blend: null});
    return {workspace: n, id: 'cancel:' + id};
  }
  if (existing && [...slots, 'cost', 'recovery'].includes(kind)) {
    if (!a.pair || kind === 'recovery') throw Error(t('timeline.singleton'));
    const d = duplicate(w, action, existing.id, time);
    return {...d, workspace: assignTrack(d.workspace, action, d.id, track)};
  }
  if (slots.includes(kind as any) || kind === 'cost') {
    if (a.pair) {
      id = 'pair:' + kind;
      a.pair.timeline[kind as keyof typeof a.pair.timeline].enabled = true;
    } else if (kind === 'cost') a.config.cost.enabled = true;
    else a.config.slots[kind as (typeof slots)[number]].enabled = true;
  } else if (kind === 'recovery') a.config.recovery.enabled = true;
  else if (a.pair) {
    const e = {
      id: uid(
        'effect',
        a.pair.effects.map(e => e.id)
      ),
      // Both actors unless the item names one (runtime 0.12.275). A strike starts as the initiator hitting its
      // partner: both actors striking each other is never the first thing meant.
      values:
        kind === 'strike'
          ? {op: kind, at: String(time), target: 'initiator', pick: 'partner'}
          : // A sound, a global and a mod event once, not once per actor (runtime 0.12.296).
            ['sound', 'globalSet', 'modEvent'].includes(kind)
            ? {op: kind, at: String(time), target: 'initiator'}
            : ({op: kind, at: String(time)} as Record<string, string>),
    };
    a.pair.effects.push(e);
    id = 'effect:' + e.id;
  } else if (ordinaryEffectOps.includes(kind)) {
    // An ordinary action's clip-time function changes the actor playing it: no target (runtime 0.12.274).
    const list = clipEffects(a);
    const e = {
      id: uid(
        'effect',
        list.map(e => e.id)
      ),
      values: {op: kind, at: String(time)},
    };
    setClipEffects(a, [...list, e]);
    id = 'effect:' + e.id;
  } else throw Error(t('timeline.unsupported'));
  const result = patch(n, action, id, {
    from: mark(time),
    ...((slots as readonly string[]).includes(kind) ? {until: mark(time + 0.5)} : {}),
  });
  return {workspace: assignTrack(result, action, id, track), id};
}
export function duplicate(w: Workspace, action: string, id: string, time: number) {
  const n = clone(w),
    a = n.actions.find(a => a.uid === action)!;
  const r = rows(w, a).find(r => r.id === id);
  if (a.pair && r && (r.group || id.startsWith('pair:'))) {
    const s = a.pair.timeline[r.kind as keyof typeof a.pair.timeline];
    const ops: Record<string, string[]> = {
      rotate: ['rotateOn', 'rotateOff'],
      iframe: ['iframeOn', 'iframeOff'],
      armor: ['armorOn', 'armorOff'],
      cost: ['cost'],
    };
    const length =
      r.until && r.from.basis === 'seconds' && r.until.basis === 'seconds'
        ? Math.max(0, r.until.seconds - r.from.seconds)
        : 0.5;
    const originals: Effect[] = r.group
      ? [r.group.on, r.group.off]
      : ops[r.kind].map(
          op =>
            ({
              id: '',
              values: {
                op,
                ...(s.role !== 'both' ? {target: s.role} : {}),
                ...(r.kind === 'cost' ? {stamina: String(s.stamina), magicka: String(s.magicka)} : {}),
              },
            }) as Effect
        );
    const copies = originals.map((e, i) => {
      const copy = clone(e);
      copy.id = uid(
        'effect',
        a.pair!.effects.map(e => e.id)
      );
      copy.values.at = String(time + (i ? length : 0));
      a.pair!.effects.push(copy);
      return copy;
    });
    if (copies.length === 1)
      return {
        workspace: assignTrack(n, action, 'effect:' + copies[0].id, trackOf(w, action, id)),
        id: 'effect:' + copies[0].id,
      };
    const key = layout(action);
    n.layout[key] ??= {};
    const group = uid('range_', Object.keys(n.layout[key]));
    n.layout[key][group] = {x: 0, y: 0, text: JSON.stringify({kind: r.kind, on: copies[0].id, off: copies[1].id})};
    return {workspace: assignTrack(n, action, 'range:' + group, trackOf(w, action, id)), id: 'range:' + group};
  }
  const list = clipEffects(a),
    e = list.find(e => id === 'effect:' + e.id);
  if (!e) throw Error(t('timeline.singleton'));
  const copy = {
    ...clone(e),
    id: uid(
      'effect',
      list.map(e => e.id)
    ),
  };
  copy.values.at = String(time);
  setClipEffects(a, [...list, copy]);
  return {workspace: assignTrack(n, action, 'effect:' + copy.id, trackOf(w, action, id)), id: 'effect:' + copy.id};
}
const layout = (a: string) => 'timeline_' + layoutKey(a);
const effectMark = (e: Effect): Mark => mark(Number(e.values.at ?? 0));
export function tracks(w: Workspace, action: string) {
  const entries = w.layout[layout(action)] ?? {};
  return [
    1,
    ...Object.keys(entries)
      .filter(k => k.startsWith('track_'))
      .map(k => Number(k.slice(6)))
      .filter(k => k > 1),
  ].sort((a, b) => a - b);
}
export function addTrack(w: Workspace, action: string) {
  const n = clone(w),
    key = layout(action),
    id = Math.max(...tracks(w, action)) + 1;
  n.layout[key] ??= {};
  n.layout[key]['track_' + id] = {x: 0, y: id};
  return n;
}
export function trackOf(w: Workspace, action: string, id: string) {
  return w.layout[layout(action)]?.[layoutKey(id)]?.y ?? 1;
}
export function assignTrack(w: Workspace, action: string, id: string, track: number) {
  const n = clone(w),
    key = layout(action);
  n.layout[key] ??= {};
  n.layout[key][layoutKey(id)] = {x: 0, y: track};
  return n;
}
export function timeOf(m: Mark, duration: number, meta?: Meta): number | undefined {
  if (m.basis === 'seconds') return m.seconds;
  if (m.basis === 'end') return Math.max(0, duration - m.seconds);
  return meta?.annotations.find(a => a.text === m.event)?.time;
}
export const retime = (m: Mark, time: number, duration: number) => ({
  ...m,
  seconds: Math.round((m.basis === 'end' ? Math.max(0, duration - time) : time) * 1000) / 1000,
});
export function extent(items: Row[], meta?: Meta) {
  return (
    meta?.duration ??
    Math.max(
      1,
      ...items
        .flatMap(r => [r.from, r.until])
        .filter((m): m is Mark => !!m && m.basis === 'seconds' && Number.isFinite(m.seconds))
        .map(m => m.seconds)
    ) * 1.25
  );
}
