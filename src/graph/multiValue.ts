import {tr} from '../i18n/korean.ts';
import {equippedTypes} from '../runtimeExtensions.ts';

// A check that takes several values (runtime 0.12.301, docs/mockup-condition-groups ③): its value field holds them as
// the XML does, a comma list ("sword,dagger"), and it holds when any of them does.

/** The condition kinds whose value is a list, and the field holding it. */
export const multiValueField: Record<string, 'option' | 'equipmentType' | 'attackState'> = {
  equippedType: 'equipmentType',
  attackState: 'attackState',
  movementDirection: 'option',
  lying: 'option',
  rig: 'option',
  actorType: 'option',
  actorStatus: 'option',
  relationship: 'option',
  weather: 'option',
  hitReceived: 'option',
};
export const valuesOf = (s: string | undefined) => (s ? s.split(',') : []);
export const joinValues = (values: string[]) => values.join(',');
/** The problem with a value list: none chosen, one not offered, or one twice. */
export function valuesError(s: string | undefined, choices: readonly string[]): string | undefined {
  const values = valuesOf(s);
  if (!values.length || values.some(v => !choices.includes(v))) return tr('조건의 검사 값을 선택하세요.');
  if (new Set(values).size !== values.length) return tr('같은 검사 값이 두 번 있습니다.');
}
/** The hand a check looks at (장착 종류, 장비 키워드), shown as a chip of its own colour (docs/mockup-hand-chip B), in
 *  the chip's short words (docs/mockup-chip-i18n ⑥: English 「Right」, not 「Right hand」). */
export type Hand = 'left' | 'right' | 'either';
export const hands: readonly Hand[] = ['left', 'right', 'either'];
export const handLabel = (h: Hand) =>
  h === 'right' ? tr('오른손@손 칩') : h === 'left' ? tr('왼손@손 칩') : tr('모두@손 칩');
export const equippedTypeLabels = (): Record<(typeof equippedTypes)[number], string> => ({
  bow: tr('활'),
  crossbow: tr('석궁'),
  sword: tr('검'),
  dagger: tr('단검'),
  axe: tr('도끼'),
  mace: tr('철퇴'),
  greatsword: tr('대검'),
  battleaxe: tr('전투도끼'),
  warhammer: tr('전쟁망치'),
  staff: tr('지팡이'),
  shield: tr('방패'),
  spell: tr('주문'),
  torch: tr('횃불'),
  unarmed: tr('맨손'),
});
