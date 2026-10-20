import type {Project} from './model.ts';
import {tr} from './i18n/korean.ts';
export const recoveryStep = (id: string) => (id.startsWith('recovery:') ? id.slice(9) : undefined);
export const isRecovery = (id: string) => id === 'recovery' || recoveryStep(id) !== undefined;
export function recoveryRule(p: Project, id: string) {
  const step = recoveryStep(id);
  return step === undefined ? p.recovery : p.steps.find(s => s.id === step)?.recovery;
}
export function setRecoveryRule(p: Project, id: string, value: Project['recovery']) {
  const step = recoveryStep(id);
  if (step === undefined) p.recovery = structuredClone(value);
  else {
    const clip = p.steps.find(s => s.id === step);
    if (!clip) throw Error(tr('이동키 취소를 적용할 HKX를 찾지 못했습니다.'));
    clip.recovery = structuredClone(value);
  }
}
