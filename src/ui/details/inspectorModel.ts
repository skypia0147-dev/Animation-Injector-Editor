import {selectsOnly, type Action, type Workspace} from '../../workspace.ts';
import type {FlatNode} from '../../graph/flat.ts';
import {blendBinding, blendNodes, entryBlendActions} from '../../graph/blends.ts';
import {ruleNode} from '../../graph/sharing.ts';
import {barText, exitToBar} from '../../graph/clipBar.ts';
import {tr} from '../../i18n/korean.ts';

export function exitSummary(a: Action): string {
  const v = a.config.exit;
  if (v.basis === 'event') return v.event || tr('이벤트 미지정');
  // At 「끝」 the trigger keeps 0.05 s before the clip's end (docs/mockup-clip-bar); an older value is end − n.
  return barText(exitToBar(v));
}

export function playbackNode(nodes: FlatNode[], action: Action, step?: string) {
  return (
    nodes.find(n => n.action === action.uid && n.kind === 'hkxPlay' && n.step === (step || action.config.entry)) ??
    nodes.find(n => n.action === action.uid && n.kind === 'hkxPlay')
  );
}

/** The card that stands for an action: its HKX card, or a selecting action's decision card (it draws no
 *  HKX card, graph/sharing.ts). */
export function actionNode(w: Workspace, nodes: FlatNode[], action: Action, step?: string): string | undefined {
  if (action.flow && selectsOnly(action))
    return w.conditionTables?.includes(action.uid)
      ? `conditionTable:${action.uid}`
      : `flow:${action.uid}:${action.flow.entry}`;
  return playbackNode(nodes, action, step)?.id;
}

export function actionBlends(w: Workspace, action: string) {
  return blendNodes(w).flatMap(b => {
    try {
      const role = blendBinding(w, b);
      const applies =
        role.action === action || (role.kind === 'enter' && entryBlendActions(w, role.action).includes(action));
      const disconnected = !!w.disconnections?.some(c => c.bindings.some(e => e.source === b.id || e.target === b.id));
      return applies ? [{...b, role, inherited: role.action !== action, disconnected}] : [];
    } catch {
      return [];
    }
  });
}

export function sharedNodeMembers(w: Workspace, id: string) {
  const g = w.sharedRules?.find(g => g.members.some(m => ruleNode(g.kind, m, w) === id));
  return g ? g.members.map(m => ruleNode(g.kind, m, w)) : [id];
}

export function detachInspectorNode(w: Workspace, id: string): Workspace {
  return {
    ...w,
    sharedRules: w.sharedRules
      ?.map(g => ({...g, members: g.members.filter(m => ruleNode(g.kind, m, w) !== id)}))
      .filter(g => g.members.length > 1),
  };
}

// A single-clip editor exposes the effective value; only an explicit edit normalizes it.
export function setSingleAttack(a: Action, attack: string): Action {
  if (a.config.steps.length !== 1) throw Error(tr('단일 HKX에서만 공격 데이터를 통합 편집할 수 있습니다.'));
  return {...a, config: {...a.config, attack, steps: a.config.steps.map(s => ({...s, attack: ''}))}};
}
