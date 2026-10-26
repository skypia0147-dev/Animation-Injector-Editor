import type {Action, Workspace} from '../../workspace.ts';
import type {FlatNode} from '../../graph/flat.ts';
import {animId} from '../../graph/blends.ts';
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

/** The card that stands for an action: its HKX card. */
export function actionNode(_w: Workspace, nodes: FlatNode[], action: Action, step?: string): string | undefined {
  return playbackNode(nodes, action, step)?.id;
}

/** An HKX card's start and end blends (XML format 6: <Action enter>, <Exit blend>). */
export function actionBlends(w: Workspace, action: string) {
  const a = w.actions.find(a => a.uid === action);
  if (!a) return [];
  return [
    ...(a.enterBlendEnabled
      ? [{id: animId(action, 'blendIn'), seconds: a.config.enterBlend, role: {kind: 'enter' as const, action}}]
      : []),
    ...(a.exitBlendEnabled
      ? [{id: animId(action, 'blendOut'), seconds: a.config.exitBlend, role: {kind: 'exit' as const, action}}]
      : []),
  ].map(b => ({...b, inherited: false, disconnected: false}));
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
