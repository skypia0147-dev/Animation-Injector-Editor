import type {Workspace, Action, CameraRestore} from './workspace.ts';
import type {Input} from './model.ts';
import {clone} from './model.ts';
import {tr} from './i18n/korean.ts';

export type SharedSettings = {cameraReset: string | null};
export function inferredCamera(actions: Action[]): string | null {
  // Before 10-16 the setting sat on the pair (an old file during its migration).
  const of = (a: any) => ((a.cameraEnabled ?? a.pair?.cameraEnabled) ? (a.camera ?? a.pair?.camera) : undefined);
  const names = [
    ...new Set(
      actions
        .map(of)
        .filter(Boolean)
        .map((c: CameraRestore) => c.reset)
    ),
  ];
  return names.length > 1 ? null : (names[0] ?? '');
}
/** The event an action's camera restores on: its own when set so (or when the project has none in common), else
 *  the project's. */
export const cameraReset = (w: Workspace, camera: CameraRestore) =>
  camera.own || w.globals.cameraReset === null ? camera.reset : w.globals.cameraReset;
export function inputReferences(w: Workspace, action: string, input: string): string[] {
  const a = w.actions.find(a => a.uid === action);
  if (!a) return [];
  return [
    ...(a.config.start.mode === 'input' && a.config.start.input === input ? [tr('시작 입력')] : []),
    ...(a.pair?.carry?.input === input ? [tr('운반 내려놓기')] : []),
    ...w.links.filter(l => l.from === action && l.mode === 'input' && l.input === input).map(l => tr('연결 ') + l.id),
    ...w.parameters
      .filter(p => p.action === action && p.field === 'inputKey' && p.input === input)
      .map(p => tr('매개변수 ') + p.label),
  ];
}
export function updateSharedInput(w: Workspace, input: Input): Workspace {
  const next = clone(w);
  next.sharedInputs = next.sharedInputs.map(i => (i.id === input.id ? clone(input) : i));
  for (const a of next.actions) a.config.inputs = a.config.inputs.map(i => (i.id === input.id ? clone(input) : i));
  return next;
}
export function attachInput(w: Workspace, input: string, action: string, attach: boolean): Workspace {
  const next = clone(w),
    i = next.sharedInputs.find(i => i.id === input),
    a = next.actions.find(a => a.uid === action);
  if (!i || !a) throw new Error(tr('입력 또는 동작이 없습니다.'));
  if (attach) {
    if (!a.config.inputs.some(x => x.id === input)) a.config.inputs.push(clone(i));
  } else {
    const refs = inputReferences(next, action, input);
    if (refs.length)
      throw new Error(
        a.config.name + ': ' + refs.join(', ') + tr('에서 사용 중입니다. 해당 참조를 바꾼 뒤 연결을 해제하세요.')
      );
    a.config.inputs = a.config.inputs.filter(x => x.id !== input);
  }
  return next;
}
export function deleteSharedInput(w: Workspace, input: string): Workspace {
  let next = clone(w);
  for (const a of next.actions)
    if (a.config.inputs.some(i => i.id === input)) next = attachInput(next, input, a.uid, false);
  next.sharedInputs = next.sharedInputs.filter(i => i.id !== input);
  return next;
}
