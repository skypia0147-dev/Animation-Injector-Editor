import {useMemo, useState} from 'react';
import type {Action, Effect, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import type {Mark} from '../model.ts';
import {clipEffects, setClipEffects} from '../clipEffects.ts';
import {
  actionClip,
  clipToEvent,
  costToEvent,
  fmt,
  hkxMoments,
  sentEvents,
  slotOfOp,
  slotToEvent,
  type CommandMoment,
  type RegistryMoment,
  type SlotKey,
} from './hkxMoments.ts';
import {EffectDetails} from '../ui/details/EffectDetails.tsx';
import {NotifyDetails} from '../timeline/Details.tsx';
import {timelineRows, patch, slots} from '../timeline/model.ts';
import {isRecovery} from '../clipRecovery.ts';
import {ClipBar, type BarTick} from './ClipBar.tsx';
import {barToMark, barToSeconds, markToBar, type BarTime} from './clipBar.ts';
import {GraphDetails} from './GraphDetails.tsx';
import type {FlatNode} from './flat.ts';
import {useClipAnnotations, clipDurations, clipKey, roleLabel} from './annotations.ts';
import {showRegistry} from './RegistryCard.tsx';
import {
  eventKey,
  functionParts,
  needsValues,
  nodeValues,
  opInfo,
  ragdollLabels,
  registryFields,
  runValues,
  setNodeValues,
  settingLabels,
  valueFields,
  valuePart,
  type EventOp,
  type EventRow,
} from '../eventRegistry.ts';
import {tr} from '../i18n/korean.ts';
import {openedBySwitch, switchTo} from './momentOpen.ts';

// The HKX card's moment items edit in place (10-23, docs/mockup-inline-moments, docs/mockup-moment-timing): every
// item starts with 시점 [클립 | 이벤트]. A clip time is the action's own; an event is the registry's (global) for a
// clip-time function, a window, a cost and the shot, and the action's own for a move-key recovery and a vanilla
// cancel. A registered function's numbers are this node's (runtime 0.12.281, docs/mockup-event-node-values). An HKX
// annotation command (AI.) is read only.

type Edit = (fn: (w: Workspace) => Workspace) => void;

/** A moment's timing: the clip or an event. `clip` undefined: neither is chosen yet (an older 활 발사 that only shot
 *  on the button's release). */
export function WhenSwitch({
  clip,
  disabled,
  choose,
  label = tr('시점'),
}: {
  clip: boolean | undefined;
  disabled?: {clip?: string; event?: string};
  choose: (clip: boolean) => void;
  label?: string;
}) {
  return (
    <div className="moment-line">
      <span className="moment-label">{label}</span>
      <span className="moment-seg" role="group" aria-label={label}>
        <button
          type="button"
          aria-pressed={clip === true}
          disabled={clip !== true && !!disabled?.clip}
          title={disabled?.clip}
          onClick={() => clip !== true && choose(true)}
        >
          {tr('클립')}
        </button>
        <button
          type="button"
          aria-pressed={clip === false}
          disabled={clip !== false && !!disabled?.event}
          title={disabled?.event}
          onClick={() => clip !== false && choose(false)}
        >
          {tr('이벤트')}
        </button>
      </span>
    </div>
  );
}

/** The action's clip length (seconds) once its HKX is read; undefined in the browser or without a source. */
export function useClipLength(w: Workspace, action: Action | undefined) {
  // Reading the annotations also reads the length: this keeps a finished read drawing again.
  useClipAnnotations(w);
  return action ? clipDurations(w).get(clipKey(actionClip(w, action))) : undefined;
}
/** The clip bar's length and ticks: the action's HKX's annotation times (docs/mockup-clip-bar). */
export function useClipBar(w: Workspace, action: Action | undefined): {length: number | undefined; ticks: BarTick[]} {
  const length = useClipLength(w, action);
  const annotations = useClipAnnotations(w).get(clipKey(action ? actionClip(w, action) : ''));
  const ticks = useMemo(() => (annotations ?? []).map(n => ({t: n.time, name: n.text})), [annotations]);
  return {length, ticks};
}
const noEventsText = () => tr('이 HKX가 보내는 이벤트가 없습니다(HKX 원본을 연결하면 보입니다).');
function useSentEvents(w: Workspace, action: Action) {
  const annotations = useClipAnnotations(w).get(clipKey(actionClip(w, action)));
  return useMemo(() => sentEvents(annotations, !!action.pair), [annotations, action.pair]);
}

/** A clip-time function: its time on the clip bar, then its settings. */
function ClipEffectFields({w, action, effect, edit}: {w: Workspace; action: Action; effect: Effect; edit: Edit}) {
  const {length, ticks} = useClipBar(w, action);
  const events = useSentEvents(w, action);
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
  return (
    <div className="moment-fields">
      <WhenSwitch
        clip
        disabled={{event: events.length ? undefined : noEventsText()}}
        choose={() =>
          edit(w =>
            switchTo(action.uid, {event: events[0].name})(clipToEvent(w, action.uid, effect.id, events[0].name))
          )
        }
      />
      <ClipBar
        label={tr('시각')}
        length={length}
        ticks={ticks}
        at={at}
        others={clipEffects(action)
          .filter(e => e.id !== effect.id)
          .map(e => Number(e.values.at ?? 0))}
        onAt={t => change({...effect, values: {...effect.values, at: fmt(barToSeconds(t, length, at))}})}
      />
      <EffectDetails effect={effect} timeline pair={!!action.pair} self={!action.pair} change={change} />
    </div>
  );
}

// ── windows, cost, recovery and vanilla cancels (docs/mockup-moment-timing) ───────────────────────
/** Which timing layout a timeline item takes in the card; undefined keeps its own detail fields (transitions, the
 *  carry's moments, a pair's grouped effects, a rotation locked for the whole clip, a cancel open for the whole clip). */
export function timingKind(action: Action, id: string): 'slot' | 'cost' | 'recovery' | 'cancel' | undefined {
  const key = id.startsWith('pair:') ? id.slice(5) : id;
  if ((slots as readonly string[]).includes(key))
    return key === 'rotate' && !action.pair && action.config.rotationLocked ? undefined : 'slot';
  if (key === 'cost') return 'cost';
  if (isRecovery(id)) return 'recovery';
  if (id.startsWith('cancel:') && !action.cancels.find(c => c.id === id.slice(7))?.always) return 'cancel';
  return undefined;
}
const toClip = (m: Mark): Mark => ({...m, basis: 'seconds', event: '', fallback: false, fallbackBasis: 'seconds'});

function TimingFields({w, action, id, edit}: {w: Workspace; action: Action; id: string; edit: Edit}) {
  const kind = timingKind(action, id)!;
  const row = timelineRows(w, action).find(r => r.id === id);
  const {length, ticks} = useClipBar(w, action);
  const events = useSentEvents(w, action);
  if (!row) return null;
  const pair = id.startsWith('pair:');
  // A recovery's and a cancel's event is the action's own; a window's and a cost's is the registry's.
  const own = kind === 'recovery' || kind === 'cancel';
  const isEvent = own && row.from.basis === 'event';
  const set = (change: {from?: Mark; until?: Mark}) => edit(w => patch(w, action.uid, id, change));
  const choose = (clip: boolean) => {
    if (own) {
      const to = events[0]?.name;
      if (clip) set({from: toClip(row.from), ...(row.until?.basis === 'event' ? {until: toClip(row.until)} : {})});
      else if (to) set({from: {...row.from, basis: 'event', event: to, fallback: false, fallbackBasis: 'seconds'}});
      return;
    }
    if (!clip && events.length)
      edit(w =>
        switchTo(action.uid, {event: events[0].name})(
          kind === 'slot'
            ? slotToEvent(w, action.uid, id as SlotKey, events[0].name)
            : costToEvent(w, action.uid, events[0].name)
        )
      );
  };
  const ranged = kind === 'slot' || kind === 'cancel';
  // A pair's track counts from the start only; 「끝」 is the clip's length there.
  const untilMark = (m: Mark, t: BarTime) =>
    pair && typeof t !== 'number' ? {...toClip(m), seconds: barToSeconds(t, length, m.seconds)} : barToMark(m, t);
  const eventChoice = (
    <select
      aria-label={tr('이벤트')}
      value={eventKey(row.from.event)}
      onChange={e => {
        const to = events.find(x => eventKey(x.name) === e.target.value)?.name;
        if (to) set({from: {...row.from, event: to}});
      }}
    >
      {!events.some(x => eventKey(x.name) === eventKey(row.from.event)) && (
        <option value={eventKey(row.from.event)}>{row.from.event}</option>
      )}
      {events.map(x => (
        <option key={eventKey(x.name)} value={eventKey(x.name)}>
          {x.name} · {x.times.map(t => fmt(t)).join(', ')}
          {tr('초')}
        </option>
      ))}
    </select>
  );
  return (
    <div className="moment-fields">
      <WhenSwitch
        clip={!isEvent}
        disabled={{
          event: pair ? tr('페어 트랙은 클립 시각으로만 정합니다.') : events.length ? undefined : noEventsText(),
        }}
        choose={choose}
      />
      {isEvent ? (
        <>
          <div className="moment-line">
            <span className="moment-label">{kind === 'cancel' ? tr('열림 이벤트') : tr('이벤트')}</span>
            <span className="moment-inline">
              {eventChoice}
              <span
                className="moment-own"
                title={tr('이 동작이 직접 기다리는 이벤트입니다. 다른 HKX에는 영향이 없습니다.')}
              >
                {tr('이 동작만')}
              </span>
            </span>
          </div>
          {kind === 'cancel' && row.until && row.until.basis !== 'event' && (
            <ClipBar
              label={tr('닫힘')}
              length={length}
              ticks={ticks}
              at={markToBar(row.until)}
              onAt={t => set({until: untilMark(row.until!, t)})}
            />
          )}
        </>
      ) : ranged && row.until ? (
        <ClipBar
          label={tr('구간')}
          length={length}
          ticks={ticks}
          span={[markToBar(row.from), markToBar(row.until)]}
          onSpan={(from, until) =>
            set({
              from: {...toClip(row.from), seconds: barToSeconds(from, length, row.from.seconds)},
              until: untilMark(row.until!, until),
            })
          }
        />
      ) : (
        <ClipBar
          label={kind === 'recovery' ? tr('열림') : tr('시각')}
          length={length}
          ticks={ticks}
          at={markToBar(row.from)}
          onAt={t => set({from: {...toClip(row.from), seconds: barToSeconds(t, length, row.from.seconds)}})}
        />
      )}
    </div>
  );
}

/** A moment item's fields in the card: a clip-time function's own layout; a window, cost, recovery or cancel starts
 *  with its timing, then the rest of its detail fields; the camera restore and the carry's moments keep theirs. */
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
  // A clip-time function of an ordinary action or a pair alike (a pair's names its role in its settings).
  const effect = node.notify?.startsWith('effect:')
    ? clipEffects(action).find(e => 'effect:' + e.id === node.notify)
    : undefined;
  if (effect) return <ClipEffectFields w={w} action={action} effect={effect} edit={edit} />;
  if (node.notify) {
    const timed = !!timingKind(action, node.notify);
    return (
      <>
        {timed && <TimingFields w={w} action={action} id={node.notify} edit={edit} />}
        <NotifyDetails w={w} action={action} id={node.notify} edit={edit} card timing={timed} />
      </>
    );
  }
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

/** Where a registry function is shown from a card: the registry node, that event's row open. */
export const RegistryLink = ({event, text = tr('등록에서 보기')}: {event: string; text?: string}) => (
  <button type="button" className="moment-link" onClick={() => showRegistry(event)}>
    {text} ↗
  </button>
);
/** What a registry function acts with, as the registry sets it (a spell, a ragdoll's direction), read only here. */
function RegistryPart({event, values}: {event: string; values: Record<string, string>}) {
  const keys = registryFields(values.op);
  if (!keys.length) return null;
  const text =
    values.op === 'ragdoll'
      ? (ragdollLabels[values.direction ?? 'down'] ?? values.direction)
      : [values.plugin, values.form].filter(Boolean).join(' · ') || tr('등록에 마법이 없습니다');
  return (
    <div className="moment-line">
      <span className="moment-label">{values.op === 'ragdoll' ? settingLabels.direction : tr('마법')}</span>
      <span className="moment-inline">
        <code>{text}</code>
        <RegistryLink event={event} text={tr('등록에서 바꾸기')} />
      </span>
    </div>
  );
}
/** One registry function's numbers on this node, and where to copy them from another node. */
function NodeValueFields({
  w,
  action,
  row,
  fn,
  edit,
}: {
  w: Workspace;
  action: Action;
  row: EventRow;
  fn: Effect;
  edit: Edit;
}) {
  const others = w.actions.filter(x => x.uid !== action.uid && nodeValues(x, row, fn));
  return (
    <>
      <EffectDetails
        effect={{id: fn.id, values: runValues(action, row, fn)}}
        timeline
        valuesOnly
        change={next => edit(w => setNodeValues(w, action.uid, row, fn, next.values))}
      />
      {!!valueFields(fn.values.op).length && (
        <div className="moment-footer">
          <span />
          {others.length ? (
            <select
              aria-label={tr('다른 노드 값 가져오기')}
              value=""
              onChange={e => {
                const from = others.find(x => x.uid === e.target.value);
                if (from) edit(w => setNodeValues(w, action.uid, row, fn, nodeValues(from, row, fn)));
              }}
            >
              <option value="">{tr('다른 노드 값 가져오기…')}</option>
              {others.map(x => (
                <option key={x.uid} value={x.uid}>
                  {x.config.name} · {functionParts(valuePart(nodeValues(x, row, fn)!)).join(' · ') || tr('기본값')}
                </option>
              ))}
            </select>
          ) : (
            <span className="moment-note">{tr('가져올 다른 노드 값 없음')}</span>
          )}
        </div>
      )}
    </>
  );
}

/** A registered function of an event this HKX sends (docs/mockup-event-node-values): the registry decides the event
 *  and what it acts with; this node holds the numbers it runs with here. A window's on function carries its off
 *  function (docs/mockup-moment-timing). */
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
  const [open, setOpen] = useState(() => openedBySwitch(`${action.uid}|${item.key}`));
  const rowOf = (event: string) => w.eventRegistry?.find(r => eventKey(r.name) === eventKey(event));
  const row = rowOf(item.event),
    offRow = item.off ? rowOf(item.off.event) : undefined;
  if (!row) return null;
  const op = item.fn.values.op;
  const name = opInfo[op as EventOp]?.label ?? op;
  const run = runValues(action, row, item.fn);
  // A cost or a time scale runs only with this node's numbers (runtime 0.12.281).
  const missing = needsValues(op) && !nodeValues(action, row, item.fn);
  const times = (s: {times: number[]}) => s.times.map(t => fmt(t)).join(', ') + tr('초');
  return (
    <div className={'checklist-row moment registry-moment' + (missing ? ' missing' : '')}>
      <div className="checklist-row-heading">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{name}</span>
          <small title={item.event}>
            {slotOfOp(op) ? item.event + ' → ' + (item.off ? item.off.event : tr('동작 끝')) : item.event}
          </small>
          <span>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      <div className="moment-sub">
        {missing ? tr('수치를 넣으세요') : functionParts(run).join(' · ') || tr('수치 없음')}
      </div>
      {open && (
        <div className="checklist-fields moment-fields">
          <div className="moment-line">
            <span className="moment-label">{slotOfOp(op) ? tr('켜는 시점') : tr('시점')}</span>
            <span className="moment-inline">
              {tr('이벤트')} <code>{item.event}</code> <span className="moment-unit">· {times(item.sent)}</span>
              <RegistryLink event={item.event} />
            </span>
          </div>
          {slotOfOp(op) && (
            <div className="moment-line">
              <span className="moment-label">{tr('끄는 시점')}</span>
              <span className="moment-inline">
                {item.off ? (
                  <>
                    {tr('이벤트')} <code>{item.off.event}</code>{' '}
                    <span className="moment-unit">· {times(item.off.sent)}</span>
                  </>
                ) : (
                  tr('동작이 끝날 때')
                )}
              </span>
            </div>
          )}
          <RegistryPart event={item.event} values={item.fn.values} />
          <NodeValueFields w={w} action={action} row={row} fn={item.fn} edit={edit} />
          {missing && (
            <p className="moment-note warn">
              {tr('수치가 비어 있으면 이 HKX에서 {event}가 와도 실행하지 않습니다.', {event: item.event})}
            </p>
          )}
          {item.off && offRow && (
            <>
              <div className="moment-line">
                <span className="moment-label">{opInfo[item.off.fn.values.op as EventOp]?.label}</span>
              </div>
              <NodeValueFields w={w} action={action} row={offRow} fn={item.off.fn} edit={edit} />
            </>
          )}
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
