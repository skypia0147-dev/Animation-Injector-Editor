import {useMemo} from 'react';
import type {Action, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {mark} from '../model.ts';
import {clipKey, useClipAnnotations} from './annotations.ts';
import {actionClip} from './hkxMoments.ts';
import {
  directShot,
  dropClipTime,
  fireArrowSummary,
  fireTiming,
  fireToEvent,
  sentEvents,
  setShotWay,
  shotWay,
} from './fireArrowMoments.ts';
import {RegistryLink, WhenSwitch, useClipBar} from './MomentFields.tsx';
import {ClipBar} from './ClipBar.tsx';
import {barToSeconds} from './clipBar.ts';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {tr} from '../i18n/korean.ts';

// The HKX card's 활 발사 item (docs/mockup-fire-arrow-once, 10-23): one automatic shot, at a clip time or on an event
// this HKX sends; the button's release fires the drawn arrow first. An event shot is the registry's, its way and
// damage this node's (runtime 0.12.281, docs/mockup-event-node-values). What it shows comes from fireArrowMoments.ts.
function useSent(w: Workspace, a: Action | undefined) {
  const annotations = useClipAnnotations(w);
  return useMemo(() => sentEvents(w, a, annotations), [annotations, w.actions, w.eventRegistry, a]);
}

/** The item's summary: its automatic shot and whether the button fires first. */
export function useFireArrowSummary(w: Workspace, a: Action | undefined): string {
  const sent = useSent(w, a?.config.fireArrow ? a : undefined);
  const annotations = useClipAnnotations(w);
  return fireArrowSummary(w, a, sent, !a || annotations.has(clipKey(actionClip(w, a))));
}

function ModeSeg({direct, change}: {direct: boolean; change: (direct: boolean) => void}) {
  return (
    <span className="moment-seg" role="group" aria-label={tr('발사 방식')}>
      <button type="button" aria-pressed={!direct} onClick={() => direct && change(false)}>
        {tr('당긴 만큼')}
      </button>
      <button type="button" aria-pressed={direct} onClick={() => !direct && change(true)}>
        {tr('바로 발사')}
      </button>
    </span>
  );
}

export function FireArrowShots({
  w,
  action: a,
  edit,
}: {
  w: Workspace;
  action: Action;
  edit: (fn: (w: Workspace) => Workspace) => void;
}) {
  const sent = useSent(w, a);
  // An HKX whose annotations are not read (no source here) may still send an event shot: not a missing timing.
  const read = useClipAnnotations(w).has(clipKey(actionClip(w, a)));
  const timing = fireTiming(w, a, sent);
  const {length, ticks} = useClipBar(w, a);
  const f = a.config.fireArrow!;
  const setFire = (next: NonNullable<Action['config']['fireArrow']>) =>
    edit(w => {
      const current = w.actions.find(x => x.uid === a.uid)!;
      return putAction(w, {...current, config: {...current.config, fireArrow: next}});
    });
  const noEvents = sent.length ? undefined : tr('이 HKX가 보내는 이벤트가 없습니다(HKX 원본을 연결하면 보입니다).');

  // Two automatic timings (an older file, or an event shot registered later): it shoots twice. The events are the
  // registry's; the clip time is this node's and can go.
  if (timing.kind === 'conflict')
    return (
      <div className="moment-fields">
        <div className="fire-shot bad">
          <p className="moment-note warn">
            {tr('자동 발사 시점이 {n}개입니다. 한 번 재생에 여러 번 쏩니다.', {
              n: timing.shots.length + (f.at ? 1 : 0),
            })}
          </p>
          {timing.shots.map(shot => (
            <div key={shot.fn.id} className="fire-shot-line">
              <span>
                {tr('이벤트')} <code className="fire-shot-event">{shot.name}</code>{' '}
                {tr('{seconds}초', {seconds: shot.time.toFixed(2)})}
              </span>
              <RegistryLink event={shot.name} />
            </div>
          ))}
          {f.at && (
            <div className="fire-shot-line">
              <span>{tr('클립 시각 {seconds}초', {seconds: f.at.seconds})}</span>
              <button onClick={() => edit(w => dropClipTime(w, a.uid))}>{tr('클립 시각 빼기')}</button>
            </div>
          )}
          <p className="moment-note">{tr('이벤트 발사는 이벤트 등록에서 뺍니다.')}</p>
        </div>
      </div>
    );

  const shot = timing.kind === 'event' ? timing.shot : undefined;
  const way = shot ? shotWay(a, shot) : undefined;
  const direct = directShot(w, a, timing);
  const setWay = (d: boolean, damage?: number) => {
    if (shot)
      edit(w => setShotWay(w, a.uid, shot, d ? {mode: 'direct', ...(damage ? {damage: String(damage)} : {})} : {}));
    else {
      const {mode: _, damage: __, ...rest} = f;
      setFire(d ? {...rest, mode: 'direct', onRelease: false, ...(damage && damage !== 100 ? {damage} : {})} : rest);
    }
  };
  return (
    <div className="moment-fields">
      <WhenSwitch
        label={tr('자동 발사')}
        clip={timing.kind === 'clip' ? true : timing.kind === 'event' ? false : undefined}
        disabled={{
          event: noEvents,
          clip: shot
            ? tr('이벤트 발사는 이벤트 등록의 기능입니다. 등록에서 빼야 클립 시각으로 정할 수 있습니다.')
            : undefined,
        }}
        choose={clip => {
          if (clip) setFire({...f, at: mark(0.5)});
          // The clip time (or, in an older button-only item, nothing) becomes a shot on the first event it sends.
          else if (sent.length) edit(w => fireToEvent(w, a.uid, sent[0].name));
        }}
      />
      {timing.kind === 'none' &&
        (read ? (
          <p className="moment-note warn">{tr('자동 발사 시점을 고르세요. 지금은 버튼을 뗄 때만 쏩니다.')}</p>
        ) : (
          <p className="moment-note">
            {tr('이 HKX의 주석을 읽지 못했습니다. HKX 원본을 연결하면 이벤트 발사가 보입니다.')}
          </p>
        ))}
      {timing.kind === 'clip' && f.at && (
        <ClipBar
          label={tr('시각')}
          length={length}
          ticks={ticks}
          at={f.at.seconds}
          onAt={t => setFire({...f, at: {...f.at!, seconds: barToSeconds(t, length, f.at!.seconds)}})}
        />
      )}
      {shot && (
        <div className="moment-line">
          <span className="moment-label">{tr('이벤트')}</span>
          <span className="moment-inline">
            <code>{shot.name}</code>
            <span className="moment-unit">· {tr('{seconds}초', {seconds: shot.time.toFixed(2)})}</span>
            <RegistryLink event={shot.name} />
          </span>
        </div>
      )}
      {timing.kind !== 'none' && (
        <div className="moment-line">
          <span className="moment-label">{tr('발사 방식')}</span>
          <ModeSeg
            direct={direct}
            change={d => {
              setWay(d);
              // A direct shot has no draw to release first.
              if (d && shot && f.onRelease) setFire({...f, onRelease: false});
            }}
          />
        </div>
      )}
      {direct && (
        <div className="moment-line">
          <span className="moment-label">{tr('피해 %')}</span>
          <span className="moment-inline">
            <NumberInput
              aria-label={tr('피해 %')}
              min={1}
              max={1000}
              step={5}
              value={Number((shot ? way?.damage : f.damage) ?? 100)}
              change={value => setWay(true, value)}
            />
            <span className="moment-unit">{tr('끝까지 당긴 피해에 곱함')}</span>
          </span>
        </div>
      )}
      <div className="moment-line">
        <span
          className="moment-label has-tip"
          title={
            direct
              ? tr('바로 발사는 당김이 없어 버튼으로 먼저 쏠 수 없습니다.')
              : tr('자동 발사 전에 공격 버튼을 떼면 그때 쏩니다. 화살이 이미 나갔으면 자동 발사는 건너뜁니다.')
          }
        >
          {tr('버튼 뗄 때')}
        </span>
        <span className="moment-seg" role="group" aria-label={tr('버튼 뗄 때')}>
          <button
            type="button"
            aria-pressed={f.onRelease && !direct}
            disabled={direct}
            onClick={() => setFire({...f, onRelease: true})}
          >
            {tr('먼저 쏘기')}
          </button>
          <button
            type="button"
            aria-pressed={!f.onRelease || direct}
            disabled={direct}
            onClick={() => setFire({...f, onRelease: false})}
          >
            {tr('안 함')}
          </button>
        </span>
      </div>
    </div>
  );
}
