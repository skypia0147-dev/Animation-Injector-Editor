import type {Workspace} from './workspace.ts';
import {vanillaAttackData} from './attackDataCatalog.ts';
import {tr} from './i18n/korean.ts';

const labels: Record<string, () => string> = {
  attackStart: () => tr('일반 공격'),
  attackStartLeftHand: () => tr('일반 공격 · 왼손'),
  attackStartDualWield: () => tr('일반 공격 · 쌍수'),
  AttackStartH2HLeft: () => tr('맨손 공격 · 왼손'),
  AttackStartH2HRight: () => tr('맨손 공격 · 오른손'),
  attackStartSprint: () => tr('질주 공격'),
  attackStartSprintLeftHand: () => tr('질주 공격 · 왼손'),
  attackPowerStartInPlace: () => tr('강공격 · 제자리'),
  attackPowerStartForward: () => tr('강공격 · 전진'),
  attackPowerStartBackward: () => tr('강공격 · 후진'),
  attackPowerStartLeft: () => tr('강공격 · 왼쪽'),
  attackPowerStartRight: () => tr('강공격 · 오른쪽'),
  attackPowerStartInPlaceLeftHand: () => tr('왼손 강공격 · 제자리'),
  attackPowerStartForwardLeftHand: () => tr('왼손 강공격 · 전진'),
  attackPowerStartBackLeftHand: () => tr('왼손 강공격 · 후진'),
  attackPowerStartLeftLeftHand: () => tr('왼손 강공격 · 왼쪽'),
  attackPowerStartRightLeftHand: () => tr('왼손 강공격 · 오른쪽'),
  attackPowerStartDualWield: () => tr('강공격 · 쌍수'),
  attackPowerStartH2HCombo: () => tr('강공격 · 맨손 콤보'),
  attackPowerStartForwardH2HLeftHand: () => tr('맨손 전진 강공격 · 왼손'),
  attackPowerStartForwardH2HRightHand: () => tr('맨손 전진 강공격 · 오른손'),
  attackPowerStart_Sprint: () => tr('질주 강공격'),
  attackPowerStart_SprintLeftHand: () => tr('질주 강공격 · 왼손'),
  attackPowerStart_2HMSprint: () => tr('질주 강공격 · 양손 검'),
  attackPowerStart_2HWSprint: () => tr('질주 강공격 · 양손 도끼/둔기'),
  bashStart: () => tr('배시'),
  bashPowerStart: () => tr('강한 배시'),
};

export function attackDataLabel(name: string): string {
  const label = labels[name]?.();
  return label ? `${label} · ${name}` : name;
}

export function attackDataOptions(w: Workspace, current: string) {
  const names = new Set(vanillaAttackData.map(a => a.name));
  // Preserve exact names and casing, including definitions supplied by other mods.
  const custom = [
    ...new Set([current, ...w.actions.flatMap(a => [a.config.attack, ...a.config.steps.map(s => s.attack)])]),
  ]
    .filter(name => name && !names.has(name))
    .sort();
  return {human: vanillaAttackData.filter(a => a.human), other: vanillaAttackData.filter(a => !a.human), custom};
}
