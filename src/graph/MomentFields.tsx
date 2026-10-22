import {useMemo, useState} from 'react';
import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {clipEffects, setClipEffects} from '../clipEffects.ts';
import {
  actionClip,
  clipCapable,
  clipToEvent,
  eventToClip,
  fmt,
  hkxMoments,
  moveFunction,
  sentEvents,
  type CommandMoment,
  type RegistryMoment,
} from './hkxMoments.ts';
import {EffectDetails} from '../ui/details/EffectDetails.tsx';
import {NotifyDetails} from '../timeline/Details.tsx';
import {GraphDetails} from './GraphDetails.tsx';
import type {FlatNode} from './flat.ts';
import {useClipAnnotations, clipDurations, clipKey, roleLabel} from './annotations.ts';
import {renderedRegistry} from './renderCache.ts';
import {showRegistry} from './RegistryCard.tsx';
import {eventKey, functionParts, opInfo, setFunctions, type EventOp} from '../eventRegistry.ts';
import {tr} from '../i18n/korean.ts';

// The HKX card's moment items edit in place (10-23, docs/mockup-inline-moments): no "이벤트 편집" dialog. A moment
// is a clip time (XML <Do at>), an event (a registered function, global) or an HKX annotation command (AI.,
// read only).

type Edit = (fn: (w: Workspace) => Workspace) => void;

function WhenSwitch({
  clip,
  disabled,
  choose,
}: {
  clip: boolean;
  disabled?: {clip?: string; event?: string};
  choose: (clip: boolean) => void;
}) {
  return (
    <div className="moment-line">
      <span className="moment-label">{tr('시점')}</span>
      <span className="moment-seg" role="group" aria-label={tr('시점')}>
        <button
          type="button"
          aria-pressed={clip}
          disabled={!clip && !!disabled?.clip}
          title={disabled?.clip}
          onClick={() => !clip && choose(true)}
        >
          {tr('클립 시각')}
        </button>
        <button
          type="button"
          aria-pressed={!clip}
          disabled={clip && !!disabled?.event}
          title={disabled?.event}
          onClick={() => clip && choose(false)}
        >
          {tr('이벤트')}
        </button>
      </span>
    </div>
  );
}

/** A clip-time function: its time (with the clip's length as a bar), then its settings. */
function ClipEffectFields({w, action, effect, edit}: {w: Workspace; action: Action; effect: Effect; edit: Edit}) {
  const clip = actionClip(w, action);
  const annotations = useClipAnnotations(w).get(clipKey(clip));
  const length = clipDurations(w).get(clipKey(clip));
  const events = useMemo(() => sentEvents(annotations, !!action.pair), [annotations, action.pair]);
  const change = (next: Effect) =>
    edit(w => {
      const a = structuredClone(w.actions.find(x => x.uid === action.uid)!);
      setClipEffects(
        a,
        clipEffects(a).map(e => (e.id === next.id ? next : e))
      );
      return putAction(w, a);
    });
  const at = Number(effect.values.at ?? 0);
  const others = clipEffects(action)
    .filter(e => e.id !== effect.id)
    .map(e => Number(e.values.at ?? 0));
  return (
    <div className="moment-fields">
      <WhenSwitch
        clip
        disabled={{
          event: events.length ? undefined : tr('이 HKX가 보내는 이벤트가 없습니다(HKX 원본을 연결하면 보입니다).'),
        }}
        choose={() => edit(w => clipToEvent(w, action.uid, effect.id, events[0].name))}
      />
      <div className="moment-line">
        <label className="moment-label" htmlFor={`at-${action.uid}-${effect.id}`}>
          {tr('시각')}
        </label>
        <span className="moment-inline">
          <input
            id={`at-${action.uid}-${effect.id}`}
            type="number"
            min={0}
            max={length ?? 600}
            step={0.001}
            value={effect.values.at ?? '0'}
            onChange={e => change({...effect, values: {...effect.values, at: e.target.value || '0'}})}
          />
          <span className="moment-unit">{tr('초 · 클립 시작부터')}</span>
        </span>
      </div>
      {length !== undefined && (
        <div
          className="moment-ruler"
          title={tr('눌러서 시각 옮기기')}
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const t = Math.min(length, Math.max(0, ((e.clientX - r.left) / r.width) * length));
            change({...effect, values: {...effect.values, at: fmt(t)}});
          }}
        >
          {others.map((t, i) => (
            <span key={i} className="other" style={{left: `${Math.min(100, (t / length) * 100)}%`}} />
          ))}
          <span className="me" style={{left: `${Math.min(100, Math.max(0, (at / length) * 100))}%`}} />
          <span className="len">
            {fmt(length)}
            {tr('초')}
          </span>
        </div>
      )}
      <EffectDetails effect={effect} timeline pair={!!action.pair} self={!action.pair} change={change} />
    </div>
  );
}

/** A moment item's fields in the card: a clip-time function's own layout; the camera restore, the carry's moments
 *  and a pair's windows keep their detail fields, now in place. */
export function MomentFields({
  w,
  action,
  node,
  edit,
  status,
  globalSettings,
}: {
  w: Workspace;
  action: Action;
  node: FlatNode;
  edit: Edit;
  status: (s: string) => void;
  globalSettings: () => void;
}) {
  const effect = node.notify?.startsWith('effect:')
    ? clipEffects(action).find(e => 'effect:' + e.id === node.notify)
    : undefined;
  if (effect) return <ClipEffectFields w={w} action={action} effect={effect} edit={edit} />;
  if (node.notify) return <NotifyDetails w={w} action={action} id={node.notify} edit={edit} />;
  return (
    <GraphDetails
      w={w}
      graph={node.scope}
      node={node.original}
      edit={edit}
      status={status}
      open={() => {}}
      selectedAsset=""
      onGlobalSettings={globalSettings}
    />
  );
}

// ── what this HKX sends: registered functions and annotation commands ───────────────────────────
/** The registered functions of the events this action's HKX sends, and its AI. annotation commands. */
export function useHkxMoments(w: Workspace, action: Action | undefined) {
  const clip = action ? actionClip(w, action) : '';
  const annotations = useClipAnnotations(w).get(clipKey(clip));
  return useMemo(() => hkxMoments(w, action, annotations), [w, action, annotations]);
}
const Roles = ({roles}: {roles: Set<'initiator' | 'receiver'>}) => (
  <>
    {[...roles].map(r => (
      <span key={r} className={'moment-role ' + r}>
        {roleLabel[r]}
      </span>
    ))}
  </>
);

/** A registered function of an event this HKX sends: edited in place, but it is the registry's (global). */
export function RegistryMomentRow({
  w,
  action,
  item,
  edit,
}: {
  w: Workspace;
  action: Action;
  item: RegistryMoment;
  edit: Edit;
}) {
  const [open, setOpen] = useState(false);
  const clip = actionClip(w, action);
  const annotations = useClipAnnotations(w).get(clipKey(clip));
  const events = useMemo(() => sentEvents(annotations, !!action.pair), [annotations, action.pair]);
  const name = opInfo[item.fn.values.op as EventOp]?.label ?? item.fn.values.op;
  const times = item.sent.times.map(t => fmt(t) + tr('초')).join(' · ');
  const senders = renderedRegistry(w).find(e => eventKey(e.name) === eventKey(item.event))?.uses.length ?? 0;
  const change = (next: Effect) =>
    edit(w => {
      const row = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(item.event));
      return row
        ? setFunctions(
            w,
            row.name,
            row.functions.map(f => (f.id === next.id ? next : f))
          )
        : w;
    });
  return (
    <div className="checklist-row moment registry-moment">
      <div className="checklist-row-heading">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{name}</span>
          <small title={item.event}>{item.event}</small>
          <span className="moment-global">{tr('전역')}</span>
          <span>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      <div className="moment-sub">
        {[...functionParts(item.fn.values), tr('이 HKX {t}에 보냄', {t: times}), tr('보낸 액터에게')].join(' · ')}
      </div>
      {open && (
        <div className="checklist-fields moment-fields">
          <WhenSwitch
            clip={false}
            disabled={{
              clip: clipCapable(action, item.fn.values.op)
                ? undefined
                : tr('이 기능은 이 동작의 클립 시각에 둘 수 없습니다.'),
            }}
            choose={() => edit(w => eventToClip(w, action.uid, item.event, item.fn.id, item.sent.times[0] ?? 0))}
          />
          <div className="moment-line">
            <label className="moment-label" htmlFor={`ev-${item.key}`}>
              {tr('이벤트')}
            </label>
            <select
              id={`ev-${item.key}`}
              value={eventKey(item.event)}
              onChange={e => {
                const to = events.find(x => eventKey(x.name) === e.target.value)?.name;
                if (to) edit(w => moveFunction(w, item.event, item.fn.id, to));
              }}
            >
              {events.map(x => (
                <option key={eventKey(x.name)} value={eventKey(x.name)}>
                  {x.name} · {x.times.map(t => fmt(t)).join(', ')}
                  {tr('초')}
                </option>
              ))}
            </select>
          </div>
          <EffectDetails effect={item.fn} timeline registry change={change} />
          <p className="moment-note global">
            {tr(
              '이벤트 등록의 기능입니다. 고치면 {event}을 보내는 모든 애니메이션에 적용됩니다(이 프로젝트에서 이 이벤트를 쓰는 곳 {n}개).',
              {event: item.event, n: senders}
            )}
          </p>
          <div className="checklist-row-actions">
            <button onClick={() => showRegistry(item.event)}>{tr('이벤트 등록에서 보기')}</button>
            <button
              onClick={() =>
                edit(w => {
                  const row = w.eventRegistry?.find(r => eventKey(r.name) === eventKey(item.event));
                  return row
                    ? setFunctions(
                        w,
                        row.name,
                        row.functions.filter(f => f.id !== item.fn.id)
                      )
                    : w;
                })
              }
            >
              {tr('등록에서 삭제')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** An AI. annotation command of this HKX: shown, never edited (it lives in the HKX). */
export function CommandMomentRow({item}: {item: CommandMoment}) {
  const [open, setOpen] = useState(false);
  const times = item.rows.map(r => fmt(r.time)).join(' · ');
  const one = item.rows.length === 1 ? item.rows[0] : undefined;
  return (
    <div className={'checklist-row moment annotation-moment' + (item.bad.length && !item.rows.length ? ' bad' : '')}>
      <div className="checklist-row-heading">
        <span
          className="moment-lock"
          title={tr('HKX 주석에서 만든 항목입니다. 끄거나 고치려면 HKX의 주석을 고치세요.')}
        >
          {tr('HKX 주석')}
        </span>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{item.rows.length ? item.label : tr('알 수 없는 주석 명령')}</span>
          <small>{item.rows.length ? times + tr('초') : item.bad.map(b => fmt(b.time)).join(' · ') + tr('초')}</small>
          <span>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {item.rows.length > 0 && (
        <div className="moment-sub">
          {one
            ? tr('세기 {s} · {d}초', {s: one.strength, d: one.duration})
            : tr('{n}곳 · 시점마다 세기·시간', {n: item.rows.length})}
        </div>
      )}
      {open && (
        <div className="checklist-fields moment-fields">
          {item.rows.length > 0 && (
            <table className="moment-table">
              <thead>
                <tr>
                  <th>{tr('시각')}</th>
                  <th>{tr('보내는 쪽')}</th>
                  <th>{tr('세기')}</th>
                  <th>{tr('시간')}</th>
                </tr>
              </thead>
              <tbody>
                {item.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {fmt(r.time)}
                      {tr('초')}
                    </td>
                    <td>
                      <Roles roles={r.roles} />
                    </td>
                    <td>{r.strength}</td>
                    <td>
                      {r.duration}
                      {tr('초')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {item.bad.map((b, i) => (
            <p key={i} className="moment-note warn">
              {fmt(b.time)}
              {tr('초')} <code>{b.text}</code> ·{' '}
              {tr('실행되지 않습니다. AI.CamShake|세기|시간 형식으로 숫자를 모두 적어야 합니다.')}
            </p>
          ))}
          <p className="moment-note">
            {tr('HKX 파일 안의 주석에서 만든 항목입니다. 끄거나 값을 바꾸려면 HKX_Edit에서 주석을 고치세요.')}
          </p>
        </div>
      )}
    </div>
  );
}
