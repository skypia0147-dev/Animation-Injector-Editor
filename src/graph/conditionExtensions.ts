import {pairedRigs} from '../pairedRigs.ts';
import type {BranchTest} from './conditions.ts';
import {tr} from '../i18n/korean.ts';

type Definition = {
  label: string;
  category: string;
  choices?: readonly (readonly [string, string])[];
  numeric?: boolean;
  form?: string;
  hint: string;
};
export const extensionConditions = {
  movementDirection: {
    get label() {
      return tr('이동 입력 방향');
    },
    get category() {
      return tr('입력');
    },
    get choices() {
      return [
        ['forward', tr('앞')],
        ['back', tr('뒤')],
        ['left', tr('왼쪽')],
        ['right', tr('오른쪽')],
        ['none', tr('입력 없음')],
      ] as const;
    },
    get hint() {
      return tr(
        '플레이어의 이동키·컨트롤러 스틱 방향을 분기 시작 시 한 번 감지합니다. 전환 대기 중에도 같은 방향을 사용합니다. NPC의 실제 이동이나 HKX 이동 방향을 검사하지 않으며 NPC를 검사하면 NOT에서도 통과하지 않습니다. 대각선은 입력이 큰 축을 사용하고 같으면 앞·뒤를 우선합니다.'
      );
    },
  },
  lying: {
    get label() {
      return tr('누운 방향');
    },
    get category() {
      return tr('상태');
    },
    get choices() {
      return [
        ['back', tr('누움 (등이 바닥)')],
        ['front', tr('엎드림 (배가 바닥)')],
      ] as const;
    },
    get hint() {
      return tr(
        '몸통(COM)·목·왼 위팔 세 뼈로 가슴이 위를 보는지 검사합니다(바닐라 기상 클립을 고르는 뼈와 같음). 래그돌 회복 QTE의 결과처럼 엔진이 몸을 넘겨받는 순간 고르면 엔진이 고른 기상 자세 그대로라 결과가 엔진과 일치합니다. 서 있는 몸은 가슴이 수평이라 누움으로 셉니다.'
      );
    },
  },
  rig: {
    get label() {
      return tr('리그 종류');
    },
    get category() {
      return tr('대상');
    },
    get choices() {
      return [
        ['creature', tr('크리쳐 전체')],
        ...pairedRigs.map(r => [r.id, r.id === 'character' ? tr('인간형') : r.label] as const),
      ] as const;
    },
    get hint() {
      return tr(
        '애니메이션 프로젝트를 기준으로 검사합니다. 미확인 리그는 NOT에서도 통과하지 않습니다. 인간형은 인간용 리그를 사용하는 종족을 포함합니다.'
      );
    },
  },
  race: {
    get label() {
      return tr('종족');
    },
    get category() {
      return tr('대상');
    },
    form: 'RACE',
    get hint() {
      return tr(
        '현재 종족이 지정한 종족과 정확히 일치하는지 검사합니다. 모드 종족도 플러그인과 로컬 ID로 지정할 수 있습니다.'
      );
    },
  },
  actorType: {
    get label() {
      return tr('대상 분류');
    },
    get category() {
      return tr('대상');
    },
    get choices() {
      return [
        ['player', tr('플레이어')],
        ['npc', 'NPC'],
        ['animal', tr('동물')],
        ['creature', tr('크리쳐')],
        ['undead', tr('언데드')],
        ['daedra', tr('데이드라')],
        ['dwarven', tr('드웨머 기계')],
        ['dragon', tr('드래곤')],
      ] as const;
    },
    get hint() {
      return tr(
        '플레이어는 플레이어 캐릭터인지(런타임 0.12.267), 나머지는 ActorType 키워드로 검사합니다. 여러 분류에 동시에 해당할 수 있으며(플레이어도 NPC 분류에 해당), 모션의 리그 호환 여부와는 별개입니다.'
      );
    },
  },
  resource: {
    get label() {
      return tr('자원 비교');
    },
    get category() {
      return tr('수치');
    },
    get choices() {
      return [
        ['health', tr('체력')],
        ['stamina', tr('스태미나')],
        ['magicka', tr('매지카')],
      ] as const;
    },
    numeric: true,
    get hint() {
      return tr(
        '남은 비율은 증가 효과를 포함한 최대 자원 대비 현재 자원입니다. 최대 자원을 확인하지 못하면 검사 불능입니다.'
      );
    },
  },
  essential: {
    get label() {
      return tr('필수 대상');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('Essential 상태를 검사합니다. 킬무브 대상에서 제외하려면 NOT을 체크하세요.');
    },
  },
  protected: {
    get label() {
      return tr('보호 대상');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('Protected 상태를 검사합니다. Essential과는 별도 조건입니다.');
    },
  },
  actorStatus: {
    get label() {
      return tr('현재 상태');
    },
    get category() {
      return tr('상태');
    },
    get choices() {
      return [
        ['ragdoll', tr('래그돌')],
        ['recovering', tr('래그돌 회복 중')],
        ['bleedingOut', tr('빈사')],
        ['killmove', tr('킬무브 중')],
        ['paired', tr('페어 진행 중')],
        ['staggered', tr('스태거')],
        ['child', tr('어린이')],
      ] as const;
    },
    get hint() {
      return tr('현재 상태를 검사합니다. 상태 검사 자체가 동작을 중단하거나 대상을 죽이지는 않습니다.');
    },
  },
  relationship: {
    get label() {
      return tr('대상 관계');
    },
    get category() {
      return tr('관계');
    },
    get choices() {
      return [
        ['hostile', tr('반대편에게 적대적')],
        ['teammate', tr('플레이어 동료')],
      ] as const;
    },
    get hint() {
      return tr('적대 여부는 선택한 검사 대상이 반대편에게 적대적인지 검사합니다. 동료는 플레이어 팀원 여부입니다.');
    },
  },
  faction: {
    get label() {
      return tr('진영 소속');
    },
    get category() {
      return tr('관계');
    },
    form: 'FACT',
    get hint() {
      return tr('지정한 진영에 소속되어 있는지 검사합니다.');
    },
  },
  distance: {
    get label() {
      return tr('대상과의 거리');
    },
    get category() {
      return tr('공간');
    },
    numeric: true,
    get hint() {
      return tr('본인과 상대의 기준 위치 사이 3차원 거리입니다. 서로 다른 셀에 있거나 상대가 없으면 검사 불능입니다.');
    },
  },
  relativeAngle: {
    get label() {
      return tr('상대 각도');
    },
    get category() {
      return tr('공간');
    },
    numeric: true,
    get hint() {
      return tr(
        '검사 대상이 바라보는 방향에서 반대편까지의 수평 각도입니다. 정면 0°, 측면 90°, 후면 180°. 상대 뒤에서 사용하려면 검사 대상을 상대로 지정하세요.'
      );
    },
  },
  heightDifference: {
    get label() {
      return tr('대상과의 높이 차이');
    },
    get category() {
      return tr('공간');
    },
    numeric: true,
    get hint() {
      return tr('본인과 상대 기준 위치의 높이 차이 절댓값입니다. 바닥 탐색이나 본 위치 검사는 아닙니다.');
    },
  },
  blocking: {
    get label() {
      return tr('방어 중');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('현재 방어 상태인지 검사합니다.');
    },
  },
  sprinting: {
    get label() {
      return tr('질주 중');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('현재 질주 상태인지 검사합니다.');
    },
  },
  swimming: {
    get label() {
      return tr('수영 중');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('현재 수영 상태인지 검사합니다.');
    },
  },
  mounted: {
    get label() {
      return tr('탑승 중');
    },
    get category() {
      return tr('상태');
    },
    get hint() {
      return tr('현재 탈것에 탑승했는지 검사합니다.');
    },
  },
  lineOfSight: {
    get label() {
      return tr('시야 확보');
    },
    get category() {
      return tr('공간');
    },
    get hint() {
      return tr(
        '검사 대상에서 반대편이 보이는지 엔진 시야 검사로 확인합니다. 공간 확보 조건과 함께 사용할 수 있습니다.'
      );
    },
  },
  scale: {
    get label() {
      return tr('크기 배율');
    },
    get category() {
      return tr('수치');
    },
    numeric: true,
    get hint() {
      return tr(
        '액터 배율을 검사합니다. 기본 배율은 1입니다. 서로 다른 종족의 실제 키를 비교하려면 키 비율을 사용하세요.'
      );
    },
  },
  height: {
    get label() {
      return tr('신체 높이');
    },
    get category() {
      return tr('수치');
    },
    numeric: true,
    get hint() {
      return tr('엔진에서 조회한 액터 높이를 게임 단위로 비교합니다. 현재 포즈의 본 위치가 아닙니다.');
    },
  },
  scaleRatio: {
    get label() {
      return tr('상대 대비 키 비율');
    },
    get category() {
      return tr('수치');
    },
    numeric: true,
    get hint() {
      return tr(
        '검사 대상의 높이 ÷ 반대편 높이입니다. 검사 대상을 상대로 지정하면 본인 대비 상대의 크기를 비교합니다. 같은 높이는 1입니다.'
      );
    },
  },
  equippedKeyword: {
    get label() {
      return tr('장비 키워드');
    },
    get category() {
      return tr('장비·능력');
    },
    form: 'KYWD',
    get choices() {
      return [
        ['left', tr('왼손')],
        ['right', tr('오른손')],
        ['either', tr('어느 손이든')],
      ] as const;
    },
    get hint() {
      return tr('선택한 손에 장착한 무기·주문 등의 키워드를 검사합니다.');
    },
  },
  wornKeyword: {
    get label() {
      return tr('착용 키워드');
    },
    get category() {
      return tr('장비·능력');
    },
    form: 'KYWD',
    get hint() {
      return tr('현재 착용한 아이템의 키워드를 검사합니다. 인벤토리에만 있는 아이템은 제외합니다.');
    },
  },
  keyword: {
    get label() {
      return tr('키워드 보유');
    },
    get category() {
      return tr('대상');
    },
    form: 'KYWD',
    get hint() {
      return tr('검사 대상의 키워드를 검사합니다.');
    },
  },
  perk: {
    get label() {
      return tr('특성 보유');
    },
    get category() {
      return tr('장비·능력');
    },
    form: 'PERK',
    get hint() {
      return tr('지정한 퍽을 보유했는지 검사합니다.');
    },
  },
  spell: {
    get label() {
      return tr('주문 보유');
    },
    get category() {
      return tr('장비·능력');
    },
    form: 'SPEL',
    get hint() {
      return tr('지정한 주문을 배웠는지 검사합니다. 현재 적용 중인 효과는 마법 효과 보유를 사용하세요.');
    },
  },
  chance: {
    get label() {
      return tr('확률');
    },
    get category() {
      return tr('기타');
    },
    get hint() {
      return tr(
        '설정한 확률이면 통과, 아니면 실패합니다. 같은 실행 요청에서 전환을 기다리며 재검사할 때는 추첨 결과를 유지합니다.'
      );
    },
  },
  interior: {
    get label() {
      return tr('실내');
    },
    get category() {
      return tr('환경');
    },
    get hint() {
      return tr('검사 대상이 있는 셀이 실내인지 검사합니다. 실외 조건은 NOT으로 설정하세요.');
    },
  },
  location: {
    get label() {
      return tr('지역');
    },
    get category() {
      return tr('환경');
    },
    form: 'LCTN',
    get hint() {
      return tr('현재 지역이 지정한 Location과 정확히 일치하는지 검사합니다. 상위 지역은 자동으로 포함하지 않습니다.');
    },
  },
} satisfies Record<string, Definition>;
export type ExtensionKind = keyof typeof extensionConditions;
export type Comparison = 'lt' | 'le' | 'eq' | 'ge' | 'gt' | 'range';
export const comparisons = (): readonly (readonly [Comparison, string])[] => [
  ['lt', tr('미만')],
  ['le', tr('이하')],
  ['eq', tr('같음')],
  ['ge', tr('이상')],
  ['gt', tr('초과')],
  ['range', tr('범위')],
];
export const extensionKinds = Object.keys(extensionConditions) as ExtensionKind[];
export const formKinds = ['magicEffect', 'global', ...extensionKinds.filter(k => 'form' in extensionConditions[k])];
export const definition = (kind: string): Definition | undefined =>
  (extensionConditions as Record<string, Definition>)[kind];
export function extensionDefaults(kind: string): Partial<BranchTest> {
  const d = definition(kind);
  if (!d) return {};
  return {
    ...(d.choices ? {option: d.choices[0][0]} : {}),
    ...(d.numeric
      ? {
          compare: 'le',
          value:
            kind === 'resource'
              ? 20
              : kind === 'relativeAngle'
                ? 45
                : kind === 'scale' || kind === 'scaleRatio'
                  ? 1
                  : 150,
          upper: kind === 'relativeAngle' ? 180 : 200,
        }
      : {}),
    ...(kind === 'resource' ? {measure: 'percent'} : {}),
    ...(kind === 'chance' ? {value: 30} : {}),
    ...(d.form ? {form: {plugin: '', id: ''}} : {}),
  };
}
export function extensionMaximum(t: BranchTest) {
  return t.kind === 'chance' || (t.kind === 'resource' && t.measure === 'percent')
    ? 100
    : t.kind === 'relativeAngle'
      ? 180
      : 1000000;
}
export function extensionError(t: BranchTest): string | undefined {
  const d = definition(t.kind);
  if (!d) return;
  if (d.choices && !d.choices.some(([v]) => v === t.option)) return tr('조건의 검사 항목을 선택하세요.');
  if (t.kind === 'resource' && !['current', 'percent'].includes(t.measure ?? ''))
    return tr('자원 비교 기준을 선택하세요.');
  if (d.numeric || t.kind === 'chance') {
    if (!Number.isFinite(t.value) || t.value! < 0 || t.value! > extensionMaximum(t))
      return tr('비교 값의 범위를 확인하세요.');
    if (d.numeric && !comparisons().some(([v]) => v === t.compare)) return tr('비교 방식을 선택하세요.');
    if (
      t.compare === 'range' &&
      d.numeric &&
      (!Number.isFinite(t.upper) || t.upper! < t.value! || t.upper! > extensionMaximum(t))
    )
      return tr('범위의 끝 값은 시작 값 이상이어야 합니다.');
  }
}
export function extensionAttrs(t: BranchTest): Record<string, string> {
  const d = definition(t.kind);
  if (!d) return {};
  return {
    ...(d.choices ? {option: t.option!} : {}),
    ...(d.numeric ? {compare: t.compare!} : {}),
    ...(d.numeric || t.kind === 'chance' ? {value: String(t.value)} : {}),
    ...(d.numeric && t.compare === 'range' ? {upper: String(t.upper)} : {}),
    ...(t.kind === 'resource' ? {measure: t.measure!} : {}),
  };
}
export function readExtension(kind: string, attrs: Record<string, string>): Partial<BranchTest> {
  const d = definition(kind),
    allowed = Object.keys(extensionAttrs({kind, compare: attrs.compare} as BranchTest));
  for (const key of ['option', 'compare', 'measure', 'value', 'upper'])
    if (attrs[key] !== undefined && !allowed.includes(key)) throw Error(tr('이 조건에서 사용할 수 없는 속성: ') + key);
  if (!d) return {};
  for (const key of allowed) if (!attrs[key]?.trim()) throw Error(tr('조건 설정 누락: ') + key);
  const numeric = (key: string) => {
    const value = attrs[key];
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw Error(tr('잘못된 조건 수치: ') + key);
    return Number(value);
  };
  const value: Partial<BranchTest> = {
    ...(d.choices ? {option: attrs.option} : {}),
    ...(d.numeric ? {compare: attrs.compare as Comparison} : {}),
    ...(d.numeric || kind === 'chance' ? {value: numeric('value')} : {}),
    ...(d.numeric && attrs.compare === 'range' ? {upper: numeric('upper')} : {}),
    ...(kind === 'resource' ? {measure: attrs.measure as 'current' | 'percent'} : {}),
  };
  const error = extensionError({kind, ...value} as BranchTest);
  if (error) throw Error(error);
  return value;
}
export function extensionSummary(t: BranchTest): string | undefined {
  const d = definition(t.kind);
  if (!d) return;
  const option = d.choices?.find(([v]) => v === t.option)?.[1],
    unit =
      t.kind === 'chance' || (t.kind === 'resource' && t.measure === 'percent')
        ? '%'
        : t.kind === 'relativeAngle'
          ? '°'
          : '';
  const value =
    t.compare === 'range'
      ? `${t.value}~${t.upper}${unit}`
      : `${t.value}${unit} ${comparisons().find(([v]) => v === t.compare)?.[1] ?? ''}`;
  return [
    t.subject === 'partner' ? tr('상대') : tr('본인'),
    d.label,
    option,
    d.form ? `${t.form?.plugin ?? ''} : ${t.form?.id ?? ''}` : undefined,
    d.numeric ? value : t.kind === 'chance' ? `${t.value}%` : undefined,
  ]
    .filter(Boolean)
    .join(' / ');
}
