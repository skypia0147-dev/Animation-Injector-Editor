import type {ReactNode} from 'react';
import {DetailRow} from './DetailRow.tsx';
import type {LabelId} from '../../labels.ts';
import {labelText} from '../../labels.ts';
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
  const different = initial !== undefined && JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <DetailRow
      id={id}
      label={label}
      hint={hint}
      changed={different}
      reset={initial !== undefined ? () => change(structuredClone(initial)) : undefined}
    >
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
