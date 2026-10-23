import type {Action, Workspace} from '../../workspace.ts';
import type {Mark} from '../../model.ts';
import {sourceWindow, setSourceWindow} from '../../graph/clipWindows.ts';
import {ClipBar} from '../../graph/ClipBar.tsx';
import {useClipBar, WhenSwitch} from '../../graph/MomentFields.tsx';
import {
  atEnd,
  barToEndMark,
  barToExit,
  barToMark,
  barToSeconds,
  exitSlack,
  exitToBar,
  markToBar,
  type BarTime,
} from '../../graph/clipBar.ts';
import {EventPicker} from './EventPicker.tsx';
import {tr} from '../../i18n/korean.ts';

// The HKX's key detection window (입력 감지) and the end trigger (종료) as the other clip-time items
// (docs/mockup-card-cleanup ⑧, docs/mockup-clip-bar): 시점 [클립 | 이벤트], then the clip bar or the events.
const toEvent = (m: Mark, event: string): Mark => ({...m, basis: 'event', event, fallback: false});

/** One event line: the event this window or trigger waits for (the action's own). */
function EventLine({
  label,
  value,
  events,
  change,
}: {
  label: string;
  value: string;
  events: string[];
  change: (e: string) => void;
}) {
  return (
    <div className="moment-line">
      <span className="moment-label">{label}</span>
      <span className="moment-inline">
        <EventPicker label={label} value={value} events={events} change={change} />
        <span className="moment-own" title={tr('이 동작이 직접 기다리는 이벤트입니다. 다른 HKX에는 영향이 없습니다.')}>
          {tr('이 동작만')}
        </span>
      </span>
    </div>
  );
}

/** How a window's close is kept: counted from the end (an HKX's shared detection window), from the start, or either
 *  (a transition between actions closes after its start or at the end). */
export type CloseBasis = 'end' | 'seconds' | 'either';
type WindowValue = {open: Mark; close: Mark; buffered: boolean};

/** A key window on the clip: 시점 [클립 | 이벤트], the window as one bar (or its events), and 선입력. */
export function WindowFields({
  w,
  action,
  value,
  change,
  events = [],
  closeBasis,
  id,
}: {
  w: Workspace;
  action: Action | undefined;
  value: WindowValue;
  change: (next: Partial<WindowValue>) => void;
  events?: string[];
  closeBasis: CloseBasis;
  id?: string;
}) {
  const {length, ticks} = useClipBar(w, action);
  const isEvent = value.open.basis === 'event' || value.close.basis === 'event';
  const closeMark = (t: BarTime): Mark | undefined =>
    closeBasis === 'end'
      ? barToEndMark(value.close, t, length)
      : closeBasis === 'seconds'
        ? {...barToMark(value.close, barToSeconds(t, length, value.close.seconds))}
        : barToMark(value.close, t);
  const openMark = (t: BarTime) => barToMark(value.open, barToSeconds(t, length, 0));
  return (
    <div className="clip-window-fields moment-fields" data-clip-window={id}>
      <WhenSwitch
        clip={!isEvent}
        disabled={{
          event: events.length ? undefined : tr('이 HKX가 보내는 이벤트가 없습니다(HKX 원본을 연결하면 보입니다).'),
        }}
        choose={clip =>
          change(
            clip
              ? {
                  open: openMark(value.open.basis === 'event' ? 0 : markToBar(value.open)),
                  close:
                    closeMark(atEnd) ??
                    ({...value.close, basis: 'end', seconds: 0, event: '', fallback: false} satisfies Mark),
                }
              : {open: toEvent(value.open, events[0] ?? '')}
          )
        }
      />
      {isEvent ? (
        <>
          {value.open.basis === 'event' ? (
            <EventLine
              label={tr('열림 이벤트')}
              value={value.open.event}
              events={events}
              change={event => change({open: toEvent(value.open, event)})}
            />
          ) : (
            <ClipBar
              label={tr('열림')}
              length={length}
              ticks={ticks}
              at={markToBar(value.open)}
              onAt={t => change({open: openMark(t)})}
            />
          )}
          {value.close.basis === 'event' ? (
            <EventLine
              label={tr('닫힘 이벤트')}
              value={value.close.event}
              events={events}
              change={event => change({close: toEvent(value.close, event)})}
            />
          ) : (
            <ClipBar
              label={tr('닫힘')}
              length={length}
              ticks={ticks}
              at={markToBar(value.close)}
              onAt={t => {
                const close = closeMark(t);
                if (close) change({close});
              }}
            />
          )}
        </>
      ) : (
        <ClipBar
          label={tr('구간')}
          length={length}
          ticks={ticks}
          span={[markToBar(value.open), markToBar(value.close)]}
          onSpan={(from, until) => {
            const close = closeMark(until);
            if (close) change({open: openMark(from), close});
          }}
        />
      )}
      <div className="moment-line">
        <span className="moment-label" title={tr('구간이 열리기 전에 누른 키를 기억했다가 열릴 때 전환합니다.')}>
          {tr('선입력')}
        </span>
        <span className="moment-seg" role="group" aria-label={tr('선입력')}>
          <button
            type="button"
            aria-pressed={value.buffered}
            onClick={() => !value.buffered && change({buffered: true})}
          >
            {tr('켬')}
          </button>
          <button
            type="button"
            aria-pressed={!value.buffered}
            onClick={() => value.buffered && change({buffered: false})}
          >
            {tr('끔')}
          </button>
        </span>
      </div>
    </div>
  );
}

/** The HKX's detection window its key transitions share (입력 감지): its close is counted from the end. */
export function ClipWindowFields({
  w,
  action,
  step,
  change,
  events = [],
}: {
  w: Workspace;
  action: Action;
  step: string;
  change: (a: Action) => void;
  events?: string[];
}) {
  const {value} = sourceWindow(action, step);
  return (
    <WindowFields
      w={w}
      action={action}
      id={step}
      value={value}
      events={events}
      closeBasis="end"
      change={next => change(setSourceWindow(action, step, {...value, ...next}))}
    />
  );
}

/** The end trigger: at 「끝」 (0.05 s before the clip's end, the runtime's default), a clip time, or an event. */
export function ExitField({
  w,
  action,
  value,
  change,
  events = [],
}: {
  w: Workspace;
  action: Action;
  value: Mark;
  change: (m: Mark) => void;
  events?: string[];
}) {
  const {length, ticks} = useClipBar(w, action);
  const isEvent = value.basis === 'event';
  return (
    <div className="moment-fields">
      <WhenSwitch
        clip={!isEvent}
        disabled={{
          event: events.length ? undefined : tr('이 HKX가 보내는 이벤트가 없습니다(HKX 원본을 연결하면 보입니다).'),
        }}
        choose={clip =>
          change(
            clip
              ? {...value, basis: 'end', seconds: exitSlack, event: '', fallback: false}
              : toEvent(value, events[0] ?? '')
          )
        }
      />
      {isEvent ? (
        <EventLine
          label={tr('이벤트')}
          value={value.event}
          events={events}
          change={event => change(toEvent(value, event))}
        />
      ) : (
        <ClipBar
          label={tr('종료')}
          length={length}
          ticks={ticks}
          at={exitToBar(value)}
          onAt={t => {
            const m = barToExit(value, t, length);
            if (m) change(m);
          }}
        />
      )}
    </div>
  );
}
