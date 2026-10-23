import {RuntimeEventFields} from './RuntimeEventFields.tsx';
import './inspector.css';
import {pairedRigs} from '../../pairedRigs.ts';
import {CarryFields} from './CarryFields.tsx';
import {defaultCarryFix} from '../../carry.ts';
import type {Action, Workspace, Pair, CameraRestore} from '../../workspace.ts';
import {defaultPair, defaultCamera} from '../../workspace.ts';
import {cameraReset} from '../../sharedSettings.ts';
import {createProject, mark} from '../../model.ts';
import type {Project} from '../../model.ts';
import {playbackKind, playbackKinds} from '../../actionTypes.ts';
import type {ActionKind} from '../../actionTypes.ts';
import type {LibraryEntry} from '../../assets.ts';
import {t, useLanguage} from '../../i18n/index.ts';
import {labelText} from '../../labels.ts';
import {DetailPanel, DetailCategory as Category, DetailRow, DetailFocus} from './DetailRow.tsx';
import {useContext} from 'react';
import {Property as Prop} from './Property.tsx';
import {TimeField} from './TimeField.tsx';
import {EventPicker} from './EventPicker.tsx';
import {StepFiles, ViewFields, type ViewRow} from './ViewFields.tsx';
import {KeyField} from './KeyField.tsx';
import {markerNames} from './markerCatalog.ts';
import {ClipWindowFields, ExitField} from './ClipWindowFields.tsx';
import {AnglePreview} from './AnglePreview.tsx';
import {AttackDataField} from './AttackDataField.tsx';
import {exitSummary, setSingleAttack} from './inspectorModel.ts';
import {tr} from '../../i18n/korean.ts';
export function StateDetails({
  action: a,
  w,
  change,
  switchKind,
  status,
  onGlobalSettings,
  library,
  selectedAsset,
  stepId,
  integrated = false,
  edit,
}: {
  action: Action;
  w: Workspace;
  change: (a: Action) => void;
  /** Whole-workspace edit, for settings that change another action too (the carry's putdown). */
  edit?: (f: (w: Workspace) => Workspace) => void;
  switchKind: (k: ActionKind) => void;
  status: (s: string) => void;
  onGlobalSettings: () => void;
  library: LibraryEntry[];
  selectedAsset?: LibraryEntry;
  stepId?: string;
  integrated?: boolean;
}) {
  // Re-render on a language switch: the labels below are tr() text.
  useLanguage();
  const focused = useContext(DetailFocus);
  const p = a.config,
    pair = a.pair,
    d = createProject(),
    dp = defaultPair(),
    kind = playbackKind(a);
  // The action's camera restore (its settings when off too); a new one starts on the project's event.
  const camera: CameraRestore = a.camera ?? {...defaultCamera(), reset: w.globals.cameraReset ?? ''},
    setCamera = (c: CameraRestore) => change({...a, camera: c});
  const patch = (v: Partial<Project>) => change({...a, config: {...p, ...v}}),
    start = (v: Partial<Project['start']>) =>
      change({
        ...a,
        config: {...p, start: {...p.start, ...v}},
        pair: pair && v.mode && v.mode !== 'event' ? {...pair, target: 'nearest'} : pair,
      }),
    pp = (v: Partial<Pair>) => {
      if (pair) change({...a, pair: {...pair, ...v}});
    };
  const input = p.inputs.find(i => i.id === p.start.input);
  // View settings touch the workspace (the asset library); without `edit` only this action changes.
  const editAll = edit ?? ((f: (w: Workspace) => Workspace) => change(f(w).actions.find(x => x.uid === a.uid) ?? a));
  const detailRow: ViewRow = (id, label, control, hint) => (
    <DetailRow key={id} id={id} label={label} hint={hint}>
      {control}
    </DetailRow>
  );
  const number = (id: any, key: keyof Project, max = 600) => (
    <Prop id={id} value={p[key]} initial={d[key]} change={v => patch({[key]: v})} max={max} />
  );
  // A distance or an angle steps by whole units (the wheel's notch, docs/mockup-layout-fixes ①); seconds by 0.05.
  const pairNumber = (id: any, key: keyof Pair, max = 600, step = 0.05) => (
    <Prop id={id} value={pair?.[key]} initial={dp[key]} change={v => pp({[key]: v})} max={max} step={step} />
  );
  const pairCheck = (id: any, key: keyof Pair) => (
    <Prop id={id} value={pair?.[key]} initial={dp[key]} change={v => pp({[key]: v})} />
  );
  // The end trigger's own lines (시점, 종료), not inside another named row (docs/mockup-layout-fixes ②).
  const clock = (_id: 'exitTime', value: Project['exit'], change: (m: Project['exit']) => void) => (
    <ExitField w={w} action={a} value={value} change={change} events={markerNames(w)} />
  );
  return (
    <DetailPanel>
      {/* In the HKX card (integrated) 재생 설정 is item rows (docs/mockup-playback-settings): the kind and the file
          are the card's top, finding the partner and the pair play are its features. */}
      {integrated ? (
        <Category sectionId="playback" group="playback" title={tr('이름')} summary={p.name}>
          <Prop id="name" value={p.name} change={name => patch({name})} />
        </Category>
      ) : (
        <Category
          sectionId="playback"
          group="playback"
          title={a.nodeAuthored ? t('node.hkxPlay') + tr(' · 동작 설정') : t('node.state')}
          initialOpen
        >
          <Prop id="name" value={p.name} change={name => patch({name})} />
          <Prop
            id="kind"
            value={kind}
            change={switchKind}
            options={playbackKinds.map(k => [k, t('actionKind.' + k)])}
          />
          <ViewFields w={w} action={a} edit={editAll} row={detailRow} />
        </Category>
      )}
      {p.steps
        .filter(s => !integrated && (!stepId || s.id === stepId))
        .map(s => (
          <Category
            key={s.id}
            sectionId={'clip-' + s.id}
            group="playback"
            initialOpen={integrated}
            title={t('node.hkxPlay') + ' · ' + s.label}
          >
            <StepFiles
              w={w}
              action={a}
              step={s}
              library={library}
              selected={selectedAsset}
              status={status}
              edit={editAll}
              row={detailRow}
              change={(clip, localPath) =>
                patch({steps: p.steps.map(x => (x.id === s.id ? {...x, clip, localPath} : x))})
              }
            />
            <Prop
              id="name"
              value={s.label}
              change={label => patch({steps: p.steps.map(x => (x.id === s.id ? {...x, label} : x))})}
            />
            {!pair && <ClipWindowFields w={w} action={a} step={s.id} change={change} events={markerNames(w)} />}
          </Category>
        ))}
      {integrated && !pair && (
        <Category
          sectionId="detection"
          group="playback"
          title={tr('입력 감지')}
          summary={tr('선택한 HKX의 연결 키에 적용')}
        >
          <ClipWindowFields w={w} action={a} step={stepId || p.entry} change={change} events={markerNames(w)} />
        </Category>
      )}
      {integrated && (
        <Category sectionId="exit" group="playback" title={tr('종료')} initialOpen summary={exitSummary(a)}>
          {p.steps.length > 1 && <div className="inspector-scope">{tr('동작 전체 적용')}</div>}
          {clock('exitTime', p.exit, exit => patch({exit}))}
        </Category>
      )}
      <Category
        sectionId="attack"
        group="playback"
        title={integrated ? tr('공격 데이터') : tr('공격 설정')}
        summary={
          p.steps.length === 1 ? p.steps[0].attack || p.attack || tr('지정 안 함') : p.attack || tr('클립별 설정')
        }
      >
        {p.steps.length === 1 ? (
          <AttackDataField
            w={w}
            label={tr('공격 데이터')}
            value={p.steps[0].attack || p.attack}
            change={value => change(setSingleAttack(a, value))}
          />
        ) : (
          <>
            <AttackDataField w={w} value={p.attack} change={attack => patch({attack})} />
            {p.steps
              .filter(s => !stepId || s.id === stepId)
              .map(s => (
                <AttackDataField
                  key={s.id}
                  w={w}
                  override
                  label={tr('이 HKX · ') + s.label}
                  value={s.attack}
                  change={attack => patch({steps: p.steps.map(x => (x.id === s.id ? {...x, attack} : x))})}
                />
              ))}
          </>
        )}
      </Category>
      <Category
        sectionId="start-input"
        title={t('node.keyInput')}
        summary={t('detail.' + (p.start.mode === 'none' ? 'external' : p.start.mode))}
      >
        <Prop
          id="mode"
          value={p.start.mode}
          initial="none"
          change={mode => start({mode})}
          options={['none', 'input', 'event'].map(v => [v, t('detail.' + (v === 'none' ? 'external' : v))])}
        />
        {p.start.mode === 'input' && (
          <>
            <Prop
              id="input"
              value={p.start.input}
              change={input => start({input})}
              options={p.inputs.map(i => [i.id, i.label])}
            />
            {input && (
              <DetailRow id="input">
                <KeyField
                  value={input.key}
                  gamepad={input.gamepad}
                  change={key => patch({inputs: p.inputs.map(i => (i.id === input.id ? {...i, key} : i))})}
                  changeGamepad={gamepad =>
                    patch({inputs: p.inputs.map(i => (i.id === input.id ? {...i, gamepad} : i))})
                  }
                />
              </DetailRow>
            )}
            <Prop id="onRelease" value={p.start.onKeyUp} initial={false} change={onKeyUp => start({onKeyUp})} />
          </>
        )}
      </Category>
      {p.start.mode === 'event' && (
        <Category sectionId="start-event" title={t('node.markerReceive')} summary={p.start.event}>
          <Prop id="marker" value={p.start.event} change={event => start({event})}>
            <EventPicker
              label={labelText('marker')}
              value={p.start.event}
              events={markerNames(w)}
              change={event => start({event})}
            />
          </Prop>
          <Prop
            id="sender"
            value={p.start.actor}
            initial="both"
            change={actor => start({actor})}
            options={['player', 'npc', 'both'].map(v => [v, t('detail.' + v)])}
          />
        </Category>
      )}
      <Category
        sectionId="state-condition"
        title={t('node.stateCondition')}
        summary={
          t('detail.' + (p.air === 'deny' ? 'ground' : p.air === 'only' ? 'air' : 'both')) +
          (p.cooldown ? ' · ' + p.cooldown + tr('초') : '')
        }
      >
        {/* 시작 제한 (runtime 0.12.276): the action's own nature, on every way in. A state check (weapon, attacking,
            stamina) is a condition branch's test. */}
        <Prop
          id="location"
          value={p.air}
          initial="deny"
          change={air => patch({air})}
          options={[
            ['deny', t('detail.ground')],
            ['only', t('detail.air')],
            ['allow', t('detail.both')],
          ]}
        />
        {number('cooldown', 'cooldown')}
        <p className="effect-note">
          {tr('어느 경로로 와도 적용됩니다. 무기·공격 중·스태미나 검사는 조건 분기에서 합니다.')}
        </p>
      </Category>
      {p.fireArrow && !pair && (
        <Category title={t('node.fireArrow')} initialOpen>
          {/* How the arrow leaves the bow (docs/mockup-direct-arrow, runtime 0.12.268). */}
          <DetailRow
            label={tr('발사 방식')}
            hint={
              p.fireArrow.mode === 'direct'
                ? tr(
                    '당기지 않아도 바로 쏩니다. 속도·거리는 끝까지 당긴 것과 같고, 피해는 아래 %를 곱합니다. 장착 화살 1개를 소모하고, 화살이 없으면 쏘지 않습니다. 활 마법부여·독은 아직 적용하지 않습니다.'
                  )
                : tr('시위를 당기고 있을 때만 쏩니다. 그 순간까지 당긴 만큼 속도·거리·피해가 정해집니다.')
            }
          >
            <div className="qte-seg fire-mode" role="group" aria-label={tr('발사 방식')}>
              {(
                [
                  ['drawn', tr('당긴 만큼')],
                  ['direct', tr('바로 발사')],
                ] as const
              ).map(([mode, name]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={(p.fireArrow!.mode ?? 'drawn') === mode}
                  onClick={() => {
                    const {mode: _, damage: __, ...rest} = p.fireArrow!;
                    // A direct shot has no draw to release: it fires at its time (a shot on an event is the registry's).
                    patch({
                      fireArrow:
                        mode === 'direct'
                          ? {...rest, mode: 'direct', onRelease: false, at: rest.at ?? mark(0.5)}
                          : {...rest, onRelease: rest.at ? rest.onRelease : true},
                    });
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </DetailRow>
          {p.fireArrow.mode === 'direct' && (
            <DetailRow label={tr('피해 %')} hint={tr('끝까지 당긴 피해에 곱합니다. 1~1000%, 기본 100%.')}>
              <input
                type="number"
                aria-label={tr('피해 %')}
                min={1}
                max={1000}
                step={5}
                value={p.fireArrow.damage ?? 100}
                onChange={e => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  const {damage: _, ...rest} = p.fireArrow!;
                  patch({fireArrow: value === 100 ? rest : {...rest, damage: value}});
                }}
              />
            </DetailRow>
          )}
          <DetailRow
            label={tr('버튼 떼기 발사')}
            hint={tr(
              '이 동작 중에 공격 버튼을 떼면 당긴 화살을 자동 발사 경로로 쏩니다. 이벤트로 쏘려면 이벤트 등록에 활 발사를 등록하세요.'
            )}
          >
            <input
              type="checkbox"
              aria-label={tr('버튼 떼기 발사')}
              checked={p.fireArrow.onRelease && p.fireArrow.mode !== 'direct'}
              disabled={p.fireArrow.mode === 'direct'}
              title={
                p.fireArrow.mode === 'direct' ? tr('바로 발사는 당김이 없어 버튼 떼기로 쏠 수 없습니다.') : undefined
              }
              onChange={e => patch({fireArrow: {...p.fireArrow!, onRelease: e.target.checked}})}
            />
          </DetailRow>
          <DetailRow label={tr('시각 발사')} hint={t('fireArrow.hint')}>
            <input
              type="checkbox"
              aria-label={tr('시각 발사')}
              checked={!!p.fireArrow.at}
              onChange={e => patch({fireArrow: {...p.fireArrow!, at: e.target.checked ? mark(0.5) : null}})}
            />
          </DetailRow>
          {p.fireArrow.at && (
            <DetailRow label={t('fireArrow.at')}>
              <TimeField
                value={p.fireArrow.at}
                change={at => patch({fireArrow: {...p.fireArrow!, at}})}
                label={t('fireArrow.at')}
                bases={['seconds']}
              />
            </DetailRow>
          )}
          {!p.fireArrow.at && p.fireArrow.mode === 'direct' && (
            <p className="field-error" role="alert">
              {tr('바로 발사는 시각 발사를 켜거나, 이벤트 등록의 활 발사로 쏘세요.')}
            </p>
          )}
          {!p.fireArrow.at && !p.fireArrow.onRelease && p.fireArrow.mode !== 'direct' && (
            <p className="fire-shot-hint">{tr('이 동작 자체로는 쏘지 않습니다. 이벤트 등록의 활 발사로만 쏩니다.')}</p>
          )}
        </Category>
      )}
      {p.carryRelease && !pair && (
        <Category title={t('node.carryRelease')} initialOpen>
          <DetailRow label={t('carryRelease.at')} hint={t('carryRelease.hint')}>
            <TimeField
              value={p.carryRelease.at}
              change={at => patch({carryRelease: {at}})}
              label={t('carryRelease.at')}
              events={markerNames(w)}
            />
          </DetailRow>
        </Category>
      )}
      {p.suppress && (
        <Category title={t('node.suppress')} initialOpen>
          <RuntimeEventFields
            events={p.suppress.events}
            suppression={p.suppress.when}
            change={events => patch({suppress: {...p.suppress!, events}})}
            changeWhen={when => patch({suppress: {...p.suppress!, when}})}
          />
        </Category>
      )}
      {!integrated && (
        <Category title={t('node.blendIn')}>
          {!focused && (
            <Prop
              id="enabled"
              value={a.enterBlendEnabled}
              initial={true}
              change={enterBlendEnabled => change({...a, enterBlendEnabled})}
            />
          )}
          {number('blend', 'enterBlend', 5)}
        </Category>
      )}
      {!integrated && (
        <Category title={t('node.blendOut')}>
          {!focused && (
            <Prop
              id="enabled"
              value={a.exitBlendEnabled}
              initial={true}
              change={exitBlendEnabled => change({...a, exitBlendEnabled})}
            />
          )}
          {clock('exitTime', p.exit, exit => patch({exit}))}
          {number('blend', 'exitBlend', 5)}
        </Category>
      )}
      {pair && (
        <>
          {!integrated && (
            <Category
              sectionId="pair-target"
              group="playback"
              title={t('node.findPartner')}
              summary={`${pair.targetRig ?? 'character'} · ${pair.range} · ${pair.angle}°`}
              advanced={
                // Read from the HKX's start pose (graph/pairFacing.ts): a pair played from behind does not turn the two
                // to face each other.
                <DetailRow id="reorient">
                  <span>{t(pair.reorientSupport ? 'detail.facingFront' : 'detail.facingBack')}</span>
                </DetailRow>
              }
            >
              <Prop
                id="target"
                label={tr('대상 스켈레톤')}
                hint={tr(
                  '페어 HKX를 제작할 때 사용한 상대 스켈레톤입니다. 해당 계열만 대상으로 찾으며, 내보내기는 인간과 상대의 경로에 HKX를 함께 배치합니다.'
                )}
                value={pair.targetRig ?? 'character'}
                initial="character"
                change={targetRig => pp({targetRig})}
                options={pairedRigs.map(r => [r.id, `${r.label} · ${r.id}`])}
              />
              {pairNumber('range', 'range', 10000, 1)}
              {pairNumber('angle', 'angle', 360, 5)}
              <AnglePreview angle={pair.angle} />
              <Prop
                id="target"
                value={pair.target}
                initial="nearest"
                change={target => pp({target})}
                options={[
                  ['nearest', t('detail.nearest')],
                  ...(p.start.mode === 'event' ? [['combatTarget', t('detail.combatTarget')] as [string, string]] : []),
                ]}
              />
            </Category>
          )}
          {!integrated && (
            <Category
              sectionId="pair-play"
              group="playback"
              title={t('node.pairedPlay')}
              summary={t('row.lossBlend') + ' · ' + (pair.lossEnabled ? 'ON' : 'OFF')}
            >
              {pairCheck('lossBlend', 'lossEnabled')}
              {pairNumber('blend', 'lossBlend', 5)}
              {pairCheck('interruptOnThirdPartyHit', 'interruptOnThirdPartyHit')}
              {pairCheck('enabled', 'effectsEnabled')}
            </Category>
          )}
          <CarryFields action={a} w={w} change={change} edit={edit} focused={!!focused} compact={integrated} />
          {pair.carry && (
            // Every carry fixes its target: at the lift's end unless a moment is given.
            <Category title={t('node.carryFix')} initialOpen>
              <Prop
                id="mode"
                label={t('carryFix.at')}
                hint={t('carryFix.hint')}
                value={pair.carry.fix ? 'time' : 'end'}
                initial="end"
                options={[
                  ['end', t('carryFix.liftEnd')],
                  ['time', t('carryFix.time')],
                ]}
                change={mode => pp({carry: {...pair.carry!, fix: mode === 'time' ? defaultCarryFix() : null}})}
              />
              {pair.carry.fix && (
                <DetailRow label={t('carryFix.time')}>
                  <TimeField
                    value={pair.carry.fix.at}
                    change={at => pp({carry: {...pair.carry!, fix: {at}}})}
                    label={t('carryFix.time')}
                    bases={['seconds']}
                  />
                </DetailRow>
              )}
            </Category>
          )}
        </>
      )}
      {/* Camera restore: any action (10-16, runtime 0.12.260); it was a pair's before. */}
      <Category
        sectionId="camera"
        title={t('node.cameraRestore')}
        summary={a.cameraEnabled ? cameraReset(w, camera) : tr('사용 안 함')}
      >
        {!focused && (
          <Prop
            id="enabled"
            value={!!a.cameraEnabled}
            initial={false}
            change={cameraEnabled =>
              change({
                ...a,
                cameraEnabled,
                camera,
                pair: a.pair && cameraEnabled ? {...a.pair, effectsEnabled: true} : a.pair,
              })
            }
          />
        )}
        {w.globals.cameraReset !== null && (
          <Prop
            id="mode"
            label={tr('복구 이벤트 기준')}
            hint={tr(
              '프로젝트 공통은 프로젝트 설정의 이벤트를 모든 동작이 함께 씁니다. 이 동작만은 이 동작에만 다른 이벤트를 씁니다.'
            )}
            value={camera.own ? 'own' : 'project'}
            initial="project"
            options={[
              ['project', tr('프로젝트 공통')],
              ['own', tr('이 동작만')],
            ]}
            change={scope => {
              const {own: _, ...rest} = camera;
              // Its own event starts as the project's, then is changed below.
              setCamera(
                scope === 'own'
                  ? {...rest, own: true, reset: camera.own ? rest.reset : (w.globals.cameraReset ?? '')}
                  : rest
              );
            }}
          />
        )}
        {camera.own || w.globals.cameraReset === null ? (
          <Prop id="restoreMarker" value={camera.reset} change={reset => setCamera({...camera, reset})}>
            <EventPicker
              label={labelText('restoreMarker')}
              empty={tr('없음')}
              value={camera.reset}
              events={markerNames(w)}
              change={reset => setCamera({...camera, reset})}
            />
          </Prop>
        ) : (
          <DetailRow id="restoreMarker">
            {/* The project's event, read only here: its name and a link to where it is set, on one line. */}
            <span className="detail-inline">
              <span>{w.globals.cameraReset}</span>
              <button className="moment-link" onClick={onGlobalSettings} title={t('detail.restoreSettings')}>
                ↗
              </button>
            </span>
          </DetailRow>
        )}
        <Prop
          id="restoreWhen"
          value={camera.restore}
          initial="end"
          change={restore => setCamera({...camera, restore})}
          options={['end', 'event'].map(v => [v, t('detail.' + (v === 'event' ? 'marker' : v))])}
        />
        <Prop
          id="timeout"
          value={camera.timeout}
          initial={10}
          max={60}
          change={timeout => setCamera({...camera, timeout})}
        />
      </Category>
      <Category sectionId="identifiers" group="info" title={tr('식별 정보')} summary={p.actionId} initialOpen>
        <Prop id="internalId" label="Action ID" value={p.actionId} change={actionId => patch({actionId})} />
        {integrated &&
          p.steps
            .filter(s => s.id === (stepId || p.entry))
            .map(s => (
              <Prop
                key={s.id}
                id="name"
                label={tr('클립 표시 이름')}
                value={s.label}
                change={label => patch({steps: p.steps.map(x => (x.id === s.id ? {...x, label} : x))})}
              />
            ))}
        {p.steps
          .filter(s => !stepId || s.id === stepId)
          .map(s => (
            <DetailRow key={s.id} label={tr('클립 ID · ') + s.label}>
              <code>{s.id}</code>
            </DetailRow>
          ))}
        <DetailRow id="graphs">
          <span>{pair ? tr('페어 동기화 경로') : 'FullBodyPlayerIdles'}</span>
        </DetailRow>
      </Category>
    </DetailPanel>
  );
}
