import type {Effect} from '../../workspace.ts';
import {operations} from '../../workspace.ts';
import {
  eventOps,
  pairRoles,
  pairRoleLabels,
  opInfo,
  fieldsOf,
  settingDefault,
  settingLabels,
  settingRange,
  arrowModes,
  isBooleanSetting,
  ragdollDirections,
  ragdollForce,
  ragdollLabels,
  type EventOp,
} from '../../eventRegistry.ts';
import type {LabelId} from '../../labels.ts';
import {t} from '../../i18n/index.ts';
import {Property as Prop} from './Property.tsx';
import {DetailCategory as Category, DetailRow} from './DetailRow.tsx';
import {tr} from '../../i18n/korean.ts';

const advanced = ['delay'];
/**
 * One function's settings: a registered event's (`registry`), or a pair's clip-time effect (with its
 * time unless the timeline edits it). Values are strings like the XML; defaults are left unset.
 */
export function EffectDetails({
  effect,
  change,
  timeline = false,
  registry = false,
  self = false,
  pair = false,
}: {
  effect: Effect;
  change: (e: Effect) => void;
  timeline?: boolean;
  registry?: boolean;
  /** An ordinary action's clip-time function (runtime 0.12.274): on the actor playing it, no target. */
  self?: boolean;
  /** A pair's clip-time effect (runtime 0.12.275): one 적용 choice, for a function that changes an actor. */
  pair?: boolean;
}) {
  const v = effect.values,
    set = (key: string, value: string | undefined) => {
      const values = {...v};
      if (value === undefined) delete values[key];
      else values[key] = value;
      change({...effect, values});
    };
  const info = opInfo[v.op as EventOp];
  const field = (key: string) => {
    const id = key as LabelId;
    if (isBooleanSetting(key))
      return (
        <Prop
          key={key}
          id={id}
          value={(v[key] ?? settingDefault[key] ?? 'false') === 'true'}
          initial={(settingDefault[key] ?? 'false') === 'true'}
          change={value => set(key, String(value))}
        />
      );
    if (key === 'plugin' || key === 'form')
      return <Prop key={key} id={id} value={v[key] ?? ''} change={value => set(key, value || undefined)} />;
    if (key === 'damage' && v.mode !== 'direct') return null;
    // A ragdoll's direction picks where the push comes from; its force defaults by direction (runtime 0.12.278).
    if (key === 'direction')
      return (
        <DetailRow key={key} label={settingLabels.direction}>
          <span className="moment-seg" role="group" aria-label={settingLabels.direction}>
            {ragdollDirections.map(d => (
              <button
                key={d}
                type="button"
                aria-pressed={(v.direction ?? 'down') === d}
                onClick={() => set('direction', d === 'down' ? undefined : d)}
              >
                {ragdollLabels[d]}
              </button>
            ))}
          </span>
        </DetailRow>
      );
    if (key === 'force') {
      const def = ragdollForce[v.direction ?? 'down'] ?? 1;
      return (
        <Prop
          key={key}
          id={id}
          label={settingLabels.force}
          value={v.force === undefined ? def : Number(v.force)}
          initial={def}
          max={20}
          change={value => set('force', value === def ? undefined : String(value))}
        />
      );
    }
    if (key === 'mode')
      return (
        <Prop
          key={key}
          id="kind"
          label={settingLabels.mode}
          value={v.mode === 'direct' ? 'direct' : ''}
          change={value => {
            const values = {...v};
            if (value) values.mode = value;
            else {
              delete values.mode;
              delete values.damage;
            }
            change({...effect, values});
          }}
          options={arrowModes()}
        />
      );
    const [, max] = settingRange(key) ?? [0, 600],
      def = Number(settingDefault[key] ?? 0);
    return (
      <Prop
        key={key}
        id={id}
        label={settingLabels[key]}
        value={v[key] === undefined ? def : Number(v[key])}
        initial={def}
        max={max}
        change={value => set(key, String(value))}
      />
    );
  };
  const fields = fieldsOf(v.op);
  return (
    <>
      {!timeline && (
        <>
          <Prop
            id="kind"
            label={tr('기능')}
            value={v.op}
            change={op => set('op', op)}
            options={(registry ? eventOps : operations).map(op => [op, opInfo[op].label])}
          />
          {!registry && (
            <DetailRow label={t('time.afterStart')} hint={t('detail.effectTimeHint')}>
              <input
                type="number"
                min={0}
                max={600}
                step={0.05}
                value={v.at ?? ''}
                onChange={e => set('at', e.target.value || undefined)}
              />
            </DetailRow>
          )}
        </>
      )}
      {/* A registered event's function changes its sender (0.12.273) and an ordinary action's the actor playing it;
          a pair's clip time has no sender, so a function that changes an actor names the role (0.12.275). A
          player-only one (shake, time) runs when the player is in the pair. */}
      {pair && !registry && !self && !info?.player && (
        <Prop
          id="receiver"
          label={tr('적용')}
          value={v.target ?? 'both'}
          change={value => set('target', value === 'both' ? undefined : value)}
          options={pairRoles.map(x => [x, pairRoleLabels[x]])}
        />
      )}
      {fields.filter(k => !advanced.includes(k)).map(field)}
      {info?.lasting && (
        <p
          className="effect-note"
          title={tr('짝 기능 "{pair}", 이 동작의 종료, 사망·래그돌·불러오기 때 해제됩니다.', {
            pair: opInfo[info.lasting].label,
          })}
        >
          {tr('해제: {pair} · 동작 끝', {pair: opInfo[info.lasting].label})}
        </p>
      )}
      {info?.player && (
        <p className="effect-note player">
          <span className="moment-tag" title={tr('플레이어에게만 적용됩니다.')}>
            {tr('플레이어만')}
          </span>
        </p>
      )}
      <Category title={t('row.advanced')}>{advanced.map(field)}</Category>
    </>
  );
}
