import {useRef} from 'react';
import type {CSSProperties} from 'react';
import {t} from '../i18n/index.ts';
import {clamp} from './layout.ts';

/** Pointer capture keeps a drag local; Escape and cancellation restore its initial value. */
export function PanelResize({
  label,
  axis,
  value,
  min,
  max,
  scale = 1,
  change,
  reset,
  style,
}: {
  label: string;
  axis: 'x' | 'y';
  value: number;
  min: number;
  max: number;
  scale?: number;
  change: (value: number) => void;
  reset: () => void;
  style?: CSSProperties;
}) {
  const drag = useRef<{pointer: number; start: number; value: number} | null>(null);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t(label)}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      aria-valuenow={Math.round(value)}
      title={t('layout.hint')}
      className={'panel-resize ' + axis}
      style={style}
      onDoubleClick={reset}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {pointer: e.pointerId, start: axis === 'x' ? e.clientX : e.clientY, value};
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (d && d.pointer === e.pointerId)
          change(clamp(d.value + ((axis === 'x' ? e.clientX : e.clientY) - d.start) * scale, min, max));
      }}
      onPointerUp={e => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onLostPointerCapture={() => {
        if (drag.current) change(drag.current.value);
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) change(drag.current.value);
        drag.current = null;
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape' && drag.current) {
          change(drag.current.value);
          drag.current = null;
          e.preventDefault();
        }
        const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp',
          positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === negative || e.key === positive) {
          e.preventDefault();
          change(clamp(value + (e.key === positive ? 10 : -10) * scale, min, max));
        }
        if (e.key === 'Home') {
          e.preventDefault();
          reset();
        }
      }}
    />
  );
}
