import type {Action, Workspace} from './workspace.ts';
import type {Mark} from './model.ts';
import {mark} from './model.ts';
import {tr} from './i18n/korean.ts';

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
};
export type CarryWeapon = 'sheathed' | 'sheathe';
export const defaultCarry = (a?: Action): Carry => ({
  bone: 'NPC R Clavicle [RClv]',
  targetRoot: 'NPC Root [Root]',
  putdownAction: '',
  input: a?.config.start.input || a?.config.inputs[0]?.id || '',
  target: 'pose',
  part: '',
  hold: null,
  fix: null,
  weapon: 'sheathed',
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
// Verified against HKX_Viewer's character skeleton metadata. Custom rigs may use other names.
export const carryBones = (): [string, string][] => [
  ['NPC R Clavicle [RClv]', tr('오른쪽 어깨')],
  ['NPC L Clavicle [LClv]', tr('왼쪽 어깨')],
  ['NPC R Hand [RHnd]', tr('오른손')],
  ['NPC L Hand [LHnd]', tr('왼손')],
  ['NPC Spine2 [Spn2]', tr('등')],
  ['NPC Pelvis [Pelv]', tr('골반')],
  ['NPC Head [Head]', tr('머리')],
];
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
  if (!putdown || !putdownCandidate(putdown, a))
    out.push(
      tr('운반: 내려놓기 동작을 고르세요. 시작 입력·조건 분기·방향 클립이 없는 한 사람 일반 동작이어야 합니다.')
    );
  else if (!putdown.config.carryRelease)
    out.push(
      tr("운반: 내려놓기 동작 '{actionId}'에 대상 놓기 시점이 필요합니다.", {actionId: putdown.config.actionId})
    );
  return out;
}
// Same rule as the runtime: a plain one-actor Action that only the carry starts.
export function putdownCandidate(x: Action, lift: Action): boolean {
  return x.uid !== lift.uid && !x.pair && !x.flow && x.config.kind === 'single' && x.config.start.mode === 'none';
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
