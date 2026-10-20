import {ConditionExpressionEditor} from './ConditionExpressionEditor.tsx';
import {ExtendedConditionFields} from './ExtendedConditionFields.tsx';
import {ConditionKindPicker} from './ConditionKindPicker.tsx';
import {extensionKinds, definition, extensionDefaults, formKinds} from './conditionExtensions.ts';
import {equippedTypes, attackStates} from '../runtimeExtensions.ts';
import {t} from '../i18n/index.ts';
import {useState} from 'react';
import {setConditionOperands} from './conditionCommands.ts';
import type {Workspace} from '../workspace.ts';
import type {BranchTest} from './conditions.ts';
import {DetailPanel, DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
export function ConditionFields({
  w,
  id,
  edit,
  embedded = false,
}: {
  w: Workspace;
  id: string;
  embedded?: boolean;
  edit: (f: (w: Workspace) => Workspace) => void;
}) {
  const [error, setError] = useState('');
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const [, owner, key] = id.split(':'),
    a = w.actions.find(a => a.uid === owner),
    test = a?.flow?.tests.find(t => t.id === key);
  if (!test) return null;
  const change = (patch: Partial<BranchTest>) =>
    edit(w => {
      const n = structuredClone(w);
      Object.assign(
        n.actions.find(a => a.uid === owner)!.flow!.tests.find(t => t.id === key)!,
        patch
      );
      return n;
    });
  return (
    <DetailPanel>
      {!embedded && <h3>{tr('조건 분기')}</h3>}
      {error && <p role="alert">{error}</p>}
      <DetailRow label={tr('검사 항목')} hint={definition(test.kind)?.hint}>
        <ConditionKindPicker
          value={test.kind}
          withGroups={!embedded}
          onChange={kind =>
            change({
              kind: kind as BranchTest['kind'],
              ...extensionDefaults(kind),
              ...(kind === 'equippedType'
                ? {hand: test.hand ?? 'left', equipmentType: test.equipmentType ?? 'bow'}
                : {}),
              ...(kind === 'attackState' ? {attackState: test.attackState ?? 'bowDrawn'} : {}),
              ...(kind === 'global' ? {subject: 'self', equals: test.equals ?? 1} : {}),
              ...(['space', 'ground'].includes(kind) && !test.space
                ? {
                    space: {
                      candidate: a?.pair ? owner : '',
                      distance: kind === 'ground' ? 0 : 200,
                      direction: 'partnerForward',
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
            <select
              value={test.equipmentType ?? 'bow'}
              onChange={e => change({equipmentType: e.target.value as BranchTest['equipmentType']})}
            >
              {equippedTypes.map(k => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </DetailRow>
        </>
      )}
      {test.kind === 'attackState' && (
        <DetailRow label={t('ext.state')}>
          <select
            value={test.attackState ?? 'none'}
            onChange={e => change({attackState: e.target.value as BranchTest['attackState']})}
          >
            {attackStates.map(k => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {!embedded && ['all', 'any'].includes(test.kind) && (
        <DetailRow
          label={tr('구성 조건')}
          hint={tr('구성 조건은 통과·실패 연결 없이 사용합니다. 검사 불능은 NOT에서도 통과로 바뀌지 않습니다.')}
        >
          <div>
            {a!
              .flow!.tests.filter(t => t.id !== key)
              .map(t => (
                <label key={t.id} style={{display: 'block'}}>
                  <input
                    type="checkbox"
                    checked={test.operands?.includes(t.id) ?? false}
                    onChange={e =>
                      attempt(() =>
                        edit(w =>
                          setConditionOperands(
                            w,
                            owner,
                            key,
                            e.target.checked
                              ? [...(test.operands ?? []), t.id]
                              : (test.operands ?? []).filter(x => x !== t.id)
                          )
                        )
                      )
                    }
                  />
                  {t.id}
                </label>
              ))}
            <button
              onClick={() =>
                edit(w => {
                  const n = structuredClone(w),
                    f = n.actions.find(a => a.uid === owner)!.flow!;
                  let serial = 1;
                  while (f.tests.some(t => t.id === 'Condition' + serial)) serial++;
                  const id = 'Condition' + serial;
                  f.tests.push({id, kind: 'alive', subject: 'self', minimum: 0});
                  const group = f.tests.find(t => t.id === key)!;
                  group.operands = [...(group.operands ?? []), id];
                  return n;
                })
              }
            >
              {tr('구성 조건 추가')}
            </button>
          </div>
        </DetailRow>
      )}
      {!['all', 'any', 'global'].includes(test.kind) && (
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
      {formKinds.includes(test.kind) && (
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
          <input
            type="number"
            step="any"
            value={test.equals ?? 1}
            onChange={e => change({equals: Number(e.target.value)})}
          />
        </DetailRow>
      )}
      {['stamina', 'magicka'].includes(test.kind) && (
        <DetailRow label={tr('최솟값')}>
          <input
            type="number"
            min="0"
            max="1000000"
            value={test.minimum}
            onChange={e => change({minimum: Number(e.target.value)})}
          />
        </DetailRow>
      )}
      {(test.kind === 'space' || test.kind === 'ground') && (
        <>
          <DetailRow
            label={tr('검사할 동작')}
            hint={
              test.kind === 'ground'
                ? tr(
                    '예상 배치 높이를 기준으로 25단위 이하 간격마다 중심과 주변 4점을 검사합니다. 작은 틈을 모두 감지하거나 착지를 보장하지는 않습니다. 동적 물체 등 불명확한 결과는 실패로 보냅니다.'
                  )
                : tr(
                    '이 페어의 예상 시작 위치에서 정적 장애물을 검사합니다. 지면은 지면 확보 조건으로 따로 연결하세요.'
                  )
            }
          >
            <select
              value={test.space?.candidate ?? ''}
              onChange={e =>
                change({space: {distance: 200, direction: 'partnerForward', ...test.space, candidate: e.target.value}})
              }
            >
              <option value="">{tr('페어 HKX 선택')}</option>
              {w.actions
                .filter(x => x.pair && x.config.kind === 'single')
                .map(x => (
                  <option key={x.uid} value={x.uid}>
                    {x.config.actionId}
                  </option>
                ))}
            </select>
          </DetailRow>
          <DetailRow
            label={tr('방향')}
            hint={tr(
              '배치 전 상대의 방향을 기준으로 합니다. 본인/상대 선택은 검사 시작 위치를 지정하며 방향 기준은 같습니다.'
            )}
          >
            <select
              value={test.space?.direction ?? 'partnerForward'}
              onChange={e =>
                change({
                  space: {
                    candidate: '',
                    distance: 200,
                    ...test.space,
                    direction: e.target.value as NonNullable<BranchTest['space']>['direction'],
                  },
                })
              }
            >
              {(['partnerForward', 'partnerBack', 'partnerLeft', 'partnerRight'] as const).map((d, i) => (
                <option key={d} value={d}>
                  {[tr('상대 기준 앞'), tr('상대 기준 뒤'), tr('상대 기준 왼쪽'), tr('상대 기준 오른쪽')][i]}
                </option>
              ))}
            </select>
          </DetailRow>
          <DetailRow
            label={tr('거리')}
            hint={tr('게임 거리 단위입니다. 지면 검사에서 0은 시작 위치 주변만 검사합니다.')}
          >
            <input
              type="number"
              min={test.kind === 'ground' ? 0 : 1}
              max="2000"
              value={test.space?.distance ?? 200}
              onChange={e =>
                change({
                  space: {candidate: '', direction: 'partnerForward', ...test.space, distance: Number(e.target.value)},
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
              hint={tr('높이는 후보의 예상 배치 높이 기준입니다. 거리·반경은 게임 단위, 경사는 도 단위입니다.')}
            >
              <input
                type="number"
                min={key === 'radius' ? 1 : 0}
                max={[200, 500, 80, 100][i]}
                value={g[key]}
                onChange={e => change({ground: {...g, [key]: Number(e.target.value)}})}
              />
            </DetailRow>
          );
        })}
      {!embedded && (
        <>
          <button
            disabled={a!.flow!.entry === key}
            onClick={() =>
              edit(w => {
                const n = structuredClone(w),
                  f = n.actions.find(a => a.uid === owner)!.flow!;
                f.entry = key;
                delete f.detached;
                return n;
              })
            }
          >
            {tr('진입 조건으로 지정')}
          </button>
          {/* Pass and fail routes: the "연결" section above (graph/pinTargets.ts). */}
        </>
      )}
    </DetailPanel>
  );
}

export function ConditionDetails(props: {w: Workspace; id: string; edit: (f: (w: Workspace) => Workspace) => void}) {
  return <ConditionExpressionEditor {...props} />;
}
