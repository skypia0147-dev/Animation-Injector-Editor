import {useState} from 'react';
import type {InputHTMLAttributes} from 'react';
import {parseNumberDraft, shownNumber} from './numberDraft.ts';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number;
  change: (value: number) => void;
  preview?: number | null;
};

// Number box shared by details fields. Invalid or empty text is kept as a local draft and
// reverts to the stored value on blur; only finite numbers are committed.
// While it has the cursor the wheel steps it (Shift ×10) through the app's wheel guard (ui/wheelGuard.ts).
export function NumberInput({value, change, preview = null, onBlur, ...input}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseNumberDraft(draft) === undefined;
  return (
    <input
      {...input}
      type="number"
      value={shownNumber(value, draft, preview)}
      aria-invalid={invalid || undefined}
      onChange={e => {
        const text = e.target.value;
        setDraft(text);
        const next = parseNumberDraft(text);
        if (next !== undefined && next !== value) change(next);
      }}
      onBlur={e => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
