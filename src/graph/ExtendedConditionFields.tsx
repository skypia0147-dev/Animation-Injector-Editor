import type {BranchTest} from './conditions.ts';
import {comparisons, definition, extensionMaximum} from './conditionExtensions.ts';
import {DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
export function ExtendedConditionFields({
  test,
  change,
}: {
  test: BranchTest;
  change: (patch: Partial<BranchTest>) => void;
}) {
  const d = definition(test.kind);
  if (!d) return null;
  // A fall's distance is asked only when switched on (runtime 0.12.296).
  const compared = d.numeric || (d.optionalNumeric && test.compare !== undefined);
  return (
    <>
      {d.choices && (
        <DetailRow
          label={
            test.kind === 'resource' ? tr('자원') : test.kind === 'equippedKeyword' ? tr('검사할 손') : tr('검사 값')
          }
          hint={d.hint}
        >
          <select value={test.option ?? ''} onChange={e => change({option: e.target.value})}>
            {d.choices.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {test.kind === 'resource' && (
        <DetailRow label={tr('비교 기준')} hint={d.hint}>
          <select
            value={test.measure ?? 'percent'}
            onChange={e =>
              change({
                measure: e.target.value as 'current' | 'percent',
                ...(e.target.value === 'percent'
                  ? {value: Math.min(100, test.value ?? 20), upper: Math.min(100, test.upper ?? 100)}
                  : {}),
              })
            }
          >
            <option value="current">{tr('현재 수치')}</option>
            <option value="percent">{tr('남은 비율 (%)')}</option>
          </select>
        </DetailRow>
      )}
      {d.optionalNumeric && (
        <DetailRow label={tr('낙하 거리')} hint={d.hint}>
          <label>
            <input
              type="checkbox"
              checked={test.compare !== undefined}
              onChange={e =>
                change(
                  e.target.checked
                    ? {compare: 'ge', value: test.value ?? 200}
                    : {compare: undefined, value: undefined, upper: undefined}
                )
              }
            />
            {tr('떨어진 거리도 비교')}
          </label>
        </DetailRow>
      )}
      {test.kind === 'actorValue' && (
        <DetailRow label={tr('비교 기준')} hint={d.hint}>
          <select
            value={test.measure ?? 'current'}
            onChange={e => change({measure: e.target.value as 'current' | 'base'})}
          >
            <option value="current">{tr('현재 값')}</option>
            <option value="base">{tr('기본 값')}</option>
          </select>
        </DetailRow>
      )}
      {compared && (
        <DetailRow label={tr('비교')} hint={d.hint}>
          <select
            value={test.compare ?? 'le'}
            onChange={e =>
              change({
                compare: e.target.value as BranchTest['compare'],
                ...(e.target.value === 'range'
                  ? {upper: Math.max(test.value ?? 0, Math.min(extensionMaximum(test), test.upper ?? 100))}
                  : {}),
              })
            }
          >
            {comparisons().map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {(compared || test.kind === 'chance') && (
        <DetailRow
          label={
            test.kind === 'chance'
              ? tr('통과 확률 (%)')
              : test.kind === 'resource' && test.measure === 'percent'
                ? tr('값 (%)')
                : test.kind === 'relativeAngle' || test.kind === 'slope'
                  ? tr('각도 (°)')
                  : test.kind === 'gameHour'
                    ? tr('시각 (시)')
                    : test.kind === 'falling'
                      ? tr('거리')
                      : tr('값')
          }
          hint={d.hint}
        >
          <input
            type="number"
            min="0"
            max={extensionMaximum(test)}
            step="any"
            value={test.value ?? 0}
            onChange={e => change({value: Number(e.target.value)})}
          />
        </DetailRow>
      )}
      {compared && test.compare === 'range' && (
        <DetailRow label={tr('끝 값')}>
          <input
            type="number"
            min={test.kind === 'gameHour' ? 0 : (test.value ?? 0)}
            max={extensionMaximum(test)}
            step="any"
            value={test.upper ?? test.value ?? 0}
            onChange={e => change({upper: Number(e.target.value)})}
          />
        </DetailRow>
      )}
    </>
  );
}
