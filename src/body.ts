// Part actions (runtime 1.0.9, <Action body="upper|rightArm|leftArm">, AnimationInjector runtime/BodyPart.h): the
// HKX plays on the upper body or one arm while the legs keep the locomotion, so the player moves freely. Third person
// only. Its transitions are a full-body action's (charge, 11-20: a start and hold on the upper body while walking, the
// release on the whole body), except a movement transition (it plays while moving) and a transition's blend (the
// destination's enter blend crosses). Never a pair, a carry's putdown or a creature's action.
import type {Action, Workspace} from './workspace.ts';
import type {Issue} from './model.ts';
import {clone} from './model.ts';
import {tr} from './i18n/korean.ts';
import {isCreatureRig, actionRig} from './creatureRig.ts';

export type BodyPart = 'upper' | 'rightArm' | 'leftArm';
export const bodyParts: readonly BodyPart[] = ['upper', 'rightArm', 'leftArm'];
export const bodyLabel = (part: BodyPart | undefined) =>
  part === 'upper' ? tr('상체') : part === 'rightArm' ? tr('오른팔') : part === 'leftArm' ? tr('왼팔') : tr('전신');
/** The part an action plays on; undefined = the whole body. */
export const actionBody = (a: Action): BodyPart | undefined => a.config.body;
export const isPart = (a: Action | undefined) => !!a?.config.body;

/** Why an action plays on the whole body whatever: a pair, a carry's putdown, a creature's action. */
export function fixedWhole(w: Workspace, a: Action): 'pair' | 'putdown' | 'creature' | '' {
  if (a.pair) return 'pair';
  if (w.actions.some(x => x.pair?.carry?.putdownAction === a.uid)) return 'putdown';
  return isCreatureRig(actionRig(a)) ? 'creature' : '';
}
export const fixedWholeReason = (why: ReturnType<typeof fixedWhole>) =>
  why === 'pair'
    ? tr('페어는 전신으로만 재생됩니다.')
    : why === 'putdown'
      ? tr('운반의 내려놓기 동작은 전신으로만 재생됩니다.')
      : why === 'creature'
        ? tr('크리처 동작은 전신으로만 재생됩니다.')
        : '';

/** The 「+ 설정」 ids a part action is not offered (the runtime refuses them on one). */
export const partHiddenSettings: readonly string[] = ['otherView', 'air', 'attack'];
/** The 「+ 기능」 kinds a part action is not offered: a movement transition, the state features, the event block
 *  (nothing is a state of ours to block in), the camera restore, QTE and carry. */
export const partHiddenAdds: readonly string[] = [
  'transitionMove',
  'suppress',
  'cameraRestore',
  'qte',
  'carry',
  'carryRelease',
  'notify:rotate',
  'notify:iframe',
  'notify:armor',
  'notify:time',
  'notify:cost',
  'notify:recovery',
];

/** A part loop's maxHold when the XML names none: 3 s with a charge release from it (on="release"), else until it
 *  is ended (0). */
export const partLoopDefault = (w: Workspace, a: Action) =>
  w.links.some(l => l.from === a.uid && l.mode === 'release') ? 3 : 0;

/** Sets the part an action plays on (undefined: the whole body). A part action plays in third person and takes none
 *  of the playback settings the runtime refuses on one: they go back to their defaults. */
export function setActionBody(w: Workspace, uid: string, body: BodyPart | undefined): Workspace {
  const next = clone(w),
    a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾지 못했습니다.'));
  const fixed = fixedWhole(next, a);
  if (body && fixed) throw new Error(fixedWholeReason(fixed));
  if (body !== 'upper') delete a.config.facing;
  if (!body) {
    delete a.config.body;
    // A whole-body loop always has its maxHold (0 meant 「until it is ended」, a part loop's).
    if (a.config.loop && a.config.loop.maxHold === 0) a.config.loop = {maxHold: 3};
    return next;
  }
  a.config.body = body;
  delete a.view;
  delete a.otherView;
  a.config.air = 'deny';
  a.config.attack = '';
  a.config.steps = a.config.steps.map(s => ({...s, attack: ''}));
  return next;
}

/** The upper body's direction (runtime facing="camera"): toward the camera, or the legs' heading (undefined). */
export function setActionFacing(w: Workspace, uid: string, camera: boolean): Workspace {
  const next = clone(w),
    a = next.actions.find(a => a.uid === uid);
  if (!a) throw new Error(tr('동작을 찾지 못했습니다.'));
  if (camera && a.config.body !== 'upper') throw new Error(tr('상체 방향은 부위가 상체일 때만 정합니다.'));
  if (camera) a.config.facing = 'camera';
  else delete a.config.facing;
  return next;
}
/** The 「부위」 chip's value: the part, and the upper body's direction when it faces the camera. */
export const bodyChipValue = (a: Action) =>
  a.config.body === 'upper' && a.config.facing === 'camera'
    ? tr('{v0} · 화면', {v0: bodyLabel(a.config.body)})
    : bodyLabel(a.config.body);

/** What the runtime refuses on a part action, as the card's problems. */
export function bodyIssues(w: Workspace): Issue[] {
  const out: Issue[] = [];
  const err = (node: string, message: string) => out.push({level: 'error', node, message});
  const name = (a: Action) => a.config.name || a.config.actionId;
  const byUid = new Map(w.actions.map(a => [a.uid, a]));
  for (const a of w.actions) {
    if (!a.config.body) continue;
    const fixed = fixedWhole(w, a);
    if (fixed) err(a.uid, name(a) + ': ' + fixedWholeReason(fixed));
    const p = a.config,
      items: string[] = [];
    if (p.slots.rotate.enabled) items.push(tr('회전 허용'));
    if (p.slots.iframe.enabled) items.push(tr('피해 면역'));
    if (p.slots.armor.enabled) items.push(tr('스태거 면역'));
    if (p.slots.time.enabled) items.push(tr('시간 배율'));
    if (p.cost.enabled) items.push(tr('자원 소모'));
    if (p.recovery.enabled) items.push(tr('이동키 취소'));
    if (p.suppress) items.push(tr('이벤트 차단'));
    if (a.cameraEnabled) items.push(tr('카메라 복구'));
    if (w.qtes?.some(q => q.owner === a.uid)) items.push('QTE');
    if (items.length)
      err(a.uid, tr('{v0}: 부위 동작에는 쓸 수 없습니다: {items}', {v0: name(a), items: items.join(', ')}));
    if (p.loop && p.loop.maxHold === 0 && partLoopDefault(w, a) !== 0)
      err(a.uid, tr('{v0}: 차지 종료 전환이 있으면 최대 유지 시간을 정하세요(0.1~600초).', {v0: name(a)}));
  }
  for (const l of w.links) {
    const from = byUid.get(l.from),
      to = byUid.get(l.to),
      partner = byUid.get(l.partnerTo);
    if (!from) continue;
    if (from.config.body && l.mode === 'move')
      err(from.uid, tr('{v0}: 부위 동작은 이동하면서 재생되므로 이동 전환을 쓰지 않습니다.', {v0: name(from)}));
    if ((from.config.body || to?.config.body) && l.blend !== undefined)
      err(
        from.uid,
        tr(
          '{v0}: 부위 동작에 들어가거나 나오는 전환에는 블렌드를 쓰지 않습니다(도착 동작의 시작 블렌드로 이어집니다).',
          {
            v0: name(from),
          }
        )
      );
    if (from.pair && to?.config.body)
      err(from.uid, tr('{v0}: 페어에서 부위 동작으로는 전환할 수 없습니다.', {v0: name(from)}));
    if (from.config.body && to?.pair)
      err(from.uid, tr('{v0}: 부위 동작에서 페어로는 전환할 수 없습니다.', {v0: name(from)}));
    if (partner?.config.body)
      err(from.uid, tr('{v0}: 페어 상대의 다음 동작으로 부위 동작은 쓰지 않습니다.', {v0: name(from)}));
  }
  return out;
}
