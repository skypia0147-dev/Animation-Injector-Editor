import {HelpNote} from '../ui/HelpTip.tsx';
import {useEffect, useRef, useState} from 'react';
import type {PointerEvent, CSSProperties} from 'react';
import type {Workspace, Action} from '../workspace.ts';
import {assetLibrary} from '../assets.ts';
import {assetKey} from '../package.ts';
import {previewPerson, stepSource} from '../view.ts';
import {
  timelineRows,
  slots,
  title,
  roleTitle,
  add,
  remove,
  duplicate,
  tracks,
  addTrack,
  trackOf,
  patch,
  timeOf,
  retime,
  extent,
} from './model.ts';
import type {Row, Meta} from './model.ts';
import {useMetadata} from './metadata.ts';
import {rulerTicks} from './ruler.ts';
import {t, useLanguage} from '../i18n/index.ts';
import {useEditorMenu} from '../ContextMenu.tsx';
import {tr} from '../i18n/korean.ts';
type Drag = {
  row: Row;
  mode: 'move' | 'start' | 'end';
  x: number;
  a: number;
  b: number;
  na: number;
  nb: number;
  scale: number;
  copy: boolean;
};

const scrubTime = (clientX: number, left: number, width: number, start: number, limit: number, duration: number) => {
  const local = Math.max(0, Math.min(width, clientX - left)),
    ratio = local <= 2 ? 0 : local >= width - 2 ? 1 : local / width;
  return Math.max(0, Math.min(duration, start + ratio * limit));
};

export function Timeline({
  w,
  action,
  step,
  selected,
  onSelect,
  edit,
  status,
  onMetadata,
  selectedStep,
  person,
  onStepChange,
  playhead,
  onScrub,
  externalMeta,
}: {
  w: Workspace;
  action?: Action;
  step?: string;
  selected: string;
  onSelect: (id: string) => void;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  onMetadata: (v: {action: string; meta?: Meta; clip: string; error?: string}) => void;
  selectedStep?: string;
  /** The person a `both` action previews (view.ts). */
  person?: import('../view.ts').Person;
  onStepChange?: (step: string) => void;
  playhead?: number;
  onScrub?: (time: number) => void;
  externalMeta?: Meta;
}) {
  useLanguage();
  const [localChosen, setLocalChosen] = useState(''),
    [animationIndex, setAnimationIndex] = useState(0),
    [revision, setRevision] = useState(0),
    [zoom, setZoom] = useState(1),
    [offset, setOffset] = useState(0),
    [localCursor, setLocalCursor] = useState(0),
    [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // The ruler's width picks its step (ruler.ts); the lane is measured, not guessed.
  const rulerRef = useRef<HTMLDivElement>(null),
    [rulerWidth, setRulerWidth] = useState(0);
  useEffect(() => {
    const lane = rulerRef.current;
    if (!lane) return;
    const observer = new ResizeObserver(() => setRulerWidth(lane.clientWidth));
    observer.observe(lane);
    setRulerWidth(lane.clientWidth);
    return () => observer.disconnect();
  }, [!action]);
  const chosen = selectedStep ?? localChosen,
    cursor = playhead ?? localCursor,
    setCursor = (time: number) => (onScrub ? onScrub(time) : setLocalCursor(time));
  const clip = action?.config.steps.find(s => s.id === (chosen || step)) ?? action?.config.steps[0];
  // A first-person action's HKX is its _1stPerson copy (view.ts).
  const source = action && clip ? stepSource(w, action, clip, person && previewPerson(w, action, person)) : undefined;
  const path =
    source?.path || assetLibrary(w).find(a => assetKey(a.clip) === assetKey(source?.clip ?? ''))?.localPath || '';
  const state = useMetadata(path, revision),
    meta = externalMeta ?? state.data?.[animationIndex] ?? state.data?.[0];
  const items = action ? timelineRows(w, action, clip?.id) : [],
    duration = extent(items, meta),
    limit = duration / zoom,
    start = Math.max(0, Math.min(offset, duration - limit));
  useEffect(() => {
    setLocalChosen('');
    setOffset(0);
    setAnimationIndex(0);
    setZoom(1);
    setLocalCursor(0);
    setDrag(null);
  }, [action?.uid, step]);
  useEffect(() => {
    setAnimationIndex(0);
    setZoom(1);
    setDrag(null);
  }, [path]);
  useEffect(() => {
    onMetadata({action: action?.uid ?? '', meta, clip: clip?.id ?? '', error: externalMeta ? undefined : state.error});
  }, [action?.uid, clip?.id, meta, state.error, externalMeta, onMetadata]);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      status(String(e));
    }
  };
  useEffect(() => {
    if (!drag || !action) return;
    const move = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let delta = (e.clientX - d.x) / d.scale;
      let na = d.a,
        nb = d.b;
      if (d.mode === 'move') {
        delta = Math.max(-d.a, Math.min(delta, duration - d.b));
        na += delta;
        nb += delta;
      } else if (d.mode === 'start') na = Math.max(0, Math.min(d.a + delta, d.b));
      else nb = Math.max(d.a, Math.min(d.b + delta, duration));
      const next = {...d, na, nb};
      dragRef.current = next;
      setDrag(next);
    };
    const finish = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || Math.abs(d.na - d.a) + Math.abs(d.nb - d.b) < 0.00001) return;
      attempt(() => {
        if (d.copy) {
          const result = duplicate(w, action.uid, d.row.id, d.na);
          edit(() => result.workspace);
          onSelect(result.id);
        } else
          edit(w =>
            patch(w, action.uid, d.row.id, {
              from: retime(d.row.from, d.na, duration),
              ...(d.row.until ? {until: retime(d.row.until, d.nb, duration)} : {}),
            })
          );
      });
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dragRef.current = null;
        setDrag(null);
      }
    };
    const lost = () => {
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('keydown', cancel);
    window.addEventListener('pointercancel', lost);
    window.addEventListener('blur', lost);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('pointercancel', lost);
      window.removeEventListener('blur', lost);
    };
  }, [!!drag, action?.uid, duration, w]);
  const begin = (e: PointerEvent, row: Row, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(row.id);
    if (row.transition && !row.id.startsWith('clipWindow:')) return;
    if (row.from.basis === 'event' || row.until?.basis === 'event') {
      status(t('timeline.markerFixed'));
      return;
    }
    if (e.ctrlKey && !action?.pair) {
      status(t('timeline.singleton'));
      return;
    }
    const lane = e.currentTarget.closest('.notify-lane')!.getBoundingClientRect(),
      a = timeOf(row.from, duration, meta) ?? 0,
      b = row.until ? (timeOf(row.until, duration, meta) ?? a) : a;
    const d = {
      row,
      mode,
      x: e.clientX,
      a,
      b,
      na: a,
      nb: b,
      scale: lane.width / limit,
      copy: e.ctrlKey && !row.id.startsWith('runtime:'),
    };
    dragRef.current = d;
    setDrag(d);
  };
  const {context, menu} = useEditorMenu((target, x) => {
    if (!action) return [];
    const row = items.find(r => r.id === target.closest('[data-notify]')?.getAttribute('data-notify'));
    const lane = target.closest('.notify-lane')?.getBoundingClientRect();
    const time = lane ? Math.max(0, Math.min(duration, start + ((x - lane.left) / lane.width) * limit)) : cursor;
    const track = Number(target.closest('[data-track]')?.getAttribute('data-track')) || 1;
    const create = (kind: string) => {
      const result = add(w, action.uid, kind, time, track);
      edit(() => result.workspace);
      onSelect(result.id);
    };
    return [
      ...(row
        ? [
            {
              label: row.transition ? t('graph.openRule') : t('timeline.remove'),
              run: () => (row.transition ? onSelect(row.id) : edit(w => remove(w, action.uid, row.id))),
            },
            ...(!row.transition
              ? [
                  {
                    label: t('timeline.duplicate'),
                    disabled:
                      row.id.startsWith('runtime:') ||
                      !action.pair ||
                      row.from.basis === 'event' ||
                      row.until?.basis === 'event',
                    run: () => {
                      const n = duplicate(w, action.uid, row.id, time);
                      edit(() => n.workspace);
                      onSelect(n.id);
                    },
                  },
                ]
              : []),
          ]
        : []),
      ...slots.map(k => ({
        label: t('timeline.addState') + ' · ' + title(k),
        disabled: !action.pair && items.some(r => r.kind === k),
        run: () => create(k),
      })),
      ...[
        'cost',
        'recovery',
        ...(!action.pair
          ? []
          : ['hide', 'show', 'spell', 'shake', 'cancel', 'timeOn', 'timeOff', 'stopVelocity', 'stateOn', 'stateOff']),
      ].map(k => ({
        label: t('timeline.addNotify') + ' · ' + title(k),
        disabled: (k === 'recovery' || (!action.pair && k === 'cost')) && items.some(r => r.kind === k),
        run: () => create(k),
      })),
      {label: t('timeline.addTrack'), run: () => edit(w => addTrack(w, action.uid))},
    ];
  }, status);
  const render = (r: Row) => {
    const rowNode = r.id.startsWith('runtime:')
      ? `anim:${action?.uid}:|${r.id.slice(8)}`
      : `notify:${action?.uid}|${r.id}`;
    const disabled = !!w.disconnections?.some(c => c.bindings.some(b => b.target === rowNode));
    const a = drag?.row.id === r.id ? drag.na : timeOf(r.from, duration, meta),
      b = drag?.row.id === r.id ? drag.nb : r.until ? timeOf(r.until, duration, meta) : a;
    const unknown = a === undefined || b === undefined,
      fixed = r.from.basis === 'event' || r.until?.basis === 'event';
    return (
      <div
        key={r.id}
        data-notify={r.id}
        role="button"
        tabIndex={0}
        aria-label={r.label + (disabled ? tr(' · 사용 안 함') : '')}
        className={
          'notify-item ' +
          (disabled ? 'checklist-muted ' : '') +
          (selected === r.id ? 'selected ' : '') +
          (r.until ? 'range ' : 'point ') +
          (unknown ? 'unresolved ' : '') +
          (r.transition ? 'transition' : '')
        }
        style={
          unknown
            ? undefined
            : {
                left: (((a ?? 0) - start) / limit) * 100 + '%',
                width: r.until ? Math.max(0.7, (((b ?? a ?? 0) - (a ?? 0)) / limit) * 100) + '%' : undefined,
              }
        }
        title={
          r.label +
          (unknown
            ? ' · ' + t(meta ? 'timeline.missing' : 'timeline.unknown')
            : fixed
              ? ' · ' + t('timeline.markerFixed')
              : '')
        }
        onClick={() => onSelect(r.id)}
        onPointerDown={e => r.id !== 'runtime:cameraRestore' && begin(e, r, 'move')}
        onKeyDown={e => {
          if (e.key === 'Enter') onSelect(r.id);
          if (e.key === 'Delete' && !r.transition) {
            e.stopPropagation();
            edit(w => remove(w, action!.uid, r.id));
          }
        }}
      >
        {r.until && !fixed && (!r.transition || r.id.startsWith('clipWindow:')) && (
          <span className="notify-handle left" aria-label="start" onPointerDown={e => begin(e, r, 'start')} />
        )}
        <span>
          {fixed ? '◇ ' : r.until ? '' : '◆ '}
          {r.label}
          {r.role ? ' · ' + roleTitle(r.role) : ''}
          {unknown ? ' · ?' : r.until ? ' · ' + a?.toFixed(2) + '–' + b?.toFixed(2) : ' · ' + a?.toFixed(2)}
        </span>
        {r.until && !fixed && (!r.transition || r.id.startsWith('clipWindow:')) && (
          <span className="notify-handle right" aria-label="end" onPointerDown={e => begin(e, r, 'end')} />
        )}
      </div>
    );
  };
  const ruler = rulerTicks(start, limit, rulerWidth);
  return (
    <div
      className="notify-timeline"
      data-testid="notify-timeline"
      onContextMenu={e => {
        e.stopPropagation();
        context(e);
      }}
    >
      {menu}
      <div className="notify-tools">
        <select
          aria-label={t('timeline.clip')}
          value={clip?.id ?? ''}
          onChange={e => (onStepChange ? onStepChange(e.target.value) : setLocalChosen(e.target.value))}
        >
          {action?.config.steps.map(s => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {!externalMeta && state.data && state.data.length > 1 && (
          <select
            aria-label={t('timeline.animation')}
            value={animationIndex}
            onChange={e => setAnimationIndex(Number(e.target.value))}
          >
            {state.data.map((m, i) => (
              <option value={i} key={i}>
                {i + 1} · {m.duration.toFixed(3)} s
              </option>
            ))}
          </select>
        )}
        {/* One line (docs/mockup-layout-audit ③): the short name, the whole one as the help. */}
        <span title={`${t(meta ? 'timeline.actual' : 'timeline.estimated')}: ${duration.toFixed(3)} s`}>
          {t(meta ? 'timeline.actualShort' : 'timeline.estimatedShort')} {duration.toFixed(2)} s
        </span>
        <button title={t('timeline.reload')} onClick={() => setRevision(v => v + 1)}>
          ↻
        </button>
        <button onClick={() => setZoom(1)}>100%</button>
        <span className="notify-cursor">{cursor.toFixed(2)} s</span>
      </div>
      <div className="notify-meta">
        {!externalMeta && state.loading ? t('timeline.reading') : externalMeta ? '' : (state.error ?? '')}
      </div>
      {!action ? (
        <p>{t('timeline.selectState')}</p>
      ) : (
        <div
          className="notify-scroll"
          style={{'--playhead': ((cursor - start) / limit) * 100 + '%', '--tick': ruler.step + '%'} as CSSProperties}
          onWheel={e => {
            if (e.ctrlKey) {
              e.preventDefault();
              setZoom(z => Math.max(0.25, Math.min(8, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
            }
          }}
        >
          <div className="notify-row">
            <div className="notify-label">{t('timeline.trackLabel')}</div>
            <div
              ref={rulerRef}
              className="notify-lane ruler"
              onPointerDown={e => {
                if (e.button !== 0) return;
                const r = e.currentTarget.getBoundingClientRect();
                setCursor(scrubTime(e.clientX, r.left, r.width, start, limit, duration));
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                if (!(e.buttons & 1) || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const r = e.currentTarget.getBoundingClientRect();
                setCursor(scrubTime(e.clientX, r.left, r.width, start, limit, duration));
              }}
            >
              {ruler.ticks.map(tick => (
                <span key={tick.text} className={tick.end ? 'end' : undefined} style={{left: tick.left + '%'}}>
                  {tick.text}
                </span>
              ))}
            </div>
          </div>
          {items
            .filter(r => r.transition)
            .map(r => (
              <div key={r.id} className="notify-row">
                <div className="notify-label">{t('node.transition')}</div>
                <div className="notify-lane">{render(r)}</div>
              </div>
            ))}
          {tracks(w, action.uid).map(track => (
            <div key={track} className="notify-row" data-track={track}>
              <div className="notify-label">
                {t('timeline.track')} {track}
              </div>
              <div className="notify-lane-group">
                {items
                  .filter(r => !r.transition && trackOf(w, action.uid, r.id) === track)
                  .map(r => (
                    <div key={r.id} className="notify-lane">
                      {render(r)}
                    </div>
                  ))}
                <div className="notify-lane empty" />
              </div>
            </div>
          ))}
          {meta && (
            <div className="notify-row">
              <div className="notify-label">{t('timeline.annotation')}</div>
              <div className="notify-lane">
                {meta.annotations.map((n, i) => (
                  <span
                    key={i}
                    className="hkx-marker"
                    title={n.text + ' · ' + n.time.toFixed(3) + ' s · ' + n.track}
                    style={{left: ((n.time - start) / limit) * 100 + '%'}}
                  >
                    ◇
                  </span>
                ))}
              </div>
            </div>
          )}
          {zoom > 1 && (
            <input
              className="notify-offset"
              type="range"
              aria-label={t('timeline.viewStart')}
              min={0}
              max={Math.max(0, duration - limit)}
              step={duration / 1000}
              value={start}
              onChange={e => setOffset(Number(e.target.value))}
            />
          )}
          <HelpNote label={tr('타임라인 조작')}>
            {t('timeline.empty')} · Ctrl+{t('timeline.wheelZoom')}
          </HelpNote>
        </div>
      )}
    </div>
  );
}
