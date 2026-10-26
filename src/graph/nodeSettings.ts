import type {Workspace, Action} from '../workspace.ts';
import {nodeCatalog, type NodeKind} from '../nodes/catalog.ts';
import {blendSeconds, editBlend} from './blends.ts';
import {featureValue, applyFeature, type FeatureValue} from './sharedFeatures.ts';
import {rows} from '../timeline/model.ts';

type Bag = Record<string, unknown>;
type Settings = {kind: string; value: unknown};
const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map(k => [k, (o as Bag)[k]]));
function address(w: Workspace, id: string) {
  const [head, local = ''] = id.split('|'),
    parts = head.split(':');
  const a = w.actions.find(
    a => a.uid === (parts[0] === 'link' ? w.links.find(l => l.id === parts[1])?.from : parts[1])
  );
  return {a, local, parts};
}
function fields(kind: string) {
  const keys = kind in nodeCatalog ? nodeCatalog[kind as NodeKind].fields : [];
  return keys.filter(k => !k.includes('[]') && !['input', 'event', 'config.entry'].includes(k));
}
function readPath(a: Action, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Bag)[k] : undefined), a);
}
function writePath(a: Action, path: string, value: unknown) {
  const keys = path.split('.');
  let o: Bag = a as unknown as Bag;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') return;
    o = o[k] as Bag;
  }
  if (value === undefined) delete o[keys.at(-1)!];
  else o[keys.at(-1)!] = structuredClone(value);
}
// Only configuration is shared. IDs, ownership, destinations and live state remain local.
export function nodeSettings(w: Workspace, id: string): Settings | undefined {
  const blend = blendSeconds(w, id);
  if (blend !== undefined) return {kind: 'blend', value: blend};
  const {a, local, parts} = address(w, id);
  if (!a) return;
  if (parts[0] === 'link') {
    const rule = w.links.find(l => l.id === parts[1]);
    if (!rule) return;
    if (local === 'keyInput' || local === 'markerReceive') {
      const input = a.config.inputs.find(i => i.id === rule.input);
      return {
        kind: 'rule:' + local,
        value:
          local === 'markerReceive'
            ? {event: rule.event}
            : {input: input ? pick(input, ['label', 'key', 'gamepad', 'control']) : undefined},
      };
    }
    if (local === 'detectionWindow') return {kind: 'detectionWindow', value: pick(rule, ['open', 'close', 'buffered'])};
    return;
  }
  if (parts[0] === 'notify') {
    const feature = featureValue(w, a.uid + '|' + local);
    if (feature) return {kind: 'feature', value: feature};
    const row = rows(w, a).find(r => r.id === local);
    if (row?.effect) return {kind: 'effect', value: row.effect.values};
    if (local.startsWith('cancel:')) {
      const c = a.cancels.find(c => c.id === local.slice(7));
      if (c) {
        const {id, ...value} = c;
        return {kind: 'cancel', value};
      }
    }
    return;
  }
  if (parts[0] === 'anim' && local.startsWith('clip_')) {
    const step = a.config.steps.find(s => s.id === local.slice(5));
    if (!step) return;
    return {
      kind: a.pair ? 'pairedClip' : 'clip',
      value: {
        step: pick(step, ['label', 'clip', 'localPath', 'attack']),
        config: pick(a.config, ['attack']),
        window: a.clipWindows?.[step.id],
      },
    };
  }
  if (parts[0] !== 'anim' && parts[0] !== 'start') return;
  if (local === 'outputPose') return {kind: 'outputPose', value: pick(a.config, ['graph'])};
  const keys = fields(local);
  if (!keys.length) return;
  if (keys.some(k => k.startsWith('pair.')) && !a.pair) return;
  return {kind: local, value: Object.fromEntries(keys.map(k => [k, readPath(a, k)]))};
}
export function applyNodeSettings(w: Workspace, id: string, v: Settings): void {
  if (v.kind === 'blend') {
    const next = editBlend(w, id, {seconds: v.value as number});
    w.actions = next.actions;
    return;
  }
  const {a, local, parts} = address(w, id);
  if (!a) return;
  if (v.kind.startsWith('rule:') || v.kind === 'detectionWindow') {
    const rule = parts[0] === 'link' ? w.links.find(l => l.id === parts[1]) : undefined;
    if (!rule) return;
    const value = v.value as {input?: Bag; event?: string};
    if (v.kind === 'detectionWindow') {
      Object.assign(rule, structuredClone(value));
      return;
    }
    if (v.kind === 'rule:markerReceive') {
      rule.event = value.event ?? '';
      return;
    }
    const input = a.config.inputs.find(i => i.id === rule.input);
    if (input && value.input) Object.assign(input, structuredClone(value.input));
    return;
  }
  if (v.kind === 'feature') {
    applyFeature(w, a.uid + '|' + local, v.value as FeatureValue);
    return;
  }
  if (v.kind === 'effect') {
    const row = rows(w, a).find(r => r.id === local);
    if (row?.effect) row.effect.values = structuredClone(v.value) as Record<string, string>;
    return;
  }
  if (v.kind === 'cancel') {
    const c = a.cancels.find(c => c.id === local.slice(7));
    if (c) Object.assign(c, structuredClone(v.value));
    return;
  }
  if (v.kind === 'clip' || v.kind === 'pairedClip') {
    const s = a.config.steps.find(s => s.id === local.slice(5));
    if (!s) return;
    const value = v.value as {step: Bag; config: Bag; window?: NonNullable<Action['clipWindows']>[string]};
    Object.assign(s, structuredClone(value.step));
    Object.assign(a.config, structuredClone(value.config));
    if (value.window) a.clipWindows = {...a.clipWindows, [s.id]: structuredClone(value.window)};
    else if (a.clipWindows) delete a.clipWindows[s.id];
    return;
  }
  if (v.kind === 'outputPose') {
    Object.assign(a.config, structuredClone(v.value));
    return;
  }
  for (const [path, value] of Object.entries(v.value as Bag)) writePath(a, path, value);
}
