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
      {d.numeric && (
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
      {(d.numeric || test.kind === 'chance') && (
        <DetailRow
          label={
            test.kind === 'chance'
              ? tr('통과 확률 (%)')
              : test.kind === 'resource' && test.measure === 'percent'
                ? tr('값 (%)')
                : test.kind === 'relativeAngle'
                  ? tr('각도 (°)')
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
      {d.numeric && test.compare === 'range' && (
        <DetailRow label={tr('끝 값')}>
          <input
            type="number"
            min={test.value ?? 0}
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
