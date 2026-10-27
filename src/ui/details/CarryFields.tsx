import {useId, useState} from 'react';
import type {Action, Workspace} from '../../workspace.ts';
import {
  carryBones,
  carryHoldPreset,
  carryHoldPresets,
  defaultCarry,
  defaultCarryHold,
  putdownCandidate,
  setPutdown,
  chooseCarryInput,
  NEW_CARRY_INPUT,
} from '../../carry.ts';
import type {Input} from '../../model.ts';
import {updateSharedInput} from '../../sharedSettings.ts';
import {KeyField} from './KeyField.tsx';
import {assetKey} from '../../package.ts';
import {clipSeconds} from '../../timeline/metadata.ts';
import type {CarryHold} from '../../carry.ts';
import {DetailCategory, DetailRow} from './DetailRow.tsx';
import {NumberField} from './NumberField.tsx';
import {Property as Prop} from './Property.tsx';
import {t} from '../../i18n/index.ts';
import {tr} from '../../i18n/korean.ts';
import {gameControlLabel} from '../../keys.ts';

const keyName = (i: Input) =>
  i.control ? gameControlLabel(i.control) : i.key || (i.gamepad ? 'Pad ' + i.gamepad : tr('키 없음'));

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
  const list = useId(),
    // Custom bones may equal a preset; remember that the user chose to edit them directly.
    [custom, setCustom] = useState(false),
    c = a.pair?.carry,
    value = c ?? defaultCarry(a);
  const patch = (fields: Partial<typeof value>) => change({...a, pair: {...a.pair!, carry: {...value, ...fields}}});
  const hold = value.hold,
    patchHold = (fields: Partial<CarryHold>) => patch({hold: {...hold!, ...fields}}),
    preset = custom && hold ? 'custom' : carryHoldPreset(hold);
  const destinations = w.actions.filter(x => putdownCandidate(x, a, w));
  const input = a.config.inputs.find(i => i.id === c?.input);
  // A project input changes everywhere it is used; the pair's own input changes on the pair.
  const setKey = (next: Input) =>
    edit && w.sharedInputs.some(i => i.id === next.id)
      ? edit(w => updateSharedInput(w, next))
      : change({...a, config: {...a.config, inputs: a.config.inputs.map(i => (i.id === next.id ? next : i))}});
  // One edit sets both actions: this carry's putdown and, when missing, the putdown's release moment
  // 0.3 s before its clip ends (the HKX length is read first when the source file is known).
  const choosePutdown = (uid: string) => {
    const target = w.actions.find(x => x.uid === uid),
      step = target?.config.steps.find(s => s.id === target.config.entry) ?? target?.config.steps[0],
      path = step?.localPath || (step && w.assets.find(x => assetKey(x.clip) === assetKey(step.clip))?.localPath) || '';
    if (!edit) return patch({putdownAction: uid});
    if (!uid || target?.config.carryRelease) return edit(w => setPutdown(w, a.uid, uid));
    void clipSeconds(path).then(seconds => edit(w => setPutdown(w, a.uid, uid, seconds)));
  };
  // Spine bones take the carrier's walk sway; a large weight freezes it and breaks the gait.
  const spine = hold?.bones.some(b => /spine/i.test(b.name) && b.weight > 0.3);
  return (
    <DetailCategory
      sectionId="carry"
      title={t('node.carry')}
      initialOpen={!compact}
      summary={compact ? (c ? c.bone : tr('사용 안 함')) : undefined}
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
            label={tr('부착 본')}
            hint={tr(
              '운반자 스켈레톤의 본입니다. 페어 종료 직전 이 본과 대상 루트 사이의 위치 차이·상대 회전을 저장해 따라갑니다. 본 원점으로 옮기지 않습니다. 목록 선택 또는 직접 입력이 가능하며 본이 없으면 시작하지 않습니다.'
            )}
          >
            <input list={list} value={c.bone} onChange={e => patch({bone: e.target.value})} />
          </DetailRow>
          <datalist id={list}>
            {carryBones().map(([name, label]) => (
              <option key={name} value={name}>
                {label}
              </option>
            ))}
          </datalist>
          <Prop
            id="name"
            label={tr('대상 루트 본')}
            hint={tr(
              '들리는 상대의 기준 본입니다. 인간·닭의 기본값은 NPC Root [Root]이며 다른 리그는 실제 본 이름을 입력합니다.'
            )}
            value={c.targetRoot}
            initial={defaultCarry().targetRoot}
            change={targetRoot => patch({targetRoot})}
          />
          <Prop
            id="mode"
            label={tr('대상 처리')}
            hint={tr(
              '자세 고정: 들어올리기의 마지막 자세 그대로 붙어 다닙니다. 래그돌 고정: 몸체 하나만 부착 본에 고정하고 나머지는 물리로 흔들립니다(대상 스켈레톤의 래그돌 프로필 값). 래그돌을 준비하지 못하면 자세 고정으로 운반합니다.'
            )}
            value={c.target}
            initial="pose"
            options={[
              ['pose', tr('자세 고정')],
              ['physics', tr('래그돌 고정')],
            ]}
            change={target => patch(target === 'physics' ? {target} : {target, part: ''})}
          />
          {c.target === 'physics' && (
            <DetailRow
              label={tr('고정 몸체')}
              hint={tr(
                '부착 본에 고정할 대상의 본(래그돌 몸체) 이름입니다. 비우면 들어올리기가 끝날 때 부착 본에 가장 가까운 몸체를 고릅니다. 예: 닭은 Neck2(목을 쥠).'
              )}
            >
              <input
                value={c.part}
                placeholder={tr('자동 (부착 본에 가장 가까운 몸체)')}
                onChange={e => patch({part: e.target.value})}
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
          <Prop
            id="target"
            label={tr('내려놓기 동작')}
            hint={tr(
              "운반 중 내려놓기 입력을 누르면 운반자가 이 동작을 혼자 재생합니다. 대상은 붙은 채 따라가다 그 동작의 '대상 놓기' 시점에 래그돌로 떨어지고, 일어서는 것은 게임이 합니다. 클립이 먼저 끝나면 끝에서 놓습니다. 시작 입력·조건 분기·방향 클립이 없는 한 사람 일반 동작만 고를 수 있으며, 고르면 그 동작에 '대상 놓기'가 없을 때 클립 끝 0.3초 전으로 추가합니다."
            )}
            value={c.putdownAction}
            options={[
              ['', tr('선택하세요')],
              ...(c.putdownAction && !destinations.some(x => x.uid === c.putdownAction)
                ? [[c.putdownAction, tr('연결을 확인하세요')] as [string, string]]
                : []),
              // The Action ID only when it says something the name does not (10-28: 「GrappleCarryLower · GrappleCarryLower」).
              ...destinations.map(
                x =>
                  [
                    x.uid,
                    x.config.name === x.config.actionId || !x.config.actionId
                      ? x.config.name || x.config.actionId
                      : x.config.name + ' · ' + x.config.actionId,
                  ] as [string, string]
              ),
            ]}
            change={choosePutdown}
          />
          <Prop
            id="input"
            label={tr('내려놓기 입력')}
            hint={tr(
              '시간 제한 없이 운반하다 이 키를 새로 누르면 내려놓기 동작을 재생합니다. 시작 키와 같아도 됩니다. 들어올리는 중에는 눌러도 아무 일도 없고(0.12.221), 공중에서는 내려놓지 않습니다. 셀 이동은 새 셀에서 재부착합니다.'
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
          {input && (
            <DetailRow
              label={tr('내려놓기 키')}
              hint={tr(
                '고른 입력의 키입니다. 시작 키 등 같은 입력을 쓰는 곳도 함께 바뀝니다. 공통 입력은 프로젝트 전체에서 바뀝니다.'
              )}
            >
              <KeyField
                value={input.key}
                gamepad={input.gamepad}
                change={key => setKey({...input, key})}
                changeGamepad={gamepad => setKey({...input, gamepad})}
                control={input.control}
                changeControl={control => {
                  const {control: _, ...rest} = input;
                  setKey(control ? {...rest, key: '', gamepad: 0, control} : {...rest, key: 'E'});
                }}
              />
            </DetailRow>
          )}
          <Prop
            id="enabled"
            label={tr('운반자 상체')}
            hint={tr(
              '운반하는 동안 고른 팔을 들기 자세로 고정합니다. 나머지 뼈는 평소 이동 애니메이션을 따릅니다. 쇄골 하나에 가중치를 주면 그 아래 팔 전체가 물려받습니다. 직접 지정은 뼈마다 가중치(1 = 들기 자세, 0 = 이동, 사이 = 섞기)를 정합니다.'
            )}
            value={preset}
            initial="off"
            options={[
              ['off', tr('사용 안 함')],
              ...carryHoldPresets.map(([id, label]) => [id, label()] as [string, string]),
              ['custom', tr('직접 지정')],
            ]}
            change={next => {
              setCustom(next === 'custom');
              if (next === 'off') return patch({hold: null});
              if (next === 'custom') return patch({hold: hold ?? defaultCarryHold()});
              const bones = carryHoldPresets.find(([id]) => id === next)![2];
              patch({hold: hold ? {...hold, bones: structuredClone(bones)} : defaultCarryHold(bones)});
            }}
          />
          {hold && (
            <>
              <DetailRow
                label={tr('들기 자세')}
                hint={tr('고정할 자세의 출처입니다. 들기 끝 자세는 들어올리기 페어가 끝나기 직전의 운반자 자세입니다.')}
              >
                <select value={hold.pose} onChange={e => patchHold({pose: e.target.value})}>
                  <option value="lift-end">{tr('들기 끝 자세')}</option>
                  {hold.pose !== 'lift-end' && <option value={hold.pose}>{hold.pose}</option>}
                </select>
              </DetailRow>
              {hold.pose !== 'lift-end' && (
                <p className="field-error" role="alert">
                  {tr('런타임은 들기 끝 자세만 받습니다. 들기 끝 자세를 고르세요.')}
                </p>
              )}
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
              {preset === 'custom' && (
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
                        <input
                          list={list}
                          aria-label={tr('본 ') + (i + 1)}
                          value={b.name}
                          onChange={e =>
                            patchHold({bones: hold.bones.map((x, j) => (j === i ? {...x, name: e.target.value} : x))})
                          }
                        />
                        <NumberField
                          label={tr('본 ') + (i + 1) + tr(' 가중치')}
                          max={1}
                          value={b.weight}
                          change={weight =>
                            patchHold({bones: hold.bones.map((x, j) => (j === i ? {...x, weight} : x))})
                          }
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
            </>
          )}
        </>
      )}
    </DetailCategory>
  );
}
