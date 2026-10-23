import type {ReactNode} from 'react';
import {isRecovery, recoveryRule, setRecoveryRule} from '../clipRecovery.ts';
import type {Workspace, Action} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {timelineRows as rows, patch, trackOf, tracks, assignTrack, remove} from './model.ts';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {sentEvent} from '../graph/annotations.ts';
import {pairRoles, pairRoleLabels} from '../eventRegistry.ts';
import {GraphDetails} from '../graph/GraphDetails.tsx';
import type {Meta} from './model.ts';
import {DetailPanel, DetailCategory, DetailRow} from '../ui/details/DetailRow.tsx';
import {Property as Prop} from '../ui/details/Property.tsx';
import {TimeField} from '../ui/details/TimeField.tsx';
import {EffectDetails} from '../ui/details/EffectDetails.tsx';
import {t} from '../i18n/index.ts';
import {tr} from '../i18n/korean.ts';
export function NotifyDetails({
  w,
  action,
  id,
  edit,
  meta,
  card = false,
  timing = false,
}: {
  w: Workspace;
  action: Action;
  id: string;
  edit: (fn: (w: Workspace) => Workspace) => void;
  meta?: Meta;
  /** In the HKX card (docs/mockup-moment-timing): no 유형 (the row's title), 트랙 (the timeline's) or delete of its own
   *  (the row has one), and no inner title. */
  card?: boolean;
  /** The card shows the item's times above (graph/MomentFields.tsx TimingFields): not again here. */
  timing?: boolean;
}) {
  const row = rows(w, action).find(r => r.id === id);
  if (!row) return <p>{t('graph.selectNode')}</p>;
  if (id === 'runtime:cameraRestore')
    return (
      <GraphDetails
        w={w}
        graph={{kind: 'anim', action: action.uid}}
        node="cameraRestore"
        edit={edit}
        status={() => {}}
        open={() => {}}
        selectedAsset=""
        onGlobalSettings={() => {}}
      />
    );
  const change = (a: Action) => edit(w => putAction(w, a));
  const p = action.config,
    pair = action.pair,
    pt = id.startsWith('pair:') && pair ? pair.timeline[id.slice(5) as keyof typeof pair.timeline] : undefined;
  const pp = (v: object) => {
    if (pair && pt) change({...action, pair: {...pair, timeline: {...pair.timeline, [id.slice(5)]: {...pt, ...v}}}});
  };
  // Windows, recovery, vanilla cancels and the carry release may wait for an event; features, costs,
  // shots and pair effects run at clip times (format 3: event moments are registry functions).
  const eventAllowed =
    !!row.transition || row.kind === 'vanillaCancel' || isRecovery(id) || id === 'runtime:carryRelease';
  const bases = (k: 'from' | 'until'): ('seconds' | 'event' | 'end')[] =>
    eventAllowed
      ? k === 'until' && !pair
        ? ['seconds', 'event', 'end']
        : ['seconds', 'event']
      : k === 'until' && !pair
        ? ['seconds', 'end']
        : ['seconds'];
  const events = [
    ...new Set([
      ...markerNames(w),
      ...(meta?.annotations.flatMap(n => {
        const e = sentEvent(n.text, !!pair);
        return e ? [e.name] : [];
      }) ?? []),
    ]),
  ];
  const wrap = (body: ReactNode) =>
    card ? (
      <div className="moment-rest">{body}</div>
    ) : (
      <DetailPanel>
        <DetailCategory title={t('timeline.track')} initialOpen>
          {body}
        </DetailCategory>
      </DetailPanel>
    );
  return wrap(
    <>
      {!card && (
        <DetailRow id="kind">
          <span>{row.label}</span>
        </DetailRow>
      )}
      {id.startsWith('cancel:') &&
        (() => {
          const c = action.cancels.find(c => c.id === id.slice(7))!;
          const update = (values: object) =>
            change({...action, cancels: action.cancels.map(x => (x.id === c.id ? {...x, ...values} : x))});
          return (
            <>
              <DetailRow label={tr('전환 대상')}>
                <input aria-label={tr('전환 대상')} value={c.to} onChange={e => update({to: e.target.value})} />
              </DetailRow>
              <DetailRow
                label="ID"
                hint={tr(
                  'XML의 Cancel id입니다. 런타임 창 이벤트 이름(AI_<동작>_<ID>Open/Close)에 쓰입니다. 비우면 자동 이름({id})을 씁니다.',
                  {id: c.id}
                )}
              >
                <input
                  aria-label="ID"
                  placeholder={c.id}
                  value={c.xmlId ?? ''}
                  onChange={e => {
                    const xmlId = e.target.value.trim();
                    const {xmlId: _, ...rest} = c;
                    change({
                      ...action,
                      cancels: action.cancels.map(x => (x.id === c.id ? (xmlId ? {...rest, xmlId} : rest) : x)),
                    });
                  }}
                />
              </DetailRow>
              <DetailRow
                label={tr('항상 열림')}
                hint={tr(
                  '클립 전체에서 전환을 허용합니다(시각·선입력 없음). 끄면 열림·닫힘 시각으로 정한 구간에서만 허용합니다.'
                )}
              >
                <input
                  aria-label={tr('항상 열림')}
                  type="checkbox"
                  checked={!!c.always}
                  onChange={e => {
                    const {always: _, ...rest} = c;
                    change({
                      ...action,
                      cancels: action.cancels.map(x =>
                        x.id === c.id ? (e.target.checked ? {...rest, always: true as const} : rest) : x
                      ),
                    });
                  }}
                />
              </DetailRow>
              {!c.always && (
                <DetailRow label={tr('선입력')}>
                  <input
                    aria-label={tr('선입력')}
                    type="checkbox"
                    checked={c.buffered}
                    onChange={e => update({buffered: e.target.checked})}
                  />
                </DetailRow>
              )}
              <DetailRow label={tr('블렌드 재정의')}>
                <input
                  aria-label={tr('블렌드 재정의')}
                  type="checkbox"
                  checked={c.blend !== null}
                  onChange={e => update({blend: e.target.checked ? 0.1 : null})}
                />
                {c.blend !== null && (
                  <input
                    aria-label={tr('캔슬 블렌드')}
                    type="number"
                    min="0"
                    max="5"
                    step="0.05"
                    value={c.blend}
                    onChange={e => update({blend: Number(e.target.value)})}
                  />
                )}
              </DetailRow>
            </>
          );
        })()}
      {!card && (
        <DetailRow label={t('timeline.trackLabel')}>
          <select
            value={trackOf(w, action.uid, id)}
            onChange={e => edit(w => assignTrack(w, action.uid, id, Number(e.target.value)))}
          >
            {tracks(w, action.uid).map(n => (
              <option key={n} value={n}>
                {t('timeline.track')} {n}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {id === 'rotate' && !pair && (
        <DetailRow label={tr('회전 방식')} hint={t('tip.rotationRecovery')}>
          <select
            aria-label={tr('회전 방식')}
            value={p.rotationLocked ? 'locked' : 'window'}
            onChange={e =>
              change({
                ...action,
                config: {
                  ...p,
                  rotationLocked: e.target.value === 'locked',
                  slots: {...p.slots, rotate: {...p.slots.rotate, enabled: true}},
                },
              })
            }
          >
            <option value="window">{tr('구간 허용')}</option>
            <option value="locked">{tr('전 구간 금지')}</option>
          </select>
        </DetailRow>
      )}
      {(['from', 'until'] as const)
        .filter(
          k =>
            !timing &&
            !!row[k] &&
            !(id === 'rotate' && p.rotationLocked) &&
            !(id.startsWith('cancel:') && action.cancels.find(c => c.id === id.slice(7))?.always)
        )
        .map(k => (
          <DetailRow
            key={k}
            id={k === 'from' ? 'open' : 'close'}
            hint={
              pair && id === 'recovery'
                ? tr(
                    '시작자의 HKX 시각·이벤트 이후 이동 입력으로 양쪽 페어를 종료합니다. 미리 누른 이동키도 인식하며, 운반이 연결되어 있으면 취소 순간의 상대 위치·방향을 유지해 운반으로 전환합니다.'
                  )
                : undefined
            }
          >
            <TimeField
              label={t(k === 'from' ? 'row.open' : 'row.close')}
              value={row[k]!}
              change={v => edit(w => patch(w, action.uid, id, {[k]: v}))}
              bases={bases(k)}
              events={events}
            />
          </DetailRow>
        ))}
      {pt && (
        <>
          <Prop
            id="receiver"
            label={tr('적용')}
            value={pt.role}
            change={role => pp({role})}
            options={pairRoles.map(r => [r, pairRoleLabels[r]])}
          />
        </>
      )}
      {row.kind === 'cost' &&
        !row.effect &&
        (['stamina', 'magicka'] as const).map(k => (
          <Prop
            key={k}
            id={k}
            value={pt?.[k] ?? p.cost[k]}
            min={0}
            max={100000}
            change={v => (pt ? pp({[k]: v}) : change({...action, config: {...p, cost: {...p.cost, [k]: v}}}))}
          />
        ))}
      {isRecovery(id) && (
        <Prop
          id="blend"
          hint={t('tip.recoveryBlend')}
          value={recoveryRule(p, id)!.blend}
          min={0}
          max={5}
          change={blend => {
            const next = structuredClone(action);
            setRecoveryRule(next.config, id, {...recoveryRule(p, id)!, blend});
            change(next);
          }}
        />
      )}
      {row.group && pair && (
        <EffectDetails
          timeline
          pair
          effect={row.group.on}
          change={e =>
            change({
              ...action,
              pair: {
                ...pair,
                effects: pair.effects.map(x =>
                  x.id === e.id
                    ? e
                    : x.id === row.group!.off.id
                      ? {...x, values: {...x.values, target: e.values.target}}
                      : x
                ),
              },
            })
          }
        />
      )}
      {row.effect && pair && (
        <EffectDetails
          effect={row.effect}
          timeline
          pair
          change={e => change({...action, pair: {...pair, effects: pair.effects.map(x => (x.id === e.id ? e : x))}})}
        />
      )}
      {row.effect && !pair && (
        <EffectDetails
          effect={row.effect}
          timeline
          self
          change={e =>
            change({
              ...action,
              config: {...p, effects: (p.effects ?? []).map(x => (x.id === e.id ? e : x))},
            })
          }
        />
      )}
      {!card && <button onClick={() => edit(w => remove(w, action.uid, id))}>{t('timeline.remove')}</button>}
    </>
  );
}
