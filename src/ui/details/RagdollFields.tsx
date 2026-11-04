import {useContext, useEffect, useRef, useState} from 'react';
import {useReactFlow} from '@xyflow/react';
import {RagdollPreviewContext} from '../ragdollPreviewContext.ts';
import type {Ragdoll, RagdollBody, RagdollMotion} from '../../ragdoll.ts';
import {appDefaultRagdoll, ragdollRanges} from '../../ragdoll.ts';
import {boneOptions, rigBoneOptions} from '../../carry.ts';
import {DetailRow} from './DetailRow.tsx';
import {BonePicker} from './BonePicker.tsx';
import {tr} from '../../i18n/korean.ts';
import {isPairedRig, pairedRig} from '../../pairedRigs.ts';

type Range = readonly [number, number];
const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v));

/** A slider and a number box for one value. */
function Slider({
  label,
  value,
  range,
  step,
  change,
}: {
  label: string;
  value: number;
  range: Range;
  step: number;
  change: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="ragdoll-slider">
      <input
        type="range"
        aria-label={label}
        min={range[0]}
        max={range[1]}
        step={step}
        value={value}
        onChange={e => change(Number(e.target.value))}
      />
      <input
        type="number"
        aria-label={label}
        min={range[0]}
        max={range[1]}
        step={step}
        value={draft ?? String(value)}
        onChange={e => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(v)) change(clamp(v, range));
        }}
        onBlur={() => setDraft(null)}
      />
    </span>
  );
}

/** A number that may be left empty (null: the shared or native value, shown as the placeholder). */
function Optional({
  label,
  value,
  range,
  step,
  empty,
  change,
}: {
  label: string;
  value: number | null;
  range: Range;
  step: number;
  empty: string;
  change: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="ragdoll-optional"
      type="number"
      aria-label={label}
      min={range[0]}
      max={range[1]}
      step={step}
      placeholder={empty}
      value={draft ?? (value === null ? '' : String(value))}
      onChange={e => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (!e.target.value.trim()) change(null);
        else if (Number.isFinite(v)) change(clamp(v, range));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function OptionalPair({
  label,
  value,
  limit,
  change,
}: {
  label: string;
  value: [number, number] | null;
  limit: number;
  change: (v: [number, number] | null) => void;
}) {
  const range = [-limit, limit] as const;
  const set = (i: 0 | 1, v: number | null) => {
    if (v === null) return change(null);
    const next: [number, number] = value ? [...value] : [-limit, limit];
    next[i] = v;
    if (next[0] > next[1]) next[1 - i] = v;
    change(next);
  };
  return (
    <span className="ragdoll-pair">
      <Optional
        label={label + ' ' + tr('최소')}
        value={value?.[0] ?? null}
        range={range}
        step={1}
        empty={tr('바닐라')}
        change={v => set(0, v)}
      />
      <span>~</span>
      <Optional
        label={label + ' ' + tr('최대')}
        value={value?.[1] ?? null}
        range={range}
        step={1}
        empty={tr('바닐라')}
        change={v => set(1, v)}
      />
    </span>
  );
}

/** The canvas zoom a body row is shown at when it is picked in the 3D view: rows 32 px apart at zoom 1 come out
 *  about 43 px apart, as in the user's screenshot (11-04). */
const REVEAL_ZOOM = 1.35;

const motionRows: [keyof RagdollMotion, () => string, () => string, number][] = [
  [
    'follow',
    () => tr('따라가기'),
    () => tr('운반자의 속도가 바뀔 때 몸에 바로 주는 몫입니다. 1이면 충격 없이 따라옵니다.'),
    0.05,
  ],
  ['gravity', () => tr('중력'), () => tr('중력 배율(1~4)입니다. 1 = 게임 중력.'), 0.1],
  [
    'drag',
    () => tr('공기 저항'),
    () => tr('흔들림이 가라앉는 정도(선 감쇠, 0~10)입니다. 게임 값보다 작아지지 않습니다(0 = 게임 값).'),
    0.1,
  ],
  [
    'spin',
    () => tr('회전 저항'),
    () => tr('돌아가는 흔들림이 가라앉는 정도(각 감쇠, 0~10)입니다. 게임 값보다 작아지지 않습니다(0 = 게임 값).'),
    0.1,
  ],
  ['inertia', () => tr('관성'), () => tr('회전 관성 배율(1~10)입니다. 질량은 그대로입니다.'), 0.1],
];

/** One body: the simulate check, its name, and its own values behind ⋯. */
function BodyRow({
  body,
  label,
  selected,
  select,
  open,
  toggle,
  change,
  swingOptions,
}: {
  body: RagdollBody;
  label?: string;
  /** Selected in the 3D view's simulation (selecting the row selects it there too). */
  selected: boolean;
  select: () => void;
  open: boolean;
  toggle: () => void;
  change: (b: RagdollBody) => void;
  swingOptions: ReturnType<typeof rigBoneOptions>;
}) {
  const field = (key: 'drag' | 'spin' | 'gravity' | 'inertia' | 'friction', name: string, step: number) => (
    <DetailRow label={name}>
      <Optional
        label={(label ?? body.bone) + ' ' + name}
        value={body[key]}
        range={ragdollRanges[key]}
        step={step}
        empty={tr('전체 값')}
        change={v => change({...body, [key]: v})}
      />
    </DetailRow>
  );
  return (
    <>
      <div className={'ragdoll-body' + (selected ? ' selected' : '')} data-bone={body.bone}>
        <input
          type="checkbox"
          checked={body.simulate}
          title={tr(
            '물리로 흔들림. 끄면 스스로 흔들리지 않고, 위 몸체가 흔들리면 그 관절을 처음 각도로 고정해 함께 움직입니다.'
          )}
          aria-label={(label ?? body.bone) + ' ' + tr('물리로 흔들림')}
          onChange={e => change({...body, simulate: e.target.checked})}
        />
        <span className="ragdoll-name" onClick={select}>
          {label && <span>{label}</span>}
          <code>{body.bone}</code>
        </span>
        <button
          type="button"
          className="ragdoll-more"
          aria-expanded={open}
          title={tr('이 몸체만의 값')}
          onClick={toggle}
        >
          ⋯
        </button>
      </div>
      {open && (
        <div className="ragdoll-joint">
          {field('drag', tr('공기 저항'), 0.1)}
          {field('spin', tr('회전 저항'), 0.1)}
          {field('gravity', tr('중력'), 0.1)}
          {field('inertia', tr('관성'), 0.1)}
          {field('friction', tr('관절 마찰'), 1)}
          <DetailRow label={tr('원뿔 제한 (도)')}>
            <Optional
              label={(label ?? body.bone) + ' ' + tr('원뿔 제한')}
              value={body.cone}
              range={ragdollRanges.cone}
              step={1}
              empty={tr('바닐라')}
              change={cone => change({...body, cone})}
            />
          </DetailRow>
          <DetailRow label={tr('평면 제한 (도)')}>
            <OptionalPair
              label={tr('평면 제한')}
              value={body.plane}
              limit={90}
              change={plane => change({...body, plane})}
            />
          </DetailRow>
          <DetailRow label={tr('비틀림 제한 (도)')}>
            <OptionalPair
              label={tr('비틀림 제한')}
              value={body.twist}
              limit={180}
              change={twist => change({...body, twist})}
            />
          </DetailRow>
          <DetailRow
            label={tr('관절 축')}
            hint={tr(
              '이 몸체와 위 몸체 사이의 몸체 없는 뼈입니다. 관절 축을 그 뼈로 옮기고 그 뼈를 함께 돌립니다. 비우면 바닐라 관절입니다.'
            )}
          >
            <BonePicker
              label={(label ?? body.bone) + ' ' + tr('관절 축')}
              value={body.swingFrom}
              options={swingOptions}
              empty={tr('바닐라 (위 몸체와의 관절)')}
              change={swingFrom => change({...body, swingFrom})}
            />
          </DetailRow>
        </div>
      )}
    </>
  );
}

/** The carry's ragdoll values (docs/mockup-carry-ragdoll, 11-04): vanilla (no file), or the lift action's
 *  own file beside the XML with every value. */
export function RagdollFields({
  ragdoll,
  rig,
  liftId,
  uid,
  change,
}: {
  ragdoll: Ragdoll | null;
  rig: string;
  liftId: string;
  /** The lift action: the 3D view's simulation shows it. */
  uid: string;
  change: (r: Ragdoll | null) => void;
}) {
  const simulation = useContext(RagdollPreviewContext);
  const watching = simulation.active === uid;
  const host = useRef<HTMLDivElement>(null),
    {screenToFlowPosition, setCenter} = useReactFlow();
  const [open, setOpen] = useState<string | null>(null);
  // A body picked in the 3D view: its row in this card goes to the middle of the canvas at a readable zoom
  // (11-04). Only the card on the canvas does it (the details panel shows the same fields).
  useEffect(() => {
    if (!simulation.reveal || !watching) return;
    const frame = requestAnimationFrame(() => {
      const element = host.current;
      if (!element?.closest('.react-flow__node')) return;
      const row = [...element.querySelectorAll<HTMLElement>('.ragdoll-body')].find(
        r => r.dataset.bone?.toLowerCase() === simulation.selected.toLowerCase()
      );
      if (!row) return;
      const r = row.getBoundingClientRect();
      const at = screenToFlowPosition({x: r.left + r.width / 2, y: r.top + r.height / 2});
      void setCenter(at.x, at.y, {zoom: REVEAL_ZOOM, duration: 250});
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulation.reveal]);
  const base = appDefaultRagdoll(rig);
  const r = ragdoll ? {...ragdoll, rig} : null;
  const labels = new Map(boneOptions(base.bodies.map(b => b.bone)).map(o => [o.name, o.label]));
  const swingOptions = rigBoneOptions(rig);
  const setBody = (next: RagdollBody) =>
    r && change({...r, bodies: r.bodies.map(b => (b.bone === next.bone ? next : b))});
  return (
    <div className="ragdoll-fields" ref={host}>
      <div className="ragdoll-title">{tr('래그돌')}</div>
      <DetailRow
        label={tr('값')}
        hint={tr(
          '들린 대상이 물리로 흔들리는 방식입니다. 바닐라는 게임 원래 래그돌 값 그대로이고(파일 없음), 이 동작의 값은 동작 XML 옆 Ragdoll\\<동작 ID>.xml에 모든 값을 저장합니다. 게임은 들 때마다 그 파일을 다시 읽습니다.'
        )}
      >
        <div className="qte-seg" role="group" aria-label={tr('래그돌 값')}>
          <button type="button" aria-pressed={!r} onClick={() => change(null)}>
            {tr('바닐라')}
          </button>
          <button type="button" aria-pressed={!!r} onClick={() => !r && change(base)}>
            {tr('이 동작의 값')}
          </button>
        </div>
      </DetailRow>
      <div className="ragdoll-actions">
        <button
          type="button"
          className={'ragdoll-simulate' + (watching ? ' on' : '')}
          aria-pressed={watching}
          title={tr('3D 보기에서 이 운반의 래그돌을 움직여 봅니다. 값을 바꾸면 바로 따라 움직입니다.')}
          onClick={() => simulation.toggle(uid)}
        >
          {watching ? tr('● 시뮬레이션 보는 중') : tr('시뮬레이션 보기')}
        </button>
      </div>
      {!r ? (
        <div className="ragdoll-builtin">
          <div>{tr('게임 원래 래그돌 값(바닐라)으로 움직입니다. 래그돌 파일을 쓰지 않습니다.')}</div>
          <small>
            {tr('따라가기 0 · 중력·저항·관성·관절은 {rig} 스켈레톤의 게임 값 그대로 · 모든 몸체가 물리로 흔들림', {
              rig: isPairedRig(rig) ? pairedRig(rig).label : rig,
            })}
          </small>
          <div className="ragdoll-actions">
            <button type="button" onClick={() => change(base)}>
              {tr('기본값에서 시작해 고치기')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <DetailRow label="">
            <small className="ragdoll-file">{'Ragdoll\\' + (liftId || '…') + '.xml'}</small>
          </DetailRow>
          <div className="ragdoll-sub">{tr('전체 움직임')}</div>
          {motionRows.map(([key, name, hint, step]) => (
            <DetailRow key={key} label={name()} hint={hint()}>
              <Slider
                label={name()}
                value={r.motion[key] ?? 0}
                range={ragdollRanges[key]}
                step={step}
                change={v => change({...r, motion: {...r.motion, [key]: v}})}
              />
            </DetailRow>
          ))}
          <DetailRow
            label={tr('관절 마찰')}
            hint={tr('모든 관절의 마찰(0~100)입니다. 비우면 바닐라 관절 그대로입니다.')}
          >
            <Optional
              label={tr('관절 마찰')}
              value={r.motion.friction}
              range={ragdollRanges.friction}
              step={1}
              empty={tr('바닐라')}
              change={friction => change({...r, motion: {...r.motion, friction}})}
            />
          </DetailRow>
          <div className="ragdoll-sub">
            {tr('몸체 {n}개 · 체크 = 물리로 흔들림, 끄면 위 몸체에 붙어 가거나(위가 흔들릴 때) 들기 자세를 따라감', {
              n: r.bodies.length,
            })}
          </div>
          <div className="ragdoll-bodies">
            {r.bodies.map(b => (
              <BodyRow
                key={b.bone}
                body={b}
                label={labels.get(b.bone)}
                selected={watching && simulation.selected.toLowerCase() === b.bone.toLowerCase()}
                select={() => simulation.select(b.bone)}
                open={open === b.bone}
                toggle={() => setOpen(open === b.bone ? null : b.bone)}
                change={setBody}
                swingOptions={swingOptions}
              />
            ))}
          </div>
          <div className="ragdoll-actions">
            <button type="button" onClick={() => change(base)}>
              {tr('기본값으로 되돌리기')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
