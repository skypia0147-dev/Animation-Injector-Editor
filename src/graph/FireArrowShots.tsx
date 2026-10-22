import {useMemo, useState} from 'react';
import type {Action, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {mark} from '../model.ts';
import {useClipAnnotations} from './annotations.ts';
import {eventKey} from '../eventRegistry.ts';
import {
  addEventShot,
  eventShots,
  fireArrowSummary,
  sentEvents,
  setEventShot,
  type EventShot,
} from './fireArrowMoments.ts';
import {showRegistry} from './RegistryCard.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {tr} from '../i18n/korean.ts';

// The HKX card's 활 발사 item (docs/mockup-fire-arrow-item, 10-22): every moment this HKX shoots, one row each, edited
// in the card. What it shows comes from fireArrowMoments.ts.
function useSent(w: Workspace, a: Action | undefined) {
  const annotations = useClipAnnotations(w);
  return useMemo(() => sentEvents(w, a, annotations), [annotations, w.actions, w.eventRegistry, a]);
}

/** The item's summary: the moments it shoots, its registry event shots included. */
export function useFireArrowSummary(w: Workspace, a: Action | undefined): string {
  const sent = useSent(w, a?.config.fireArrow ? a : undefined);
  return fireArrowSummary(w, a, sent);
}

function ModeSeg({
  direct,
  change,
  directOff,
}: {
  direct: boolean;
  change: (direct: boolean) => void;
  directOff?: string;
}) {
  return (
    <span className="qte-seg fire-mode" role="group" aria-label={tr('발사 방식')}>
      <button type="button" aria-pressed={!direct} onClick={() => change(false)}>
        {tr('당긴 만큼')}
      </button>
      <button type="button" aria-pressed={direct} disabled={!!directOff} title={directOff} onClick={() => change(true)}>
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
  const shots = eventShots(w, sent);
  const [menu, setMenu] = useState(false);
  const f = a.config.fireArrow!;
  const setShot = (next: NonNullable<Action['config']['fireArrow']>) =>
    edit(w => {
      const current = w.actions.find(x => x.uid === a.uid)!;
      return putAction(w, {...current, config: {...current.config, fireArrow: next}});
    });
  const changeShot = (shot: EventShot, values?: Record<string, string>) => edit(w => setEventShot(w, shot, values));
  const addShot = (name: string) => edit(w => addEventShot(w, name));
  const free = sent.filter(s => !shots.some(x => eventKey(x.name) === s.key));
  const timedDirect = !!f.at && f.mode === 'direct';
  return (
    <div className="fire-shots">
      <span className="fire-shots-label">{tr('발사 시점')}</span>
      {shots.map(shot => {
        const v = shot.fn.values,
          direct = v.mode === 'direct';
        return (
          <div key={shot.fn.id} className="fire-shot">
            <div className="fire-shot-head">
              <span className="fire-shot-what">{tr('이벤트')}</span>
              <code className="fire-shot-event">{shot.name}</code>
              <span className="fire-shot-when">{tr('이 HKX 주석 {seconds}초', {seconds: shot.time.toFixed(2)})}</span>
            </div>
            <div className="fire-shot-line">
              <span>{tr('발사 방식')}</span>
              <ModeSeg
                direct={direct}
                change={d => {
                  const {mode: _, damage: __, ...rest} = v;
                  changeShot(shot, d ? {...rest, mode: 'direct'} : rest);
                }}
              />
            </div>
            {direct && (
              <div className="fire-shot-line">
                <span>{tr('피해 %')}</span>
                <NumberInput
                  aria-label={tr('피해 %')}
                  min={1}
                  max={1000}
                  step={5}
                  value={Number(v.damage ?? 100)}
                  change={value => changeShot(shot, {...v, damage: String(value)})}
                />
              </div>
            )}
            <p className="fire-shot-hint">
              {tr('이벤트 등록의 활 발사 · 이 이벤트를 보내는 HKX {count}개가 같은 설정으로 쏩니다', {
                count: shot.senders,
              })}{' '}
              ·{' '}
              <button type="button" className="fire-shot-link" onClick={() => showRegistry(shot.name)}>
                {tr('이벤트 등록에서 보기')}
              </button>{' '}
              ·{' '}
              <button type="button" className="fire-shot-link" onClick={() => changeShot(shot)}>
                {tr('이 시점 빼기')}
              </button>
            </p>
          </div>
        );
      })}
      <div className={'fire-shot' + (f.onRelease && !timedDirect ? '' : ' off')}>
        <label className="fire-shot-head">
          <input
            type="checkbox"
            checked={f.onRelease && !timedDirect}
            disabled={timedDirect}
            onChange={e => setShot({...f, onRelease: e.target.checked})}
          />
          <span className="fire-shot-what">{tr('버튼 뗄 때')}</span>
          <span className="fire-shot-when">{tr('이 동작 중 공격 버튼을 떼면 · 당긴 만큼')}</span>
        </label>
        {timedDirect && (
          <p className="fire-shot-hint">
            {tr('클립 시각이 바로 발사라 쓸 수 없습니다(동작의 활 발사는 방식이 하나).')}
          </p>
        )}
      </div>
      <div className={'fire-shot' + (f.at ? '' : ' off')}>
        <div className="fire-shot-head">
          <label>
            <input
              type="checkbox"
              checked={!!f.at}
              onChange={e => {
                if (e.target.checked) setShot({...f, at: mark(0.5)});
                else {
                  // A direct shot needs its time: without one the action's shot is drawn again.
                  const {mode: _, damage: __, ...rest} = f;
                  setShot({...rest, at: null, onRelease: f.mode === 'direct' ? true : rest.onRelease});
                }
              }}
            />{' '}
            <span className="fire-shot-what">{tr('클립 시각')}</span>
          </label>
          {f.at && (
            <span className="fire-shot-when">
              <NumberInput
                aria-label={tr('발사 시각')}
                min={0}
                step={0.05}
                value={f.at.seconds}
                change={seconds => setShot({...f, at: {...f.at!, seconds}})}
              />{' '}
              {tr('초')}
            </span>
          )}
        </div>
        {f.at && (
          <div className="fire-shot-line">
            <span>{tr('발사 방식')}</span>
            <ModeSeg
              direct={f.mode === 'direct'}
              change={d => {
                const {mode: _, damage: __, ...rest} = f;
                setShot(d ? {...rest, mode: 'direct', onRelease: false} : rest);
              }}
            />
          </div>
        )}
        {f.at && f.mode === 'direct' && (
          <div className="fire-shot-line">
            <span>{tr('피해 %')}</span>
            <NumberInput
              aria-label={tr('피해 %')}
              min={1}
              max={1000}
              step={5}
              value={f.damage ?? 100}
              change={value => {
                const {damage: _, ...rest} = f;
                setShot(value === 100 ? rest : {...rest, damage: value});
              }}
            />
          </div>
        )}
      </div>
      {!f.at && !f.onRelease && (
        // Event shots only: the action writes no <FireArrow> of its own (compiler.ts).
        <p className="fire-shot-hint">
          {shots.length
            ? tr('이 동작 자체로는 쏘지 않고, 위 이벤트에서만 쏩니다.')
            : tr('아직 쏘는 시점이 없습니다. 위에서 켜거나 「+ 발사 시점」으로 주석 이벤트를 고르세요.')}
        </p>
      )}
      <div className="fire-shot-add">
        <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          + {tr('발사 시점')}
        </button>
        {menu && (
          <div className="fire-shot-menu" role="menu">
            {free.length ? (
              free.map(s => (
                <button
                  key={s.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    addShot(s.name);
                  }}
                >
                  <span>{tr('주석 {name}', {name: s.name})}</span>
                  <small>{tr('{seconds}초', {seconds: s.time.toFixed(2)})}</small>
                </button>
              ))
            ) : (
              <small>
                {sent.length
                  ? tr('이 HKX 주석의 이벤트는 모두 이미 쏩니다.')
                  : tr('이 HKX 주석에서 읽은 이벤트가 없습니다(HKX 원본을 지정하면 읽습니다).')}
              </small>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
