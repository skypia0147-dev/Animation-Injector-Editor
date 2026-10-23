import {useState} from 'react';
import {rulerDrag, rulerGrab, type RulerGrab} from './hkxMoments.ts';
import {barSeconds, barText, readTyped, settle, snapTime, type BarTime} from './clipBar.ts';
import {tr} from '../i18n/korean.ts';

// The one-line clip bar (docs/mockup-clip-bar): label, the clip with its HKX's annotation times as ticks, and the value
// written at the end of the line. Drag the moment, a window's ends or the whole window (drawn to the ticks, the start
// and 「끝」); a focused handle moves by ←/→ (0.01 s, Shift 0.1 s); a click on the value types it in place. Without the
// clip's length (the HKX not read) only the value is shown, typed the same way.

export type BarTick = {t: number; name: string};
type Key = 'at' | 'from' | 'until';

export function ClipBar({
  label,
  length,
  ticks = [],
  others = [],
  at,
  span,
  onAt,
  onSpan,
}: {
  label: string;
  length: number | undefined;
  ticks?: BarTick[];
  /** Other items' moments on the same clip, drawn small. */
  others?: number[];
  at?: BarTime;
  span?: [BarTime, BarTime];
  onAt?: (t: BarTime) => void;
  onSpan?: (from: BarTime, until: BarTime) => void;
}) {
  const [drag, setDrag] = useState<{
    grab: RulerGrab;
    origin: {t: number; at: number; from: number; until: number};
    now: {at: number; from: number; until: number};
  }>();
  const [typing, setTyping] = useState<{key: Key; text: string}>();
  const known = length !== undefined && length > 0;
  const sec = (t: BarTime | undefined) => (t === undefined ? 0 : (barSeconds(t, length) ?? 0));
  const values = {at: sec(at), from: sec(span?.[0]), until: sec(span?.[1])};
  const commit = (key: Key, t: BarTime) => {
    if (key === 'at') onAt?.(t);
    else if (span) {
      const from = key === 'from' ? t : span[0],
        until = key === 'until' ? t : span[1];
      const a = barSeconds(from, length),
        b = barSeconds(until, length);
      // A window keeps its start before its end.
      if (a !== undefined && b !== undefined && a > b) return;
      onSpan?.(from, until);
    }
  };
  const valueOf = (key: Key): BarTime | undefined => (key === 'at' ? at : key === 'from' ? span?.[0] : span?.[1]);
  const value = (key: Key) => {
    const v = valueOf(key);
    if (v === undefined) return null;
    if (typing?.key === key) {
      const done = (ok: boolean) => {
        const t = ok ? readTyped(typing.text) : undefined;
        setTyping(undefined);
        if (t === undefined) return;
        const s = barSeconds(t, length);
        commit(key, typeof t === 'number' && known && s !== undefined ? settle(Math.min(s, length!), length) : t);
      };
      return (
        <input
          className="clip-bar-input"
          aria-label={label}
          data-wheel-step={0.05}
          min={0}
          autoFocus
          value={typing.text}
          onChange={e => setTyping({key, text: e.target.value})}
          onKeyDown={e => {
            if (e.key === 'Enter') done(true);
            if (e.key === 'Escape') done(false);
          }}
          onBlur={() => done(true)}
        />
      );
    }
    const shown = drag && known ? settle(drag.now[key], length) : v;
    return (
      <button
        type="button"
        className="clip-bar-text"
        title={tr('눌러서 입력')}
        onClick={() => setTyping({key, text: typeof v === 'number' ? String(v) : barText(v)})}
      >
        {barText(shown)}
      </button>
    );
  };
  const place = (t: number) => (known ? Math.min(100, Math.max(0, (t / length!) * 100)) : 0);
  const timeAt = (el: HTMLElement, x: number) => {
    const r = el.getBoundingClientRect();
    return Math.min(length!, Math.max(0, ((x - r.left) / r.width) * length!));
  };
  const points = ticks.map(k => k.t);
  // Dragging draws to the ticks within 8 px.
  const snapped = (grab: RulerGrab, now: {at: number; from: number; until: number}, near: number) => {
    const s = (x: number) => snapTime(x, length!, points, near);
    if (grab === 'at') return {...now, at: s(now.at)};
    if (grab === 'from') return {...now, from: Math.min(s(now.from), now.until)};
    if (grab === 'until') return {...now, until: Math.max(s(now.until), now.from)};
    const from = s(now.from),
      width = now.until - now.from;
    return {...now, from, until: Math.min(length!, from + width)};
  };
  const nudge = (key: Key, e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
    const t = Math.min(length!, Math.max(0, values[key] + d));
    if (key === 'from' && t > values.until) return;
    if (key === 'until' && t < values.from) return;
    commit(key, settle(t, length));
  };
  const shown = drag?.now ?? values;
  return (
    <div className={'clip-bar' + (known ? '' : ' no-track')}>
      <span className="moment-label">{label}</span>
      {known && (
        <div
          className={'clip-bar-track nodrag nopan' + (drag ? ' dragging' : '')}
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('[data-handle]') && e.button !== 0) return;
            const width = e.currentTarget.getBoundingClientRect().width,
              near = (length! * 8) / Math.max(1, width);
            const t = timeAt(e.currentTarget, e.clientX);
            const grab = rulerGrab(
              t,
              span ? [values.from, values.until] : undefined,
              (length! * 10) / Math.max(1, width)
            );
            const origin = {t, ...values};
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({grab, origin, now: snapped(grab, rulerDrag(grab, origin, t, length!), near)});
          }}
          onPointerMove={e => {
            if (!drag) return;
            const width = e.currentTarget.getBoundingClientRect().width;
            const t = timeAt(e.currentTarget, e.clientX);
            setDrag({
              ...drag,
              now: snapped(
                drag.grab,
                rulerDrag(drag.grab, drag.origin, t, length!),
                (length! * 8) / Math.max(1, width)
              ),
            });
          }}
          onPointerUp={() => {
            if (!drag) return;
            const {now, origin, grab} = drag;
            setDrag(undefined);
            if (grab === 'at') {
              if (now.at !== origin.at) onAt?.(settle(now.at, length));
            } else if (now.from !== origin.from || now.until !== origin.until)
              onSpan?.(settle(now.from, length), settle(now.until, length));
          }}
          onPointerCancel={() => setDrag(undefined)}
        >
          {ticks.map((k, i) => (
            <span key={i} className="tick" style={{left: `${place(k.t)}%`}} title={k.name} />
          ))}
          {others.map((t, i) => (
            <span key={'o' + i} className="other" style={{left: `${place(t)}%`}} />
          ))}
          {span && (
            <>
              <span
                className="span"
                style={{
                  left: `${place(shown.from)}%`,
                  width: `${Math.max(0, place(shown.until) - place(shown.from))}%`,
                }}
              />
              {(['from', 'until'] as const).map(key => (
                <span
                  key={key}
                  data-handle
                  className="edge"
                  tabIndex={0}
                  role="slider"
                  aria-label={label + (key === 'from' ? ' · ' + tr('시작') : ' · ' + tr('끝'))}
                  aria-valuemin={0}
                  aria-valuemax={length}
                  aria-valuenow={shown[key]}
                  style={{left: `${place(shown[key])}%`}}
                  onKeyDown={e => nudge(key, e)}
                />
              ))}
            </>
          )}
          {at !== undefined && (
            <span
              data-handle
              className="me"
              tabIndex={0}
              role="slider"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={length}
              aria-valuenow={shown.at}
              style={{left: `${place(shown.at)}%`}}
              onKeyDown={e => nudge('at', e)}
            />
          )}
        </div>
      )}
      <span className="clip-bar-value">
        {span ? (
          <>
            {value('from')}
            <span className="clip-bar-arrow">→</span>
            {value('until')}
          </>
        ) : (
          value('at')
        )}
      </span>
    </div>
  );
}
