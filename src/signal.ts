// OAR signals (runtime 1.0.9, <Action signal="Charge">, AnimationInjector runtime/Signals.h): while the action plays
// the runtime keeps the actor's bool graph variable bAI_<AnimationSet id>_<name> true, and an Open Animation Replacer
// submod swaps the locomotion on it (CompareValues, graphVariable Bool == 1). Actions of one name share the variable,
// so a charge's start, hold and release can keep one locomotion set through. Ordinary character actions only (whole
// body or part): never a pair or a creature's action.
import type {Action, Workspace} from './workspace.ts';
import type {Issue} from './model.ts';
import {clone} from './model.ts';
import {tr} from './i18n/korean.ts';
import {isCreatureRig, actionRig} from './creatureRig.ts';

/** A signal name as the runtime reads it: 1~32 of A-Z a-z 0-9 _. */
export const validSignalName = (name: string) => /^[A-Za-z0-9_]{1,32}$/.test(name);
/** The graph variable an OAR condition reads for `name` in this project (its AnimationSet id). */
export const signalVariable = (w: Workspace, name: string) => `bAI_${w.id}_${name}`;
/** Why an action takes no signal: a pair or a creature's action (''). */
export function signalRefused(a: Action): string {
  if (a.pair) return tr('OAR 신호는 일반 동작에만 씁니다(페어는 안 됨).');
  if (isCreatureRig(actionRig(a))) return tr('OAR 신호는 사람(캐릭터) 동작에만 씁니다.');
  return '';
}

/** Sets an action's signal name ('' or undefined: none). The name is kept as typed, the card shows its problem. */
export function setActionSignal(w: Workspace, uid: string, name: string | undefined): Workspace {
  const next = clone(w),
    a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾지 못했습니다.'));
  if (name) a.config.signal = name;
  else delete a.config.signal;
  return next;
}

/** The signal names this project uses, each with the actions carrying it (the card lists the others). */
export const signalUsers = (w: Workspace, name: string) =>
  w.actions.filter(a => a.config.signal && a.config.signal.toLowerCase() === name.toLowerCase());

/** What the runtime refuses, as the card's problems. */
export function signalIssues(w: Workspace): Issue[] {
  const out: Issue[] = [];
  for (const a of w.actions) {
    const s = a.config.signal;
    if (s === undefined) continue;
    const name = a.config.name || a.config.actionId;
    if (!validSignalName(s))
      out.push({
        level: 'error',
        node: a.uid,
        message: tr('{v0}: OAR 신호 이름은 영문·숫자·_ 1~32자입니다: {v1}', {v0: name, v1: s}),
      });
    const refused = signalRefused(a);
    if (refused) out.push({level: 'error', node: a.uid, message: name + ': ' + refused});
  }
  return out;
}
