import type {Workspace} from '../../workspace.ts';
import {clone, marks} from '../../model.ts';
import type {Mark} from '../../model.ts';
import {addEventRow} from '../../eventRegistry.ts';
import {tr} from '../../i18n/korean.ts';

type Ref = {name: string; label: string; declaration: boolean; set: (name: string) => void};
function refs(w: Workspace): Ref[] {
  const out: Ref[] = [];
  const add = (object: any, key: string | number, label: string, declaration = false) => {
    if (typeof object?.[key] === 'string' && object[key])
      out.push({
        name: object[key],
        label,
        declaration,
        set: name => {
          object[key] = name;
        },
      });
  };
  // A clip-time moment keeps its last event name for switching back; only an event moment uses it.
  const addMark = (m: Mark, label: string) => {
    if (m.basis === 'event') add(m, 'event', label);
  };
  w.eventRegistry?.forEach(r => add(r, 'name', tr('이벤트 등록'), true));
  add(w.globals, 'cameraReset', tr('전역 카메라 복구'));
  for (const q of w.qtes ?? []) {
    addMark(q.at, q.name + tr(' · QTE 시작'));
    if (q.stopEvent) add(q, 'stopEvent', q.name + tr(' · QTE 종료'));
    for (const [outcome, result] of Object.entries(q.results))
      if (result.mode === 'event') add(result, 'event', q.name + ' · ' + outcome);
  }
  for (const s of w.starts) if (s.mode === 'event') add(s, 'event', tr('시작 카드 · 이벤트'));
  const actions = w.actions.map(a => ({a, label: a.config.name}));
  for (const {a, label} of actions) {
    for (const [variant, s] of [['', a], ...Object.entries(a.variants)] as [string, typeof a][]) {
      const where = label + (variant ? tr(' · 보관된 {variant} 설정', {variant}) : '');
      s.config.events.forEach((_, i) => add(s.config.events, i, where, true));
      marks(s.config).forEach(m => addMark(m, where + tr(' · 기능/전환 시각')));
      for (const [step, v] of Object.entries(s.clipWindows ?? {})) {
        addMark(v.open, where + tr(' · {step} 감지 시작', {step}));
        addMark(v.close, where + tr(' · {step} 감지 종료', {step}));
      }
      for (const c of s.cancels ?? []) {
        addMark(c.open, where + tr(' · 바닐라 전환 시작'));
        addMark(c.close, where + tr(' · 바닐라 전환 종료'));
      }
      if (s.camera) add(s.camera, 'reset', where + tr(' · 카메라 복구'));
    }
  }
  for (const l of w.links) {
    if (l.mode === 'event') add(l, 'event', tr('동작 연결 {id} · 입력', {id: l.id}));
    if (l.window) {
      addMark(l.open, tr('동작 연결 {id} · 감지 시작', {id: l.id}));
      addMark(l.close, tr('동작 연결 {id} · 감지 종료', {id: l.id}));
    }
  }
  return out;
}
export const markerNames = (w: Workspace): string[] => [...new Set(refs(w).map(r => r.name))].sort();
/** Non-declaration use count of every marker in markerNames order, from one pass over refs. */
export function markerUseCounts(w: Workspace): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of refs(w)) counts.set(r.name, (counts.get(r.name) ?? 0) + (r.declaration ? 0 : 1));
  return new Map([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
export const markerUses = (w: Workspace, name: string): string[] =>
  refs(w)
    .filter(r => r.name === name && !r.declaration)
    .map(r => r.label);
function validate(w: Workspace, name: string, old = '') {
  if (
    !name.trim() ||
    name !== name.trim() ||
    name.length > 256 ||
    /[|@\x00-\x1f]/.test(name) ||
    markerNames(w).some(n => n === name && n !== old)
  )
    throw Error(tr('이벤트 이름이 잘못되었거나 이미 사용 중입니다.'));
}
/** A new event name: a registration without functions in the event registry. */
export function addMarker(w: Workspace, name: string): Workspace {
  validate(w, name);
  return addEventRow(w, name);
}
export function renameMarker(w: Workspace, old: string, name: string): Workspace {
  validate(w, name, old);
  const next = clone(w);
  refs(next)
    .filter(r => r.name === old)
    .forEach(r => r.set(name));
  return next;
}
export function removeMarker(w: Workspace, name: string): Workspace {
  const used = markerUses(w, name);
  if (used.length) throw Error(tr('사용 중인 이벤트입니다. 먼저 사용 위치의 이벤트를 변경하세요: ') + used.join(', '));
  const next = clone(w);
  if (next.eventRegistry) {
    next.eventRegistry = next.eventRegistry.filter(r => r.name !== name);
    if (!next.eventRegistry.length) delete next.eventRegistry;
  }
  for (const a of next.actions)
    for (const s of [a, ...Object.values(a.variants)]) s.config.events = s.config.events.filter(e => e !== name);
  return next;
}
