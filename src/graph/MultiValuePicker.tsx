import {useEffect, useRef, useState} from 'react';
import {tr} from '../i18n/korean.ts';
import {joinValues, valuesOf} from './multiValue.ts';
import './multiValue.css';

/** A check's values (docs/mockup-condition-groups ③): the chosen ones as chips, × takes one away (one always stays),
 *  ＋ opens the values not chosen yet. `value` and `change` are the comma list the XML writes. */
export function MultiValuePicker({
  value,
  choices,
  change,
  label,
}: {
  value: string | undefined;
  choices: readonly (readonly [string, string])[];
  change: (value: string) => void;
  label: string;
}) {
  const chosen = valuesOf(value),
    rest = choices.filter(([v]) => !chosen.includes(v));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);
  const name = (v: string) => choices.find(([c]) => c === v)?.[1] ?? v;
  return (
    <span className="multi-values nodrag" ref={box} role="group" aria-label={label}>
      {chosen.map(v => (
        <span key={v} className={'multi-value' + (chosen.length > 1 ? '' : ' alone')}>
          {name(v)}
          {chosen.length > 1 && (
            <button
              type="button"
              aria-label={tr('{v} 빼기', {v: name(v)})}
              onClick={() => change(joinValues(chosen.filter(x => x !== v)))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {rest.length > 0 && (
        <button
          type="button"
          className="multi-add"
          aria-label={tr('값 추가')}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          ＋
        </button>
      )}
      {open && (
        <span className="multi-menu nowheel" role="menu" aria-label={tr('추가할 값')}>
          {rest.map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              onClick={() => {
                change(joinValues([...chosen, v]));
                if (rest.length === 1) setOpen(false);
              }}
            >
              {l}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
