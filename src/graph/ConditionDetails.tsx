import {ExtendedConditionFields} from './ExtendedConditionFields.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {ConditionKindPicker} from './ConditionKindPicker.tsx';
import {useId} from 'react';
import {
  byKeywordName,
  definition,
  extensionDefaults,
  formKinds,
  keywordKinds,
  subjectlessKinds,
} from './conditionExtensions.ts';
import {vanillaKeywords} from '../vanillaKeywords.ts';
import {equippedTypes, attackStates} from '../runtimeExtensions.ts';
import {MultiValuePicker} from './MultiValuePicker.tsx';
import {equippedTypeLabels} from './multiValue.ts';
import {t} from '../i18n/index.ts';
import {patchTest} from './conditionExpression.ts';
import type {Workspace} from '../workspace.ts';
import type {BranchTest} from './conditions.ts';
import {selfDirections} from './conditions.ts';
import {DetailPanel, DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
/** The last action the subject finished (runtime 0.12.296): which of this project's actions, how long ago, and
 *  whether it played to its end. */
function PreviousActionFields({
  w,
  test,
  change,
}: {
  w: Workspace;
  test: BranchTest;
  change: (patch: Partial<BranchTest>) => void;
}) {
  const chosen = new Set(test.actions ?? []);
  return (
    <>
      <DetailRow label={tr('동작')} hint={definition('previousAction')?.hint}>
        <span className="previous-actions">
          {w.actions.map(a => (
            <label key={a.uid}>
              <input
                type="checkbox"
                checked={chosen.has(a.uid)}
                onChange={e => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(a.uid);
                  else next.delete(a.uid);
                  change({actions: w.actions.map(x => x.uid).filter(uid => next.has(uid))});
                }}
              />
              {a.config.name || a.config.actionId}
            </label>
          ))}
        </span>
      </DetailRow>
      <DetailRow label={tr('끝난 지')} hint={tr('비워 두면 시간과 상관없이 마지막으로 끝낸 동작만 봅니다.')}>
        <span className="strike-inline">
          <input
            type="number"
            className="strike-number"
            min="0"
            max="600"
            step="0.1"
            placeholder={tr('제한 없음')}
            value={test.within ?? ''}
            onChange={e => change({within: e.target.value === '' ? undefined : Number(e.target.value)})}
          />
          {tr('초 이내')}
        </span>
      </DetailRow>
      <DetailRow label={tr('끝난 방식')}>
        <select value={test.ended ?? 'any'} onChange={e => change({ended: e.target.value as BranchTest['ended']})}>
          <option value="any">{tr('상관없음')}</option>
          <option value="completed">{tr('끝까지 재생')}</option>
          <option value="cancelled">{tr('중간에 끝남')}</option>
        </select>
      </DetailRow>
    </>
  );
}
/** One condition of a condition card (`owner`: the card's uid, `id`: the condition's). */
export function ConditionFields({
  w,
  owner,
  id: key,
  edit,
  embedded = false,
}: {
  w: Workspace;
  owner: string;
  id: string;
  embedded?: boolean;
  edit: (f: (w: Workspace) => Workspace) => void;
}) {
  const card = w.cards.find(c => c.uid === owner),
    test = card?.tests.find(t => t.id === key);
  const keywordList = useId();
  if (!card || !test) return null;
  const change = (patch: Partial<BranchTest>) => edit(w => patchTest(w, owner, key, patch));
  return (
    <DetailPanel>
      {!embedded && <h3>{tr('조건 분기')}</h3>}
      <DetailRow label={tr('검사 항목')} hint={definition(test.kind)?.hint}>
        <ConditionKindPicker
          value={test.kind}
          withGroups={!embedded}
          onChange={kind =>
            change({
              kind: kind as BranchTest['kind'],
              ...extensionDefaults(kind),
              // A keyword name left from the previous kind must not stay behind, hidden.
              ...(keywordKinds.includes(kind) ? {} : {keyword: undefined}),
              ...(kind === 'equippedType'
                ? {hand: test.hand ?? 'left', equipmentType: test.equipmentType ?? 'bow'}
                : {}),
              ...(kind === 'attackState' ? {attackState: test.attackState ?? 'bowDrawn'} : {}),
              ...(kind === 'global' ? {equals: test.equals ?? 1} : {}),
              // No target field: a target left from the previous kind must not stay behind, hidden.
              ...(subjectlessKinds.includes(kind) ? {subject: 'self' as const} : {}),
              ...(['space', 'ground'].includes(kind) && !test.space
                ? {
                    space: {
                      distance: kind === 'ground' ? 0 : 200,
                      direction: 'selfForward' as const,
                    },
                  }
                : {}),
            })
          }
        />
      </DetailRow>
      <ExtendedConditionFields test={test} change={change} />
      {!embedded && (
        <DetailRow
          label={tr('NOT (결과 반전)')}
          hint={tr(
            '체크하면 이 조건의 참·거짓 결과를 반전합니다. 대상이나 데이터를 확인할 수 없는 검사 불능은 반전하지 않고 실패로 처리합니다.'
          )}
        >
          <input type="checkbox" checked={test.negate ?? false} onChange={e => change({negate: e.target.checked})} />
        </DetailRow>
      )}
      {test.kind === 'equippedType' && (
        <>
          <DetailRow label={t('ext.hand')}>
            <select value={test.hand ?? 'left'} onChange={e => change({hand: e.target.value as 'left' | 'right'})}>
              {(['left', 'right'] as const).map(k => (
                <option key={k} value={k}>
                  {t('ext.' + k)}
                </option>
              ))}
            </select>
          </DetailRow>
          <DetailRow label={t('ext.equipmentType')}>
            <MultiValuePicker
              value={test.equipmentType ?? 'bow'}
              choices={equippedTypes.map(k => [k, equippedTypeLabels()[k]] as const)}
              change={equipmentType => change({equipmentType})}
              label={t('ext.equipmentType')}
            />
          </DetailRow>
        </>
      )}
      {test.kind === 'attackState' && (
        <DetailRow label={t('ext.state')}>
          <MultiValuePicker
            value={test.attackState ?? 'none'}
            choices={attackStates.map(k => [k, k] as const)}
            change={attackState => change({attackState})}
            label={t('ext.state')}
          />
        </DetailRow>
      )}
      {test.kind === 'previousAction' && <PreviousActionFields w={w} test={test} change={change} />}
      {test.kind === 'hitReceived' && (
        <DetailRow label={tr('맞은 지')} hint={tr('비워 두면 시간과 상관없이 마지막으로 맞은 공격만 봅니다.')}>
          <span className="strike-inline">
            <input
              type="number"
              className="strike-number"
              min="0"
              max="600"
              step="0.1"
              placeholder={tr('제한 없음')}
              value={test.within ?? ''}
              onChange={e => change({within: e.target.value === '' ? undefined : Number(e.target.value)})}
            />
            {tr('초 이내')}
          </span>
        </DetailRow>
      )}
      {!['all', 'any'].includes(test.kind) && !subjectlessKinds.includes(test.kind) && (
        <DetailRow
          label={tr('검사 대상')}
          hint={tr(
            '상대는 현재 페어 상대 또는 실행 요청에서 확정한 대상입니다. 페어 시작 전에는 연결된 재생 후보의 대상 범위에서 선택하고, 일반 동작은 전투 대상을 사용합니다. 상대가 없으면 검사 불능으로 실패 경로를 따릅니다.'
          )}
        >
          <select value={test.subject} onChange={e => change({subject: e.target.value as BranchTest['subject']})}>
            <option value="self">{tr('본인')}</option>
            <option value="partner">{tr('상대')}</option>
          </select>
        </DetailRow>
      )}
      {keywordKinds.includes(test.kind) && (
        <DetailRow
          label={tr('지정 방식')}
          hint={tr(
            '키워드는 이름(Editor ID)만으로 찾습니다. 두 플러그인이 같은 이름을 쓰면 나중에 로드된 쪽입니다. 그럴 때만 Form ID로 지정하세요.'
          )}
        >
          <select
            value={byKeywordName(test) ? 'name' : 'form'}
            onChange={e =>
              change(
                e.target.value === 'name'
                  ? {keyword: ''}
                  : {keyword: undefined, form: test.form ?? {plugin: '', id: ''}}
              )
            }
          >
            <option value="name">{tr('키워드 이름')}</option>
            <option value="form">Form ID</option>
          </select>
        </DetailRow>
      )}
      {byKeywordName(test) && (
        <>
          <DetailRow
            label={tr('키워드 이름')}
            hint={tr(
              '키워드의 Editor ID입니다. 예: WeapTypeSword. 대소문자는 가리지 않습니다. 목록은 바닐라 키워드이고, 다른 모드의 키워드는 직접 입력하세요. 없는 이름이면 검사 불능입니다.'
            )}
          >
            <input list={keywordList} value={test.keyword} onChange={e => change({keyword: e.target.value.trim()})} />
          </DetailRow>
          <datalist id={keywordList}>
            {vanillaKeywords.map(name => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      )}
      {formKinds.includes(test.kind) && !byKeywordName(test) && (
        <>
          <DetailRow
            label={tr('플러그인')}
            hint={tr('예: FH_Grapple.esp. 설치되지 않았거나 폼 종류가 다르면 검사 불능입니다.')}
          >
            <input
              value={test.form?.plugin ?? ''}
              onChange={e => change({form: {id: '', ...test.form, plugin: e.target.value}})}
            />
          </DetailRow>
          <DetailRow
            label="Form ID"
            hint={
              definition(test.kind)?.form
                ? definition(test.kind)!.hint +
                  ' ' +
                  definition(test.kind)!.form +
                  tr(' 폼의 로컬 16진수 ID입니다. 로드 순서 접두사는 제외하세요.')
                : test.kind === 'magicEffect'
                  ? tr(
                      '마법 효과(MGEF)의 로컬 16진수 ID입니다. 예: 82C. 스펠(SPEL) ID나 로드 순서 접두사는 넣지 마세요.'
                    )
                  : tr('전역 변수(GLOB)의 로컬 16진수 ID입니다. 예: 803. 로드 순서 접두사는 넣지 마세요.')
            }
          >
            <input
              value={test.form?.id ?? ''}
              onChange={e => change({form: {plugin: '', ...test.form, id: e.target.value}})}
            />
          </DetailRow>
        </>
      )}
      {test.kind === 'global' && (
        <DetailRow label={tr('일치 값')} hint={tr('전역 변수의 값이 정확히 일치할 때 통과합니다.')}>
          <NumberInput step="any" value={test.equals ?? 1} change={v => change({equals: v})} />
        </DetailRow>
      )}
      {(test.kind === 'space' || test.kind === 'ground') && (
        <>
          {/* Measured where the actor stands, for no particular action (mockup ⑩, runtime 0.12.299). */}
          <DetailRow
            label={tr('방향')}
            hint={
              tr('지금 서 있는 자리에서 지금 바라보는 방향으로 잽니다. 본인과 시작의 대상은 장애물로 보지 않습니다.') +
              (test.kind === 'ground'
                ? ' ' +
                  tr(
                    '지금 발 높이를 기준으로 25단위 이하 간격마다 중심과 주변 4점을 검사합니다. 작은 틈을 모두 감지하거나 착지를 보장하지는 않습니다. 동적 물체 등 불명확한 결과는 실패로 보냅니다.'
                  )
                : '')
            }
          >
            <select
              value={test.space?.direction ?? 'selfForward'}
              onChange={e =>
                change({
                  subject: 'self',
                  space: {
                    distance: 200,
                    ...test.space,
                    direction: e.target.value as NonNullable<BranchTest['space']>['direction'],
                  },
                })
              }
            >
              {selfDirections.map((d, i) => (
                <option key={d} value={d}>
                  {[tr('앞'), tr('뒤'), tr('왼쪽'), tr('오른쪽')][i]}
                </option>
              ))}
            </select>
          </DetailRow>
          <DetailRow
            label={tr('거리')}
            hint={tr('게임 거리 단위입니다. 지면 검사에서 0은 시작 위치 주변만 검사합니다.')}
          >
            <NumberInput
              min={test.kind === 'ground' ? 0 : 1}
              max="2000"
              value={test.space?.distance ?? 200}
              change={v =>
                change({
                  space: {direction: 'selfForward', ...test.space, distance: v},
                })
              }
            />
          </DetailRow>
        </>
      )}
      {test.kind === 'ground' &&
        (['maxRise', 'maxDrop', 'maxSlope', 'radius'] as const).map((key, i) => {
          const g = test.ground ?? {maxRise: 20, maxDrop: 40, maxSlope: 45, radius: 20};
          return (
            <DetailRow
              key={key}
              label={[tr('허용 위쪽 높이'), tr('허용 아래쪽 높이'), tr('최대 경사각'), tr('검사 반경')][i]}
              hint={tr('높이는 지금 발 높이 기준입니다. 거리·반경은 게임 단위, 경사는 도 단위입니다.')}
            >
              <NumberInput
                min={key === 'radius' ? 1 : 0}
                max={[200, 500, 80, 100][i]}
                value={g[key]}
                change={v => change({ground: {...g, [key]: v}})}
              />
            </DetailRow>
          );
        })}
    </DetailPanel>
  );
}
