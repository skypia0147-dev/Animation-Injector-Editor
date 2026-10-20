import {isRecovery} from '../clipRecovery.ts';
import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import {animId} from './blends.ts';
import {reuseBlend} from './reuseBlend.ts';
import {nodeSettings, applyNodeSettings} from './nodeSettings.ts';
import {shareNodeSettings} from './sharing.ts';
import {rows, add} from '../timeline/model.ts';
import {sourceWindow} from './clipWindows.ts';
import {parseNodeId} from './nodeRef.ts';
import {tr} from '../i18n/korean.ts';

export function reuseConnection(w: Workspace, s: FlatNode | undefined, t: FlatNode | undefined): Workspace | undefined {
  if (!s || !t || s.id.startsWith('draft:') || t.id.startsWith('draft:')) return;
  const play = s.kind === 'hkxPlay' ? s : t.kind === 'hkxPlay' ? t : undefined;
  const setting = play === s ? t : s;
  if (!play?.action || !setting) return;
  const original = nodeSettings(w, setting.id);
  if (!original) return;
  if (setting.kind === 'blend') return reuseBlend(w, setting.id, play, play === s);
  if (
    !setting.action ||
    (setting.action === play.action &&
      !(setting.notify && isRecovery(setting.notify) && setting.notify !== 'recovery:' + play.step))
  )
    return;
  if (setting.scope.kind === 'link' && play === s && ['keyInput', 'markerReceive'].includes(setting.kind)) {
    const link = w.links.find(l => l.id === (setting.scope as {link: string}).link)!;
    if (link.to === play.action) throw Error(tr('같은 경로에서 자기 자신으로 전환할 수 없습니다.'));
    const n = structuredClone(w),
      a = n.actions.find(a => a.uid === play.action)!,
      from = w.actions.find(a => a.uid === link.from)!;
    let i = 1;
    while (n.links.some(l => l.id === 'sharedLink' + i)) i++;
    const next = {...structuredClone(link), id: 'sharedLink' + i, from: a.uid};
    const input = from.config.inputs.find(i => i.id === link.input);
    if (input) {
      let id = input.id,
        j = 1;
      while (a.config.inputs.some(i => i.id === id)) id = input.id + '_' + j++;
      a.config.inputs.push({...structuredClone(input), id});
      next.input = id;
    }
    const window = sourceWindow(a, play.step ?? a.config.entry);
    Object.assign(next, structuredClone(window.value));
    n.links.push(next);
    const id = `link:${next.id}|${setting.kind}`;
    return shareNodeSettings(n, setting.id, id);
  }
  if (setting.kind === 'hkxPlay' || setting.kind === 'conditionBranch' || setting.scope.kind === 'link') return;
  const donor = w.actions.find(a => a.uid === setting.action)!,
    receiver = w.actions.find(a => a.uid === play.action)!;
  if (setting.kind === 'notify' && !!donor.pair !== !!receiver.pair)
    throw Error(tr('역할 구조가 같은 일반 또는 페어 동작끼리 기능을 공유하세요.'));
  let n = structuredClone(w);
  const a = n.actions.find(a => a.uid === receiver.uid)!;
  let target: string;
  if (setting.kind === 'notify') {
    const row = rows(w, donor).find(r => r.id === setting.notify);
    if (!row) return;
    const existing = rows(n, a).find(r => r.kind === row.kind && !r.transition);
    if (existing) target = `notify:${a.uid}|${existing.id}`;
    else {
      const r = add(n, a.uid, row.kind, 0, 1);
      n = r.workspace;
      target = `notify:${a.uid}|${r.id}`;
    }
  } else if (setting.scope.kind === 'start' && ['keyInput', 'markerReceive', 'stateCondition'].includes(setting.kind)) {
    if (play !== t) return;
    target = `start:${a.uid}|${setting.kind}`;
  } else if (['cameraRestore', 'carry', 'suppress', 'fireArrow', 'outputPose'].includes(setting.kind)) {
    if (setting.kind === 'carry' && !a.pair) throw Error(tr('페어 동작에 사용하는 기능입니다.'));
    if (setting.kind === 'fireArrow' && a.pair) throw Error(tr('활 발사는 일반 동작에 사용하세요.'));
    target = animId(a.uid, setting.kind);
  } else return;
  applyNodeSettings(n, target, original);
  return shareNodeSettings(n, setting.id, target);
}

/** "이 조건을 다른 동작에도 공유": the other action starts through the same condition (its pass plays that
 *  action). A drag from a condition's pin changes the route instead (flat.ts fromBranch). */
export function shareCondition(w: Workspace, condition: string, action: string): Workspace {
  const test = parseNodeId(condition);
  const owner = test.kind === 'branch' ? w.actions.find(a => a.uid === test.owner) : undefined;
  if (test.kind !== 'branch' || !owner?.flow?.tests.some(t => t.id === test.test))
    throw Error(tr('공유할 조건이 없습니다.'));
  const receiver = w.actions.find(a => a.uid === action);
  if (!receiver || receiver.uid === owner.uid) throw Error(tr('다른 동작을 고르세요.'));
  if (receiver.flow) throw Error(tr('이미 조건이 있는 동작입니다. 그 동작의 조건을 편집하세요.'));
  const original = nodeSettings(w, condition);
  if (!original) throw Error(tr('공유할 조건이 없습니다.'));
  const n = structuredClone(w),
    a = n.actions.find(a => a.uid === action)!;
  a.flow = {
    entry: 'SharedCondition',
    tests: [{id: 'SharedCondition', kind: 'alive', subject: 'self', minimum: 0, pass: {action: a.uid}}],
  };
  const id = `flow:${a.uid}:SharedCondition`;
  applyNodeSettings(n, id, original);
  return shareNodeSettings(n, condition, id);
}
