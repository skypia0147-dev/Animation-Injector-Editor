import {useRef, useState} from 'react';
import {t} from '../../i18n/index.ts';
import {NumberInput} from './NumberInput.tsx';

// Preview locally while dragging; commit once to preserve a single undo step.
export function NumberField({
  value,
  change,
  label,
  min = 0,
  max = 600,
  step = 0.05,
}: {
  value: number;
  change: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{x: number; value: number; next: number} | null>(null);
  const cancel = () => {
    drag.current = null;
    setPreview(null);
  };
  return (
    <div className="number-control">
      <button
        type="button"
        className="number-drag"
        aria-label={label + ' · ' + t('detail.dragNumber')}
        title={t('detail.dragNumber')}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const n = Number.isFinite(value) ? value : 0;
          drag.current = {x: e.clientX, value: n, next: n};
          setPreview(n);
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          d.next = Math.max(
            min,
            Math.min(max, Number((d.value + Math.round((e.clientX - d.x) / 4) * step).toFixed(5)))
          );
          setPreview(d.next);
        }}
        onPointerUp={() => {
          const d = drag.current;
          cancel();
          if (d && d.next !== value) change(d.next);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            change(Math.max(min, Math.min(max, Number((value + (e.key === 'ArrowRight' ? step : -step)).toFixed(5)))));
          }
        }}
      >
        ↔
      </button>
      <NumberInput aria-label={label} min={min} max={max} step={step} value={value} preview={preview} change={change} />
    </div>
  );
}
