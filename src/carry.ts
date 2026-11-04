import type {Action, Workspace} from './workspace.ts';
import type {Mark} from './model.ts';
import {mark} from './model.ts';
import {tr} from './i18n/korean.ts';
import {reaches} from './cards.ts';
import {rigBones} from './rigBones.ts';
import type {Ragdoll} from './ragdoll.ts';

// Runtime counterparts: CarrySpec / CarryHoldSpec (AnimationInjector runtime/CarrySpec.h).
export type CarryHoldBone = {name: string; weight: number};
/** Carrier upper-body hold pose. A weight is inherited by descendant bones until another Bone overrides it. */
export type CarryHold = {
  /** 'lift-end' = the lift clip's last frame: the only pose the runtime accepts (an HKX hold pose, carry
   *  stage 2b, was dropped; runtime 0.12.206 rejects any other value). */
  pose: string;
  blendIn: number;
  blendOut: number;
  bones: CarryHoldBone[];
};
export type CarryTarget = 'pose' | 'physics';
export type Carry = {
  bone: string;
  targetRoot: string;
  /** uid of the one-actor putdown Action; its carryRelease moment drops the target as a ragdoll. */
  putdownAction: string;
  input: string;
  /** pose = the lift's last pose, frozen; physics = one ragdoll body fixed to the carrier bone. */
  target: CarryTarget;
  /** physics only: the target bone whose body stays fixed; '' = the body nearest the carrier bone. */
  part: string;
  hold: CarryHold | null;
  /** The fix moment (seconds into the lift clip): from here the target's pose is locked and it follows
   *  the carrier bone for the rest of the lift. null = when the lift ends. */
  fix: {at: Mark} | null;
  /** sheathed = starts only sheathed, drawing drops the target; sheathe = may start drawn: the carrier's weapon
   *  goes to its sheath with no animation as the lift starts, then drawing drops the target, runtime 0.12.195. */
  weapon: CarryWeapon;
  /** physics only: the ragdoll values the lift action's file holds (<folder>/Ragdoll/<lift id>.xml, ragdoll.ts);
   *  null = no file, vanilla (the runtime's built-in values). Read from and written to that file, never kept in the XML's editor
   *  block (the file is what the game reads). */
  ragdoll: Ragdoll | null;
};
export type CarryWeapon = 'sheathed' | 'sheathe';
export const defaultCarry = (a?: Action): Carry => ({
  bone: 'NPC R Hand [RHnd]',
  targetRoot: 'NPC Root [Root]',
  putdownAction: '',
  input: a?.config.inputs[0]?.id || '',
  target: 'pose',
  part: '',
  hold: defaultCarryHold(),
  fix: null,
  weapon: 'sheathed',
  ragdoll: null,
});
/** Default fix moment for a new '대상 고정' item: 1 s, dragged into place on the lift's timeline. */
export const defaultCarryFix = (): {at: Mark} => ({at: mark(1)});
/** The runtime reads the fix moment as plain seconds from the lift clip's start (<Fix at="...">). */
export function validCarryFix(fix: {at: Mark}): boolean {
  const m = fix.at;
  return m.basis === 'seconds' && !m.fallback && Number.isFinite(m.seconds) && m.seconds >= 0 && m.seconds <= 600;
}
export const defaultCarryHold = (bones: CarryHoldBone[] = carryHoldPresets[0][2]): CarryHold => ({
  pose: 'lift-end',
  blendIn: 0.2,
  blendOut: 0.2,
  bones: structuredClone(bones),
});
/** Hold presets: one clavicle weight covers the whole arm below it. */
export const carryHoldPresets: [string, () => string, CarryHoldBone[]][] = [
  ['right', () => tr('오른팔'), [{name: 'NPC R Clavicle [RClv]', weight: 1}]],
  ['left', () => tr('왼팔'), [{name: 'NPC L Clavicle [LClv]', weight: 1}]],
  [
    'both',
    () => tr('양팔'),
    [
      {name: 'NPC R Clavicle [RClv]', weight: 1},
      {name: 'NPC L Clavicle [LClv]', weight: 1},
    ],
  ],
];
export function carryHoldPreset(hold: CarryHold | null): string {
  if (!hold) return 'off';
  const same = (a: CarryHoldBone[], b: CarryHoldBone[]) =>
    a.length === b.length && a.every((x, i) => x.name === b[i].name && x.weight === b[i].weight);
  return carryHoldPresets.find(([, , bones]) => same(hold.bones, bones))?.[0] ?? 'custom';
}
export type CarryHand = 'right' | 'left' | 'both' | 'custom';
const handBones = {right: 'NPC R Hand [RHnd]', left: 'NPC L Hand [LHnd]', both: 'NPC R Hand [RHnd]'};
/** The gripping hand: the attach bone and the held arm read together. Both hands attach to the right hand (an attach
 *  is one bone) and hold both arms. Any other pair (a shoulder, the other side's arm, arm bones of its own) is
 *  'custom' and keeps its values. */
export function carryHand(c: Carry): CarryHand {
  const arm = carryHoldPreset(c.hold);
  if (c.bone === handBones.right)
    return arm === 'both' ? 'both' : arm === 'right' || arm === 'off' ? 'right' : 'custom';
  if (c.bone === handBones.left) return arm === 'left' || arm === 'off' ? 'left' : 'custom';
  return 'custom';
}
/** Choosing a hand sets the attach bone and, unless the arm hold is off, the held arm to match; both hands hold both. */
export function setCarryHand(c: Carry, hand: Exclude<CarryHand, 'custom'>): Carry {
  const bones = carryHoldPresets.find(([id]) => id === hand)![2];
  return {
    ...c,
    bone: handBones[hand],
    hold: c.hold || hand === 'both' ? {...(c.hold ?? defaultCarryHold()), bones: structuredClone(bones)} : null,
  };
}
export const carryHands = (): [Exclude<CarryHand, 'custom'>, string][] => [
  ['right', tr('오른손')],
  ['left', tr('왼손')],
  ['both', tr('양손')],
];
export type BoneOption = {name: string; label?: string};
// Names for the bones a carry picks most: the character's attach bones and ragdoll bodies, and the chicken's bodies.
const boneLabels = (): Record<string, string> => ({
  'NPC R Hand [RHnd]': tr('오른손'),
  'NPC L Hand [LHnd]': tr('왼손'),
  'NPC R Clavicle [RClv]': tr('오른쪽 어깨'),
  'NPC L Clavicle [LClv]': tr('왼쪽 어깨'),
  'NPC Pelvis [Pelv]': tr('골반'),
  'NPC Root [Root]': tr('루트'),
  'NPC COM [COM ]': tr('몸 중심'),
  'NPC Spine [Spn0]': tr('허리'),
  'NPC Spine1 [Spn1]': tr('배'),
  'NPC Spine2 [Spn2]': tr('가슴'),
  'NPC Neck [Neck]': tr('목'),
  'NPC Head [Head]': tr('머리'),
  'NPC R UpperArm [RUar]': tr('오른쪽 위팔'),
  'NPC L UpperArm [LUar]': tr('왼쪽 위팔'),
  'NPC R Forearm [RLar]': tr('오른쪽 아래팔'),
  'NPC L Forearm [LLar]': tr('왼쪽 아래팔'),
  'NPC R Thigh [RThg]': tr('오른쪽 허벅지'),
  'NPC L Thigh [LThg]': tr('왼쪽 허벅지'),
  'NPC R Calf [RClf]': tr('오른쪽 종아리'),
  'NPC L Calf [LClf]': tr('왼쪽 종아리'),
  'NPC R Foot [Rft ]': tr('오른발'),
  'NPC L Foot [Lft ]': tr('왼발'),
  Pelvis: tr('몸통'),
  Neck0: tr('목 아래'),
  Neck1: tr('목 가운데'),
  Neck2: tr('목 위'),
  HEAD: tr('머리'),
  RightAnkle: tr('오른발'),
  LeftAnkle: tr('왼발'),
});
/** Bone names as options, the named ones first. */
export function boneOptions(names: string[]): BoneOption[] {
  const labels = boneLabels(),
    options = names.map(name => (labels[name] ? {name, label: labels[name]} : {name}));
  return [...options.filter(o => o.label), ...options.filter(o => !o.label)];
}
/** A rig's bones from its skeleton.nif (src/rigBones.ts). Unknown rigs have none. */
export function rigBoneOptions(rig: string, bodies = false): BoneOption[] {
  const entry = rigBones[rig];
  return boneOptions((bodies ? entry?.bodies : entry?.bones) ?? []);
}
/** The lists a carry's bone fields offer. The lift HKX's own bones come first (`pair`: the carrier's tracks and the
 *  target's 2_ tracks, from the backend's hkx_pair_bones); without them, the rig's skeleton.nif. The grip point is a
 *  ragdoll body, which an HKX does not know: its target bones that the rig has a body on, or all of them when the
 *  rig names none of them (a custom skeleton). */
export function carryBoneLists(rig: string, pair?: [string[], string[]] | null) {
  const carrier = pair?.[0].length ? boneOptions(pair[0]) : rigBoneOptions('character'),
    target = pair?.[1].length ? boneOptions(pair[1]) : rigBoneOptions(rig);
  if (!pair?.[1].length) return {carrier, target, bodies: rigBoneOptions(rig, true)};
  const known = new Set((rigBones[rig]?.bodies ?? []).map(n => n.toLowerCase())),
    held = pair[1].filter(n => known.has(n.toLowerCase()));
  return {carrier, target, bodies: boneOptions(held.length ? held : pair[1])};
}
/** The carry item's line on its card: the hand, then how the target hangs (and where it is held). */
export function carrySummary(c: Carry): string {
  const hand = carryHand(c),
    labels = boneLabels(),
    name = hand === 'custom' ? labels[c.bone] || c.bone : carryHands().find(([id]) => id === hand)![1];
  if (c.target === 'pose') return name + ' · ' + tr('자세 그대로');
  const part = c.part ? labels[c.part] || c.part : tr('자동');
  return name + ' · ' + tr('매달림') + ' · ' + part;
}
export function validBoneName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 256 &&
    !value.startsWith(' ') &&
    !value.endsWith(' ') &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
export const NEW_CARRY_INPUT = '+new';
/** The putdown key: one of the pair's inputs, a project input (입력 관리) copied onto the pair, or a new input
 *  whose key is set next. A pair reached only by a transition has no input of its own. A keyless input the
 *  previous choice left behind is dropped. */
export function chooseCarryInput(w: Workspace, a: Action, choice: string): Action {
  const carry = a.pair?.carry;
  if (!carry || choice === carry.input) return a;
  let inputs = a.config.inputs.filter(i => i.id !== carry.input || i.key || i.gamepad),
    id = choice;
  if (choice === NEW_CARRY_INPUT) {
    id = 'PutDown';
    for (let n = 2; inputs.some(i => i.id.toLowerCase() === id.toLowerCase()); n++) id = 'PutDown' + n;
    inputs = [...inputs, {id, label: tr('내려놓기'), key: '', gamepad: 0}];
  } else {
    const shared = w.sharedInputs.find(i => i.id === choice);
    if (shared && !inputs.some(i => i.id === choice)) inputs = [...inputs, structuredClone(shared)];
  }
  return {...a, config: {...a.config, inputs}, pair: {...a.pair!, carry: {...carry, input: id}}};
}
export function carryErrors(w: Workspace, a: Action): string[] {
  const c = a.pair?.carry;
  if (!c) return [];
  const out: string[] = [];
  if (!validBoneName(c.bone) || !validBoneName(c.targetRoot)) out.push(tr('운반: 본 이름을 정확히 입력하세요.'));
  if (!a.config.inputs.some(i => i.id === c.input)) out.push(tr('운반: 내려놓기 입력을 선택하세요.'));
  if (c.target !== 'pose' && c.target !== 'physics') out.push(tr('운반: 대상 처리를 선택하세요.'));
  if (c.part && (c.target !== 'physics' || !validBoneName(c.part)))
    out.push(tr('운반: 고정 몸체는 래그돌 고정에서만 쓰며 본 이름을 정확히 입력하세요.'));
  const h = c.hold;
  if (h) {
    if (h.pose !== 'lift-end') out.push(tr('운반: 들기 자세는 들기 끝 자세만 씁니다.'));
    if (!(h.blendIn >= 0 && h.blendIn <= 5) || !(h.blendOut >= 0 && h.blendOut <= 5))
      out.push(tr('운반: 상체 자세의 블렌드는 0~5초입니다.'));
    const names = new Set<string>();
    for (const b of h.bones) {
      if (!validBoneName(b.name)) out.push(tr('운반: 상체 자세의 본 이름을 정확히 입력하세요.'));
      else if (names.has(b.name.toLowerCase())) out.push(tr('운반: 상체 자세에 같은 본이 두 번 있습니다: ') + b.name);
      names.add(b.name.toLowerCase());
      if (!(b.weight >= 0 && b.weight <= 1)) out.push(tr('운반: 본 가중치는 0~1입니다: ') + b.name);
    }
    if (!h.bones.some(b => b.weight > 0))
      out.push(tr('운반: 상체 자세에 가중치가 0보다 큰 본이 하나 이상 필요합니다.'));
  }
  if (!['sheathed', 'sheathe'].includes(c.weapon)) out.push(tr('운반: 무기 처리를 선택하세요.'));
  if (c.fix && !validCarryFix(c.fix))
    out.push(tr('운반: 대상 고정 시점은 클립 시작 기준 0~600초로 지정합니다(이벤트·대체값 없음).'));
  const putdown = w.actions.find(x => x.uid === c.putdownAction);
  if (!putdown || !putdownCandidate(putdown, a, w))
    out.push(
      tr('운반: 내려놓기 동작을 고르세요. 시작 카드가 가지 않는(조건 카드를 거쳐서도) 한 사람 일반 동작이어야 합니다.')
    );
  else if (!putdown.config.carryRelease)
    out.push(
      tr("운반: 내려놓기 동작 '{actionId}'에 대상 놓기 시점이 필요합니다.", {actionId: putdown.config.actionId})
    );
  return out;
}
// Same rule as the runtime: a plain one-actor Action that only the carry starts (no start card goes to it, directly
// or through condition cards).
export function putdownCandidate(x: Action, lift: Action, w?: Workspace): boolean {
  return x.uid !== lift.uid && !x.pair && x.config.kind === 'single' && !w?.starts.some(s => reaches(w, s.to, x.uid));
}
/** The runtime rejects a CarryRelease outside a carry's putdown Action. */
export function strayCarryRelease(w: Workspace, a: Action): boolean {
  return !!a.config.carryRelease && !w.actions.some(x => x.pair?.carry?.putdownAction === a.uid);
}
// Choosing the putdown Action also gives it a release moment when it has none: 0.3 s before the clip
// ends when the HKX length is known, otherwise 1 s (dragged into place on its timeline).
export function setPutdown(w: Workspace, lift: string, putdown: string, clipSeconds?: number): Workspace {
  return {
    ...w,
    actions: w.actions.map(x => {
      if (x.uid === lift && x.pair?.carry)
        return {...x, pair: {...x.pair, carry: {...x.pair.carry, putdownAction: putdown}}};
      if (x.uid === putdown && putdown && !x.config.carryRelease) {
        const at =
          clipSeconds && Number.isFinite(clipSeconds) && clipSeconds > 0.3
            ? Math.round((clipSeconds - 0.3) * 1000) / 1000
            : 1;
        return {...x, config: {...x.config, carryRelease: {at: mark(at)}}};
      }
      return x;
    }),
  };
}
