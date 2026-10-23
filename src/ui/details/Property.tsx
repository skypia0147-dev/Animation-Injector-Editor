import type {ReactNode} from 'react';
import {DetailRow} from './DetailRow.tsx';
import type {LabelId} from '../../labels.ts';
import {labelHelp, labelText} from '../../labels.ts';
import {tr} from '../../i18n/korean.ts';

// A details row (docs/mockup-layout-fixes ①): no reset button, which shifted the row whenever a value changed; the
// default is said in the row's help instead.
const defaultText = (initial: unknown, options?: [string, string][]) => {
  if (initial === undefined || initial === null || typeof initial === 'object') return '';
  const shown =
    typeof initial === 'boolean'
      ? initial
        ? tr('켬')
        : tr('끔')
      : (options?.find(([v]) => v === String(initial))?.[1] ?? String(initial));
  return shown === '' ? '' : tr('기본값: {v}', {v: shown});
};
import {NumberField} from './NumberField.tsx';
export function Property({
  id,
  label,
  hint,
  value,
  initial,
  change,
  options,
  max = 600,
  min = 0,
  step = 0.05,
  unit,
  children,
}: {
  id: LabelId;
  label?: string;
  hint?: string;
  value: any;
  initial?: any;
  change: (v: any) => void;
  options?: [string, string][];
  max?: number;
  min?: number;
  step?: number;
  unit?: string;
  children?: ReactNode;
}) {
  const help = [hint ?? labelHelp(id), defaultText(initial, options)].filter(Boolean).join(' ');
  return (
    <DetailRow id={id} label={label} hint={help || undefined}>
      {children ??
        (options ? (
          <select aria-label={label ?? labelText(id)} value={String(value)} onChange={e => change(e.target.value)}>
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : typeof value === 'boolean' ? (
          <input type="checkbox" checked={value} onChange={e => change(e.target.checked)} />
        ) : typeof value === 'number' ? (
          <div className="detail-number">
            <NumberField label={labelText(id)} min={min} max={max} step={step} value={value} change={change} />
            {unit && <span>{unit}</span>}
          </div>
        ) : (
          <input value={value ?? ''} onChange={e => change(e.target.value)} />
        ))}
    </DetailRow>
  );
}
