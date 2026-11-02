import type {BranchTest} from './conditions.ts';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {comparisons, definition, extensionMaximum} from './conditionExtensions.ts';
import {DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
import {multiValueField} from './multiValue.ts';
import {MultiValuePicker} from './MultiValuePicker.tsx';
import {Unchosen} from '../ui/details/Unchosen.tsx';
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
  // On while it holds a comparison or a distance (11-02: switched on, the way to compare is still to choose).
  const fall = test.compare !== undefined || test.value !== undefined;
  const compared = d.numeric || (d.optionalNumeric && fall);
  return (
    <>
      {d.choices && (
        <DetailRow
          label={
            test.kind === 'resource' ? tr('자원') : test.kind === 'equippedKeyword' ? tr('검사할 손') : tr('검사 값')
          }
          hint={d.hint}
        >
          {multiValueField[test.kind] === 'option' ? (
            <MultiValuePicker
              value={test.option}
              choices={d.choices}
              change={option => change({option})}
              label={tr('검사 값')}
            />
          ) : (
            <select
              value={test.option ?? ''}
              onChange={e =>
                // In the air at all has no fall distance.
                change(
                  test.kind === 'air' && e.target.value === 'any'
                    ? {option: e.target.value, compare: undefined, value: undefined, upper: undefined}
                    : {option: e.target.value}
                )
              }
            >
              <Unchosen />
              {d.choices.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </DetailRow>
      )}
      {test.kind === 'resource' && (
        <DetailRow label={tr('비교 기준')} hint={d.hint}>
          <select
            value={test.measure ?? ''}
            onChange={e =>
              change({
                measure: e.target.value as 'current' | 'percent',
                // A percentage stops at 100: what is entered already is brought within it, nothing is filled in.
                ...(e.target.value === 'percent'
                  ? {
                      value: test.value === undefined ? undefined : Math.min(100, test.value),
                      upper: test.upper === undefined ? undefined : Math.min(100, test.upper),
                    }
                  : {}),
              })
            }
          >
            <Unchosen />
            <option value="current">{tr('현재 수치')}</option>
            <option value="percent">{tr('남은 비율 (%)')}</option>
          </select>
        </DetailRow>
      )}
      {d.optionalNumeric && !(test.kind === 'air' && test.option === 'any') && (
        <DetailRow label={tr('낙하 거리')} hint={d.hint}>
          <label>
            <input
              type="checkbox"
              checked={fall}
              onChange={e =>
                change(
                  e.target.checked
                    ? {value: test.value ?? 200}
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
          <select value={test.measure ?? ''} onChange={e => change({measure: e.target.value as 'current' | 'base'})}>
            <Unchosen />
            <option value="current">{tr('현재 값')}</option>
            <option value="base">{tr('기본 값')}</option>
          </select>
        </DetailRow>
      )}
      {compared && (
        <DetailRow label={tr('비교')} hint={d.hint}>
          <select
            value={test.compare ?? ''}
            onChange={e =>
              change({
                compare: e.target.value as BranchTest['compare'],
                // A range's end is entered by the user; one already there is kept within the range.
                ...(e.target.value === 'range' && test.upper !== undefined
                  ? {upper: Math.max(test.value ?? 0, Math.min(extensionMaximum(test), test.upper))}
                  : {}),
              })
            }
          >
            <Unchosen />
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
                    : test.kind === 'heldTime'
                      ? tr('시간 (초)')
                      : test.kind === 'air'
                        ? tr('거리')
                        : tr('값')
          }
          hint={d.hint}
        >
          <NumberInput
            min="0"
            max={extensionMaximum(test)}
            step="any"
            value={test.value}
            change={v => change({value: v})}
          />
        </DetailRow>
      )}
      {compared && test.compare === 'range' && (
        <DetailRow label={tr('끝 값')}>
          <NumberInput
            min={test.kind === 'gameHour' ? 0 : (test.value ?? 0)}
            max={extensionMaximum(test)}
            step="any"
            value={test.upper}
            change={v => change({upper: v})}
          />
        </DetailRow>
      )}
    </>
  );
}
