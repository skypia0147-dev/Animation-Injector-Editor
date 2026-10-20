import type {Workspace} from './workspace.ts';
import {tr} from './i18n/korean.ts';

// Fixed names the runtime puts into every graph it injects into (AnimationInjector
// core/FullBodyEntryNames.h, core/PairEntryNames.h and the GraphInjector blend nodes). Generated
// names always carry the action ID (AI_<id>_...), so only a name typed by the author can equal one.
// The runtime sends these events itself whenever a full-body action or a pair starts.
export const runtimeEventNames = [
  'AI_FullBodyEnter',
  'AI_FullBodyLinkEnter',
  'AI_PairEnterLead',
  'AI_PairEnterSupport',
];
// Graph variables, states and blend nodes: XML has no field for them, an event named so is only confusing.
export const runtimeFixedNames = [
  ...runtimeEventNames,
  'iAI_FullBodyState',
  'fAI_FullBodyBlend',
  'iAI_PairState',
  'fAI_PairExitBlend',
  'fAI_PairLossBlend',
  'fAI_PairRecoveryBlend',
  'AI_PairLead',
  'AI_PairSupport',
  'AI_PairLead_Behavior',
  'AI_PairSupport_Behavior',
  'AI_FullBodyEnterBlend',
  'AI_FullBodyLinkEnterBlend',
];
const fixed = new Map(runtimeFixedNames.map(n => [n.toLowerCase(), n]));
const events = new Set(runtimeEventNames.map(n => n.toLowerCase()));

// Every exported value equal to a fixed runtime name, ignoring case like the runtime's event maps.
// All string values are read, so a new event field is covered without being listed here; unconnected
// drafts and asset metadata never reach the XML and are not read.
export function runtimeNameUses(w: Workspace): {node: string; message: string}[] {
  const out: {node: string; message: string}[] = [],
    seen = new Set<string>();
  const scan = (value: unknown, node: string, depth: number): void => {
    if (depth > 40) return;
    if (typeof value === 'string') {
      // Cancel targets list several names ("vanilla:Attack, event:Name").
      for (const part of value.split(',')) {
        const text = part.trim(),
          key = (text.startsWith('event:') ? text.slice(6) : text).trim().toLowerCase(),
          name = fixed.get(key);
        if (!name || seen.has(node + '|' + key)) continue;
        seen.add(node + '|' + key);
        out.push({
          node,
          message: events.has(key)
            ? tr(
                "'{name}'은 런타임 공용 이벤트 이름입니다(대소문자 무시). 런타임이 동작·페어를 시작할 때 직접 보내는 이벤트라, 같은 이름을 쓰면 의도치 않게 반응하거나 잘못된 상태로 들어갈 수 있습니다. 다른 이름을 쓰세요.",
                {name}
              )
            : tr(
                "'{name}'은 런타임이 쓰는 고정 이름(그래프 변수·상태·블렌드 노드)입니다(대소문자 무시). 혼동을 피하려면 다른 이름을 쓰세요.",
                {name}
              ),
        });
      }
      return;
    }
    if (Array.isArray(value)) for (const v of value) scan(v, node, depth + 1);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) scan(v, node, depth + 1);
  };
  for (const a of w.actions) scan(a, a.uid, 0);
  for (const l of w.links) scan(l, l.id, 0);
  scan(w.globals, 'globals', 0);
  scan(w.parameters, 'parameters', 0);
  scan(w.sharedInputs, 'inputs', 0);
  scan([w.id, w.name, w.qtes, w.eventRegistry, w.blends, w.sharedRules], 'project', 0);
  return out;
}
