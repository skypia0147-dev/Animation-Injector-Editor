import type {Workspace, Action} from '../workspace.ts';
import {nodeCatalog, type NodeKind} from '../nodes/catalog.ts';
import {blendNodes} from './blends.ts';
import {featureValue, applyFeature, type FeatureValue} from './sharedFeatures.ts';
import {rows} from '../timeline/model.ts';
import {tr} from '../i18n/korean.ts';

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
function fields(a: Action, kind: string) {
  const keys = kind in nodeCatalog ? nodeCatalog[kind as NodeKind].fields : [];
  return keys.filter(k => !k.includes('[]') && !['input', 'event', 'config.start.input', 'config.entry'].includes(k));
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
  const blend = blendNodes(w).find(b => b.id === id);
  if (blend) return {kind: 'blend', value: blend.seconds};
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
            : {input: input ? pick(input, ['label', 'key', 'gamepad']) : undefined},
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
  if (parts[0] === 'flow') {
    const f = a.flow;
    if (!f) return;
    const seen = new Set<string>();
    const expression = (id: string): unknown => {
      if (seen.has(id)) throw Error(tr('조건 공유에 순환 참조가 있습니다.'));
      seen.add(id);
      const t = f.tests.find(t => t.id === id);
      if (!t) throw Error(tr('공유할 구성 조건이 없습니다.'));
      const {id: _, pass, fail, operands, ...settings} = t;
      if (!settings.negate) delete settings.negate;
      const value = {settings, children: (operands ?? []).map(expression)};
      seen.delete(id);
      return value;
    };
    if (f.tests.some(t => t.id === parts[2])) return {kind: 'condition', value: expression(parts[2])};
    return;
  }
  if (parts[0] === 'start' && ['keyInput', 'markerReceive'].includes(local)) {
    if (a.config.start.mode === 'none') return;
    const input = a.config.inputs.find(i => i.id === a.config.start.input);
    return {
      kind: 'start:' + local,
      value: {
        start: pick(a.config.start, ['mode', 'event', 'actor', 'onKeyUp']),
        input: input ? pick(input, ['label', 'key', 'gamepad']) : undefined,
      },
    };
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
  if (local === 'outputPose') return {kind: 'outputPose', value: pick(a.config, ['graph', 'safety'])};
  const keys = fields(a, local);
  if (!keys.length) return;
  if (keys.some(k => k.startsWith('pair.')) && !a.pair) return;
  return {kind: local, value: Object.fromEntries(keys.map(k => [k, readPath(a, k)]))};
}
export function applyNodeSettings(w: Workspace, id: string, v: Settings): void {
  if (v.kind === 'blend') {
    w.blends ??= structuredClone(blendNodes(w));
    const b = w.blends.find(b => b.id === id);
    if (b) b.seconds = v.value as number;
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
  if (v.kind === 'condition') {
    const f = a.flow,
      root = f?.tests.find(t => t.id === parts[2]);
    if (!f || !root) return;
    const previous = new Set<string>(),
      pending = [...(root.operands ?? [])];
    while (pending.length) {
      const id = pending.pop()!;
      if (previous.has(id)) continue;
      previous.add(id);
      pending.push(...(f.tests.find(t => t.id === id)?.operands ?? []));
    }
    const apply = (target: typeof root, expr: any) => {
      const old = target.operands ?? [],
        children = expr.children as any[];
      const {id, pass, fail} = target;
      Object.keys(target).forEach(k => delete (target as unknown as Bag)[k]);
      Object.assign(target, structuredClone(expr.settings), {id}, pass ? {pass} : {}, fail ? {fail} : {});
      if (children.length)
        target.operands = children.map((child, i) => {
          let t = f.tests.find(t => t.id === old[i]);
          // Shared operand definitions must not be overwritten by editing a different expression.
          if (t && f.tests.some(other => other !== target && other.operands?.includes(t!.id))) t = undefined;
          if (!t) {
            let j = 1;
            while (f.tests.some(t => t.id === 'SharedCondition' + j)) j++;
            t = {id: 'SharedCondition' + j, kind: 'alive', subject: 'self', minimum: 0};
            f.tests.push(t);
          }
          apply(t, child);
          return t.id;
        });
    };
    apply(root, v.value);
    let removed = true;
    while (removed) {
      removed = false;
      const used = new Set([f.entry]);
      for (const t of f.tests) {
        for (const id of t.operands ?? []) used.add(id);
        for (const e of [t.pass, t.fail]) if (e && 'node' in e) used.add(e.node);
      }
      f.tests = f.tests.filter(t => {
        if (previous.has(t.id) && !used.has(t.id)) {
          removed = true;
          return false;
        }
        return true;
      });
    }
    return;
  }
  if (v.kind.startsWith('start:')) {
    const value = v.value as {start: Bag; input?: Bag};
    Object.assign(a.config.start, structuredClone(value.start));
    if (value.input) {
      let input = a.config.inputs.find(i => i.id === a.config.start.input);
      if (!input) {
        let j = 1;
        while (a.config.inputs.some(i => i.id === 'SharedInput' + j)) j++;
        input = {id: 'SharedInput' + j, label: '', key: '', gamepad: 0};
        a.config.inputs.push(input);
        a.config.start.input = input.id;
      }
      Object.assign(input, structuredClone(value.input));
    }
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
  if (v.kind === 'cameraRestore' && a.cameraEnabled && a.pair) a.pair.effectsEnabled = true;
}
