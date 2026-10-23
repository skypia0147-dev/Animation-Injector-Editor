import {useEffect, useRef, useState} from 'react';
import type {InputHTMLAttributes} from 'react';
import {parseNumberDraft, shownNumber, wheelStep} from './numberDraft.ts';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number;
  change: (value: number) => void;
  preview?: number | null;
};

// Number box shared by details fields. Invalid or empty text is kept as a local draft and
// reverts to the stored value on blur; only finite numbers are committed.
// While it has the cursor the wheel steps it (Shift ×10) and does not reach the canvas, whose zoom it would be
// otherwise (docs/mockup-layout-fixes ①).
export function NumberInput({value, change, preview = null, onBlur, ...input}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseNumberDraft(draft) === undefined;
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({value, change, step: input.step, min: input.min, max: input.max});
  latest.current = {value, change, step: input.step, min: input.min, max: input.max};
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A native listener: React's wheel handler is passive and cannot keep the page or the canvas from scrolling.
    const wheel = (e: WheelEvent) => {
      if (document.activeElement !== el || !e.deltaY) return;
      e.preventDefault();
      e.stopPropagation();
      const {value, change, step, min, max} = latest.current;
      const next = wheelStep(value, e.deltaY < 0 ? 1 : -1, Number(step) || 1, e.shiftKey, min, max);
      setDraft(null);
      if (next !== value) change(next);
    };
    el.addEventListener('wheel', wheel, {passive: false});
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return (
    <input
      {...input}
      ref={ref}
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
