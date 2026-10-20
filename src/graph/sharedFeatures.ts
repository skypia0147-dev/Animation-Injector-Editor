import {isRecovery, recoveryRule, setRecoveryRule} from '../clipRecovery.ts';
import type {Workspace} from '../workspace.ts';
import type {Project} from '../model.ts';
import type {PairTrack, PairTrackKey} from '../pairTimeline.ts';
import {rows} from '../timeline/model.ts';
type SlotKey = keyof Project['slots'];
export type FeatureValue =
  | {type: 'locked'; key: 'rotate'}
  | {type: 'slot'; key: SlotKey; value: Project['slots'][SlotKey]}
  | {type: 'cost'; value: Project['cost']}
  | {type: 'recovery'; value: Project['recovery']}
  | {type: 'pair'; key: PairTrackKey; value: PairTrack}
  | {type: 'range'; key: string; on: Record<string, string>; off: Record<string, string>};
export function featureValue(w: Workspace, member: string): FeatureValue | undefined {
  const [owner, id] = member.split('|'),
    a = w.actions.find(a => a.uid === owner);
  if (!a) return;
  if (isRecovery(id)) {
    const value = recoveryRule(a.config, id);
    return value ? {type: 'recovery', value} : undefined;
  }
  if (a.pair) {
    if (id.startsWith('pair:')) {
      const key = id.slice(5) as PairTrackKey;
      if (a.pair.timeline[key]) return {type: 'pair', key, value: a.pair.timeline[key]};
    }
    if (id.startsWith('range:')) {
      const r = rows(w, a).find(r => r.id === id);
      if (r?.group) return {type: 'range', key: r.kind, on: r.group.on.values, off: r.group.off.values};
    }
    return;
  }
  if (id === 'rotate' && a.config.rotationLocked) return {type: 'locked', key: 'rotate'};
  if (['rotate', 'iframe', 'armor'].includes(id)) {
    const key = id as SlotKey;
    return {type: 'slot', key, value: a.config.slots[key]};
  }
  if (id === 'cost') return {type: 'cost', value: a.config.cost};
}
export function applyFeature(w: Workspace, member: string, v: FeatureValue) {
  const [owner, id] = member.split('|'),
    a = w.actions.find(a => a.uid === owner);
  if (!a) return;
  if (v.type === 'locked') {
    if (!a.pair) a.config.rotationLocked = true;
  } else if (v.type === 'slot' && !a.pair) {
    a.config.slots[v.key] = structuredClone(v.value);
    if (v.key === 'rotate') a.config.rotationLocked = false;
  } else if (v.type === 'cost' && !a.pair) a.config.cost = structuredClone(v.value);
  else if (v.type === 'recovery') setRecoveryRule(a.config, id, v.value);
  else if (v.type === 'pair' && a.pair) {
    a.pair.timeline[v.key] = structuredClone(v.value);
  } else if (v.type === 'range' && a.pair) {
    const r = rows(w, a).find(r => r.id === id);
    if (r?.group) {
      r.group.on.values = structuredClone(v.on);
      r.group.off.values = structuredClone(v.off);
    }
  }
}
