import {splitLocalPaths} from './localPaths.ts';
import {parseWorkspace, validateWorkspace} from './workspace.ts';
import type {Workspace} from './workspace.ts';
import {portable} from './authoring.ts';
import {tr} from './i18n/korean.ts';
export function exportTemplate(w: Workspace): string {
  const errors = validateWorkspace(w).filter(e => e.level === 'error');
  if (errors.length) throw new Error(errors.map(e => e.message).join('\n'));
  return JSON.stringify(
    {kind: 'AnimationInjectorTemplate', version: 1, project: splitLocalPaths(portable(w)).shared},
    null,
    2
  );
}
export function parseTemplate(text: string): Workspace {
  if (text.length > 2_000_000) throw new Error(tr('템플릿 크기 제한'));
  const t = JSON.parse(text);
  if (
    !t ||
    Object.keys(t).sort().join(',') !== 'kind,project,version' ||
    t.kind !== 'AnimationInjectorTemplate' ||
    t.version !== 1
  )
    throw new Error(tr('지원하지 않는 템플릿 형식'));
  const w = parseWorkspace(JSON.stringify(t.project));
  return portable(w);
}
