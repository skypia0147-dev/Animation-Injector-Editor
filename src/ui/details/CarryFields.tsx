import {useEffect, useState} from 'react';
import type {Action, Workspace} from '../../workspace.ts';
import {
  carryBoneLists,
  carryHand,
  carryHands,
  carryHoldPreset,
  carryHoldPresets,
  carrySummary,
  defaultCarry,
  defaultCarryFix,
  defaultCarryHold,
  putdownCandidate,
  setCarryHand,
  setPutdown,
  chooseCarryInput,
  NEW_CARRY_INPUT,
} from '../../carry.ts';
import type {Input} from '../../model.ts';
import {timingLabel} from '../../model.ts';
import {updateSharedInput} from '../../sharedSettings.ts';
import {KeyField} from './KeyField.tsx';
import {assetKey} from '../../package.ts';
import {clipSeconds} from '../../timeline/metadata.ts';
import type {CarryHold} from '../../carry.ts';
import {DetailCategory, DetailRow} from './DetailRow.tsx';
import {NumberField} from './NumberField.tsx';
import {Property as Prop} from './Property.tsx';
import {TimeField} from './TimeField.tsx';
import {BonePicker} from './BonePicker.tsx';
import {RagdollFields} from './RagdollFields.tsx';
import {t} from '../../i18n/index.ts';
import {tr} from '../../i18n/korean.ts';
import {gameControlLabel} from '../../keys.ts';
import {invoke, isTauri} from '../../backend.ts';

const keyName = (i: Input) =>
  i.control ? gameControlLabel(i.control) : i.key || (i.gamepad ? 'Pad ' + i.gamepad : tr('키 없음'));

/** The local HKX an Action's entry step plays, or ''. */
function clipPath(w: Workspace, x?: Action) {
  const step = x?.config.steps.find(s => s.id === x.config.entry) ?? x?.config.steps[0];
  return step?.localPath || (step && w.assets.find(a => assetKey(a.clip) === assetKey(step.clip))?.localPath) || '';
}
// A lift HKX's bones by actor (hkx_pair_bones), read once per file. Desktop only: the browser preview has no backend.
const pairBones = new Map<string, Promise<[string[], string[]] | null>>();
function usePairBones(path: string) {
  const [result, setResult] = useState<{path: string; bones: [string[], string[]] | null}>();
  useEffect(() => {
    if (!path || !isTauri()) return;
    let live = true,
      request = pairBones.get(path);
    if (!request) {
      request = invoke<[string[], string[]]>('hkx_pair_bones', {path}).catch(() => {
        pairBones.delete(path);
        return null;
      });
      pairBones.set(path, request);
    }
    void request.then(bones => live && setResult({path, bones}));
    return () => {
      live = false;
    };
  }, [path]);
  return result?.path === path ? result.bones : null;
}

function Segments<T extends string>({
  label,
  value,
  options,
  change,
}: {
  label: string;
  value: T | '';
  options: [T, string][];
  change: (v: T) => void;
}) {
  return (
    <div className="qte-seg" role="group" aria-label={label}>
      {options.map(([v, name]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => change(v)}>
          {name}
        </button>
      ))}
    </div>
  );
}

// The carry item (docs/mockup-carry-simplify, 11-04): six rows that say how the target is held, and the bone names,
// arm weights, blends and input binding under 고급. The XML is unchanged: every row writes today's fields.
export function CarryFields({
  action: a,
  w,
  change,
  edit,
  focused,
  compact = false,
}: {
  action: Action;
  w: Workspace;
  change: (a: Action) => void;
  edit?: (f: (w: Workspace) => Workspace) => void;
  focused: boolean;
  compact?: boolean;
}) {
  // Custom arm bones may equal a preset; remember that the user chose to edit them directly.
  const [custom, setCustom] = useState(false),
    c = a.pair?.carry,
    value = c ?? defaultCarry(a);
  const patch = (fields: Partial<typeof value>) => change({...a, pair: {...a.pair!, carry: {...value, ...fields}}});
  const hold = value.hold,
    patchHold = (fields: Partial<CarryHold>) => patch({hold: {...hold!, ...fields}}),
    hand = carryHand(value),
    rig = a.pair?.targetRig ?? 'character',
    lists = carryBoneLists(rig, usePairBones(clipPath(w, a)));
  const handArm = hand === 'custom' ? null : carryHoldPresets.find(([id]) => id === hand)!;
  // With a hand chosen the arm follows it; a carry of its own bones lists the presets.
  const arm = custom && hold ? 'custom' : handArm ? (hold ? 'follow' : 'off') : carryHoldPreset(hold);
  const destinations = w.actions.filter(x => putdownCandidate(x, a, w));
  const putdown = w.actions.find(x => x.uid === c?.putdownAction);
  const input = a.config.inputs.find(i => i.id === c?.input);
  // A project input changes everywhere it is used; the pair's own input changes on the pair.
  const setKey = (next: Input) =>
    edit && w.sharedInputs.some(i => i.id === next.id)
      ? edit(w => updateSharedInput(w, next))
      : change({...a, config: {...a.config, inputs: a.config.inputs.map(i => (i.id === next.id ? next : i))}});
  // Pressing a key with no putdown input yet makes the carry its own input first.
  const keyEdit = (f: (i: Input) => Input) => {
    if (input) return setKey(f(input));
    const next = chooseCarryInput(w, a, NEW_CARRY_INPUT),
      id = next.pair!.carry!.input;
    change({...next, config: {...next.config, inputs: next.config.inputs.map(i => (i.id === id ? f(i) : i))}});
  };
  // One edit sets both actions: this carry's putdown and, when missing, the putdown's release moment
  // 0.3 s before its clip ends (the HKX length is read first when the source file is known).
  const choosePutdown = (uid: string) => {
    const target = w.actions.find(x => x.uid === uid),
      path = clipPath(w, target);
    if (!edit) return patch({putdownAction: uid});
    if (!uid || target?.config.carryRelease) return edit(w => setPutdown(w, a.uid, uid));
    void clipSeconds(path).then(seconds => edit(w => setPutdown(w, a.uid, uid, seconds)));
  };
  // Spine bones take the carrier's walk sway; a large weight freezes it and breaks the gait.
  const spine = hold?.bones.some(b => /spine/i.test(b.name) && b.weight > 0.3);
  const advanced = c && (
    <>
      <DetailRow
        label={tr('부착 본')}
        hint={tr(
          '운반자 스켈레톤의 본입니다. 페어 종료 직전 이 본과 대상 루트 사이의 위치 차이·상대 회전을 저장해 따라갑니다. 본 원점으로 옮기지 않습니다. 목록 선택 또는 직접 입력이 가능하며 본이 없으면 시작하지 않습니다.'
        )}
      >
        <BonePicker
          label={tr('부착 본')}
          value={c.bone}
          options={lists.carrier}
          change={bone => {
            setCustom(false);
            patch({bone});
          }}
        />
      </DetailRow>
      <Prop
        id="enabled"
        label={tr('고정할 팔')}
        hint={tr(
          '운반하는 동안 고른 팔을 들기 끝 자세로 고정합니다. 나머지 뼈는 평소 이동 애니메이션을 따릅니다. 쇄골 하나에 가중치를 주면 그 아래 팔 전체가 물려받습니다. 직접 지정은 뼈마다 가중치(1 = 들기 자세, 0 = 이동, 사이 = 섞기)를 정합니다.'
        )}
        value={arm}
        options={[
          ...(handArm
            ? [['follow', tr('잡는 손을 따름') + ' (' + handArm[1]() + ')'] as [string, string]]
            : carryHoldPresets.map(([id, label]) => [id, label()] as [string, string])),
          ['off', tr('사용 안 함')],
          ['custom', tr('직접 지정')],
        ]}
        change={next => {
          setCustom(next === 'custom');
          if (next === 'off') return patch({hold: null});
          if (next === 'custom') return patch({hold: hold ?? defaultCarryHold(handArm?.[2])});
          const bones = (next === 'follow' ? handArm : carryHoldPresets.find(([id]) => id === next))![2];
          patch({hold: hold ? {...hold, bones: structuredClone(bones)} : defaultCarryHold(bones)});
        }}
      />
      {hold && arm === 'custom' && (
        <>
          {hold.bones.map((b, i) => (
            <DetailRow
              key={i}
              label={tr('본 ') + (i + 1)}
              hint={tr(
                '운반자 스켈레톤의 본과 가중치(0~1)입니다. 이 가중치를 아래 뼈가 모두 물려받고, 아래 뼈에 따로 적으면 그 값이 우선합니다.'
              )}
            >
              <div className="key-main carry-bone">
                <BonePicker
                  label={tr('본 ') + (i + 1)}
                  value={b.name}
                  options={lists.carrier}
                  change={name => patchHold({bones: hold.bones.map((x, j) => (j === i ? {...x, name} : x))})}
                />
                <NumberField
                  label={tr('본 ') + (i + 1) + tr(' 가중치')}
                  max={1}
                  value={b.weight}
                  change={weight => patchHold({bones: hold.bones.map((x, j) => (j === i ? {...x, weight} : x))})}
                />
                <button
                  type="button"
                  title={tr('본 삭제')}
                  aria-label={tr('본 ') + (i + 1) + tr(' 삭제')}
                  disabled={hold.bones.length < 2}
                  onClick={() => patchHold({bones: hold.bones.filter((_, j) => j !== i)})}
                >
                  ×
                </button>
              </div>
            </DetailRow>
          ))}
          <button
            type="button"
            disabled={hold.bones.length >= 256}
            onClick={() => patchHold({bones: [...hold.bones, {name: '', weight: 1}]})}
          >
            {tr('본 추가')}
          </button>
          {spine && (
            <p className="field-error" role="alert">
              {tr(
                '척추 뼈에는 0.3 이하의 작은 값만 권합니다. 크게 주면 걸음의 몸통 흔들림이 사라져 상체와 다리가 어긋납니다.'
              )}
            </p>
          )}
        </>
      )}
      <DetailRow
        label={tr('대상 루트 본')}
        hint={tr(
          '들리는 상대의 기준 본입니다. 인간·닭의 기본값은 NPC Root [Root]이며 다른 리그는 실제 본 이름을 입력합니다.'
        )}
      >
        <BonePicker
          label={tr('대상 루트 본')}
          value={c.targetRoot}
          options={lists.target}
          change={targetRoot => patch({targetRoot})}
        />
      </DetailRow>
      {hold && (
        <>
          <DetailRow
            label={tr('들기 블렌드')}
            hint={tr('운반을 시작할 때 이동 애니메이션에서 들기 자세로 섞는 시간입니다.')}
          >
            <NumberField
              label={tr('들기 블렌드')}
              max={5}
              value={hold.blendIn}
              change={blendIn => patchHold({blendIn})}
            />
          </DetailRow>
          <DetailRow
            label={tr('놓기 블렌드')}
            hint={tr(
              '떨어뜨리기 등으로 운반이 끝날 때 들기 자세에서 이동 애니메이션으로 돌아가는 시간입니다. 내려놓기 동작으로 넘어갈 때는 그 동작의 시작 블렌드를 쓰고, 없으면 이 값을 씁니다.'
            )}
          >
            <NumberField
              label={tr('놓기 블렌드')}
              max={5}
              value={hold.blendOut}
              change={blendOut => patchHold({blendOut})}
            />
          </DetailRow>
        </>
      )}
      <Prop
        id="input"
        label={tr('입력 연결')}
        hint={tr(
          '내려놓기 키가 쓰는 입력입니다. 시작 키와 같은 입력을 고르면 한 키로 들고 내려놓습니다. 공통 입력은 프로젝트 전체에서 같은 키를 씁니다.'
        )}
        value={c.input}
        options={[
          ['', tr('선택하세요')],
          ...a.config.inputs.map(i => [i.id, i.label + ' · ' + keyName(i)] as [string, string]),
          ...w.sharedInputs
            .filter(i => !a.config.inputs.some(x => x.id === i.id))
            .map(i => [i.id, tr('공통 ') + i.label + ' · ' + keyName(i)] as [string, string]),
          [NEW_CARRY_INPUT, tr('새 키…')],
        ]}
        change={choice => change(chooseCarryInput(w, a, choice))}
      />
      {c.target === 'physics' && (
        <RagdollFields
          ragdoll={c.ragdoll}
          rig={rig}
          liftId={a.config.actionId}
          uid={a.uid}
          change={ragdoll => patch({ragdoll})}
        />
      )}
    </>
  );
  return (
    <DetailCategory
      sectionId="carry"
      title={t('node.carry')}
      initialOpen={!compact}
      summary={compact ? (c ? carrySummary(c) : tr('사용 안 함')) : undefined}
      advanced={advanced || undefined}
      advancedOpen={false}
    >
      {!focused && (
        <Prop
          id="enabled"
          label={tr('종료 후 운반')}
          hint={tr(
            '페어 종료 직전의 상대 위치·방향을 유지한 채 시간 제한 없이 운반합니다. 무기·주문을 꺼내거나 어느 쪽이든 맞거나 운반자가 넘어지면 대상을 래그돌로 떨어뜨립니다. 점프·셀 이동은 유지합니다. 현재 운반자는 플레이어이며 동시에 하나만 운반합니다.'
          )}
          value={!!c}
          change={enabled => change({...a, pair: {...a.pair!, carry: enabled ? defaultCarry(a) : undefined}})}
        />
      )}
      {c && (
        <>
          <DetailRow
            label={tr('잡는 손')}
            hint={tr(
              '대상을 붙일 손과 들기 끝 자세로 고정할 팔을 함께 정합니다. 양손은 오른손에 붙이고 두 팔을 고정합니다. 다른 본이나 팔을 따로 쓰려면 고급에서 바꿉니다.'
            )}
          >
            <div className="carry-hand">
              <Segments
                label={tr('잡는 손')}
                value={hand === 'custom' ? '' : hand}
                options={carryHands()}
                change={next => {
                  setCustom(false);
                  patch(setCarryHand(c, next));
                }}
              />
              {hand === 'custom' && <small>{tr('직접 (고급)')}</small>}
            </div>
          </DetailRow>
          <DetailRow
            label={tr('대상')}
            hint={tr(
              '자세 그대로: 들어올리기의 마지막 자세 그대로 붙어 다닙니다. 매달림: 쥐는 곳 하나만 손에 고정하고 나머지는 물리로 흔들립니다(래그돌 묶음의 값, 정하지 않으면 바닐라). 래그돌을 준비하지 못하면 자세 그대로 운반합니다.'
            )}
          >
            <Segments
              label={tr('대상')}
              value={c.target}
              options={[
                ['pose', tr('자세 그대로')],
                ['physics', tr('매달림')],
              ]}
              change={target => patch(target === 'physics' ? {target} : {target, part: ''})}
            />
          </DetailRow>
          {c.target === 'physics' && (
            <DetailRow
              label={tr('쥐는 곳')}
              hint={tr(
                '손에 고정할 대상의 래그돌 몸체입니다. 목록은 들기 HKX의 상대 본 가운데 래그돌 몸체가 있는 본이고, HKX를 읽지 못하면 대상 스켈레톤의 skeleton.nif에서 가져옵니다. 자동은 들어올리기가 끝날 때 부착 본에 가장 가까운 몸체를 고릅니다.'
              )}
            >
              <BonePicker
                label={tr('쥐는 곳')}
                value={c.part}
                options={lists.bodies}
                empty={tr('자동 (손에 가장 가까운 곳)')}
                change={part => patch({part})}
              />
            </DetailRow>
          )}
          <Prop
            id="mode"
            label={tr('무기')}
            hint={tr(
              '무기를 넣어야 운반: 무기·주문을 넣은 상태에서만 시작하고, 운반 중 꺼내면 대상을 떨어뜨립니다. 들기 시작 때 무기 넣기: 무기를 든 채 시작해도 들기가 시작되는 순간 동작 없이 운반자의 무기가 칼집에 들어갑니다. 그 뒤로는 무기·주문을 꺼내면 대상을 떨어뜨립니다. 대상의 무기는 놓을 때까지 보이지 않습니다.'
            )}
            value={c.weapon}
            initial="sheathed"
            options={[
              ['sheathed', tr('무기를 넣어야 운반')],
              ['sheathe', tr('들기 시작 때 무기 넣기')],
            ]}
            change={weapon => patch({weapon})}
          />
          <DetailRow
            label={tr('내려놓기')}
            hint={tr(
              "운반 중 내려놓기 키를 누르면 운반자가 이 동작을 혼자 재생합니다. 대상은 붙은 채 따라가다 그 동작의 '대상 놓기' 시점에 래그돌로 떨어지고, 일어서는 것은 게임이 합니다. 클립이 먼저 끝나면 끝에서 놓습니다. 시작 입력·조건 분기·방향 클립이 없는 한 사람 일반 동작만 고를 수 있으며, 고르면 그 동작에 '대상 놓기'가 없을 때 클립 끝 0.3초 전으로 추가합니다."
            )}
          >
            <div className="carry-putdown">
              <select aria-label={tr('내려놓기')} value={c.putdownAction} onChange={e => choosePutdown(e.target.value)}>
                <option value="">{tr('선택하세요')}</option>
                {c.putdownAction && !destinations.some(x => x.uid === c.putdownAction) && (
                  <option value={c.putdownAction}>{tr('연결을 확인하세요')}</option>
                )}
                {/* The Action ID only when it says something the name does not (10-28: 「GrappleCarryLower · GrappleCarryLower」). */}
                {destinations.map(x => (
                  <option key={x.uid} value={x.uid}>
                    {x.config.name === x.config.actionId || !x.config.actionId
                      ? x.config.name || x.config.actionId
                      : x.config.name + ' · ' + x.config.actionId}
                  </option>
                ))}
              </select>
              {putdown?.config.carryRelease && (
                <small>{tr('놓기 ') + timingLabel(putdown.config.carryRelease.at)}</small>
              )}
            </div>
          </DetailRow>
          <DetailRow
            label={tr('내려놓기 키')}
            hint={tr(
              '시간 제한 없이 운반하다 이 키를 새로 누르면 내려놓기 동작을 재생합니다. 시작 키와 같아도 됩니다. 같은 입력을 쓰는 곳(시작 키, 공통 입력)도 함께 바뀌며, 다른 입력은 고급의 입력 연결에서 고릅니다. 들어올리는 중이나 공중에서는 내려놓지 않습니다.'
            )}
          >
            <KeyField
              value={input?.key ?? ''}
              gamepad={input?.gamepad ?? 0}
              change={key => keyEdit(i => ({...i, key}))}
              changeGamepad={gamepad => keyEdit(i => ({...i, gamepad}))}
              control={input?.control}
              changeControl={control =>
                keyEdit(i => {
                  const {control: _, ...rest} = i;
                  return control ? {...rest, key: '', gamepad: 0, control} : {...rest, key: 'E'};
                })
              }
            />
          </DetailRow>
          {/* Every carry fixes its target: at the lift's end unless a moment is given (dragged on the timeline too). */}
          <DetailRow label={t('carryFix.at')} hint={t('carryFix.hint')}>
            <Segments
              label={t('carryFix.at')}
              value={c.fix ? 'time' : 'end'}
              options={[
                ['end', t('carryFix.liftEnd')],
                ['time', t('carryFix.time')],
              ]}
              change={mode => patch({fix: mode === 'time' ? (c.fix ?? defaultCarryFix()) : null})}
            />
          </DetailRow>
          {c.fix && (
            <DetailRow label={t('carryFix.time')}>
              <TimeField
                value={c.fix.at}
                change={at => patch({fix: {at}})}
                label={t('carryFix.time')}
                bases={['seconds']}
              />
            </DetailRow>
          )}
        </>
      )}
    </DetailCategory>
  );
}
