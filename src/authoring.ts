import {updateSharedInput} from './sharedSettings.ts';
import type {Workspace} from './workspace.ts';
import type {Issue} from './model.ts';
import {clone, keyCode} from './model.ts';
import {tr} from './i18n/korean.ts';
export const parameterFields = ['inputKey', 'cooldown', 'costStamina', 'lossBlend'] as const;
export type Parameter = {
  id: string;
  label: string;
  help: string;
  action: string;
  field: (typeof parameterFields)[number];
  input: string;
  min: number;
  max: number;
};
export type AssetPolicy = {clip: string; mode: 'copy' | 'external'; dependency: string};
/** A sound file of the library (runtime 0.12.296): `file` is its path under Data, `localPath` its source, which stays
 *  on this computer (localPaths.ts). A sound's copy or external choice is a policy like an HKX's. */
export type SoundSource = {file: string; localPath: string};
export type Packaging = {
  folder: string;
  roots: string[];
  policies: AssetPolicy[];
  sounds: SoundSource[];
};
export const defaultPackaging = (): Packaging => ({
  folder: 'My Animation Mod',
  roots: [],
  policies: [],
  sounds: [],
});
export const parameterDefault = (): Parameter => ({
  id: 'setting1',
  label: tr('사용 키'),
  help: '',
  action: '',
  field: 'inputKey',
  input: '',
  min: 0,
  max: 600,
});
const exact = (v: any, keys: string[], name: string) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some(k => !keys.includes(k))
  )
    throw new Error(name + tr(': 알 수 없거나 누락된 필드'));
};
const text = (x: any) => typeof x === 'string' && x.length <= 1024 && !/[\x00-\x1f]/.test(x);
export function authoringShape(w: Workspace) {
  const p = w.packaging;
  exact(p, Object.keys(defaultPackaging()), tr('패키지'));
  if (
    !text(p.folder) ||
    !Array.isArray(p.roots) ||
    p.roots.length > 12 ||
    p.roots.some(r => !text(r)) ||
    !Array.isArray(p.policies) ||
    p.policies.length > 500 ||
    !Array.isArray(p.sounds) ||
    p.sounds.length > 500
  )
    throw new Error(tr('패키지 설정 형식 오류'));
  const clips = new Set<string>();
  for (const s of p.policies) {
    const key = typeof s.clip === 'string' ? s.clip.replaceAll('\\', '/').toLowerCase() : '';
    if (clips.has(key)) throw new Error(tr('같은 자산에 정책을 중복 지정했습니다.'));
    clips.add(key);
    exact(s, ['clip', 'mode', 'dependency'], tr('자산 정책'));
    if (!text(s.clip) || !text(s.dependency) || !['copy', 'external'].includes(s.mode))
      throw new Error(tr('자산 정책 형식 오류'));
  }
  for (const s of p.sounds) {
    exact(s, ['file', 'localPath'], tr('소리 원본'));
    if (!text(s.file) || !text(s.localPath)) throw new Error(tr('소리 원본 형식 오류'));
  }
  if (!Array.isArray(w.parameters) || w.parameters.length > 200) throw new Error(tr('제작 매개변수 개수 제한'));
  for (const a of w.parameters) {
    exact(a, Object.keys(parameterDefault()), tr('제작 매개변수'));
    if (
      [a.id, a.label, a.help, a.action, a.input].some(x => !text(x)) ||
      !parameterFields.includes(a.field) ||
      !Number.isFinite(a.min) ||
      !Number.isFinite(a.max)
    )
      throw new Error(tr('제작 매개변수 형식 오류'));
  }
}
export function parameterValue(w: Workspace, p: Parameter): string | number | undefined {
  const a = w.actions.find(a => a.uid === p.action);
  if (!a) return;
  switch (p.field) {
    case 'inputKey':
      // An input of the action (a transition's or carry's key), or a start card's key (its uid).
      return a.config.inputs.find(i => i.id === p.input)?.key ?? w.starts.find(s => s.uid === p.input)?.key;
    case 'cooldown':
      return w.starts.find(s => s.to && 'action' in s.to && s.to.action === a.uid)?.cooldown;
    case 'costStamina':
      return a.pair
        ? a.pair.timeline.cost.enabled
          ? a.pair.timeline.cost.stamina
          : undefined
        : a.config.cost.enabled
          ? a.config.cost.stamina
          : undefined;
    case 'lossBlend':
      return a.pair?.lossEnabled ? a.pair.lossBlend : undefined;
  }
}
export function validateParameters(w: Workspace): Issue[] {
  const out: Issue[] = [],
    ids = new Set<string>(),
    refs = new Set<string>();
  for (const p of w.parameters) {
    const bad = (message: string) => out.push({level: 'error', node: 'parameters', message: p.label + ': ' + message});
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p.id) || ids.has(p.id) || !p.label.trim())
      bad(tr('ID/이름을 확인하세요.'));
    ids.add(p.id);
    const ref = [p.action, p.field, p.field === 'inputKey' ? p.input : ''].join(':');
    if (refs.has(ref)) bad(tr('같은 설정을 중복 노출했습니다.'));
    refs.add(ref);
    const v = parameterValue(w, p);
    if (v === undefined) bad(tr('참조하는 동작·입력·활성 기능이 없습니다.'));
    if (p.field !== 'inputKey') {
      const max = p.field === 'lossBlend' ? 5 : p.field === 'cooldown' ? 600 : 100000,
        min = p.field === 'lossBlend' ? 0.01 : 0;
      if (p.min < min || p.max > max || p.min > p.max) bad(tr('허용 범위가 런타임 범위를 벗어납니다.'));
      if (typeof v === 'number' && (v < p.min || v > p.max)) bad(tr('현재 값이 공개 범위 밖입니다.'));
    }
  }
  return out;
}
export function applyParameter(w: Workspace, id: string, value: string | number): Workspace {
  const next = clone(w),
    p = next.parameters.find(p => p.id === id);
  if (!p || parameterValue(next, p) === undefined) throw new Error(tr('설정 참조가 없습니다.'));
  const a = next.actions.find(a => a.uid === p.action)!;
  if (p.field === 'inputKey') {
    if (typeof value !== 'string' || !keyCode(value) || keyCode(value) > 265)
      throw new Error(tr('유효한 물리 키 이름을 선택하세요.'));
    const start = next.starts.find(s => s.uid === p.input);
    if (start && !a.config.inputs.some(i => i.id === p.input)) {
      start.key = value;
      return next;
    }
    a.config.inputs.find(i => i.id === p.input)!.key = value;
    const shared = next.sharedInputs.find(i => i.id === p.input);
    if (shared) return updateSharedInput(next, {...shared, key: value});
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < p.min || value > p.max)
      throw new Error(tr('공개 설정 범위 안의 숫자가 필요합니다.'));
    switch (p.field) {
      case 'cooldown': {
        const s = next.starts.find(s => s.to && 'action' in s.to && s.to.action === a.uid);
        if (!s) throw new Error(tr('이 동작으로 바로 가는 시작 카드가 없습니다.'));
        s.cooldown = value;
        break;
      }
      case 'costStamina':
        if (a.pair) a.pair.timeline.cost.stamina = value;
        else a.config.cost.stamina = value;
        break;
      case 'lossBlend':
        a.pair!.lossBlend = value;
        break;
    }
  }
  return next;
}
export function portable(w: Workspace): Workspace {
  const next = clone(w);
  next.packaging.roots = [];
  next.packaging.sounds = next.packaging.sounds.map(s => ({...s, localPath: ''}));
  for (const a of next.actions)
    for (const config of [a.config, ...Object.values(a.variants).map(v => v!.config)])
      for (const s of config.steps) s.localPath = '';
  for (const asset of next.assets) {
    asset.localPath = '';
    asset.preview = {skeletons: [], skins: []};
  }
  return next;
}
