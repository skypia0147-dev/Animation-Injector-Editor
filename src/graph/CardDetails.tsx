import {useState} from 'react';
import type {Workspace, Link} from '../workspace.ts';
import {
  choosesOrdinary,
  frontAngle,
  frontRange,
  menuControl,
  pressName,
  pressTrigger,
  startPresses,
  type StartCard,
} from '../cards.ts';
import {DetailRow} from '../ui/details/DetailRow.tsx';
import {KeyField} from '../ui/details/KeyField.tsx';
import {EventPicker} from '../ui/details/EventPicker.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {WindowFields} from '../ui/details/ClipWindowFields.tsx';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {sharesSourceWindow} from './playback.ts';
import {eventListError, uniqueEvents} from '../runtimeExtensions.ts';
import {tr} from '../i18n/korean.ts';
import {gamepadXml, gameControlLabel, type GameControl} from '../keys.ts';
import {timingLabel} from '../model.ts';
import type {Setting} from './cardSettings.tsx';
import {
  linkBlend,
  patchLink,
  patchStart,
  setLinkKey,
  setLinkMode,
  setReleaseKey,
  setLinkWindowScope,
  startDefaults,
  startMode,
} from './cardEdits.ts';

type Edit = (f: (w: Workspace) => Workspace) => void;
const chip = (text: string) => <span className="cond-chip">{text}</span>;
const keyText = (key: string, gamepad: number, control?: GameControl) =>
  control ? gameControlLabel(control) : [key, gamepad ? gamepadXml(gamepad) : ''].filter(Boolean).join(' · ');

/** A start card's settings (XML format 6 <Start>), edited on the card (unify ⑨): its trigger, then what is set of
 *  the sender, target, cooldown and block; the rest from 「＋ 설정」. */
export function useStartSettings(w: Workspace, uid: string, edit: Edit): Setting[] {
  const s = w.starts.find(s => s.uid === uid);
  const [blockText, setBlockText] = useState<string | null>(null);
  if (!s) return [];
  const change = (patch: Partial<StartCard>) => edit(w => patchStart(w, uid, patch));
  // A start choosing among ordinary actions picks its target (mockup ⑨, runtime 0.12.299); a pair's start names
  // its partner as before.
  const ordinary = choosesOrdinary(w, s);
  const pairTarget =
    !ordinary &&
    (() => {
      const to =
        s.to && 'action' in s.to ? w.actions.find(a => a.uid === (s.to as {action: string}).action) : undefined;
      return !to || !!to.pair;
    })();
  const blockError = blockText !== null ? eventListError(blockText.split(',')) : '';
  const input = s.mode === 'input';
  return [
    {
      id: 'trigger',
      label: input ? pressTrigger(s.press) : tr('받을 때'),
      value: chip(input ? keyText(s.key, s.gamepad, s.control) || tr('키 미지정') : s.event || tr('이벤트 미지정')),
      set: true,
      fixed: true,
      fields: () => (
        <>
          <DetailRow label={tr('트리거')}>
            <select
              aria-label={tr('시작 트리거')}
              value={s.mode}
              onChange={e => change(startMode(s, e.target.value as StartCard['mode']))}
            >
              <option value="input">{tr('키 입력')}</option>
              <option value="event">{tr('이벤트')}</option>
            </select>
          </DetailRow>
          {input ? (
            <>
              <DetailRow label={tr('키')}>
                <KeyField
                  value={s.key}
                  gamepad={s.gamepad}
                  change={key => change({key})}
                  changeGamepad={gamepad => change({gamepad})}
                  control={s.control}
                  changeControl={control =>
                    change(
                      control
                        ? {control, key: '', gamepad: 0, ...(menuControl(control) ? {press: 'down' as const} : {})}
                        : {control: undefined, key: 'Num0'}
                    )
                  }
                />
              </DetailRow>
              <DetailRow
                label={tr('누름')}
                hint={tr(
                  '누를 때: 누르는 순간. 짧게: 짧게 눌렀다 뗄 때. 두 번: 빠르게 두 번 누를 때(두 번째를 길게 눌러도 두 번). 길게: 누른 채 기준 시간을 넘길 때. 게임 동작의 누름은 어떤 시작도 가져가지 않으면 게임에 돌려줍니다(기다린 만큼 늦게).'
                )}
              >
                <select
                  aria-label={tr('누름')}
                  value={s.press}
                  title={
                    menuControl(s.control)
                      ? tr('메뉴를 여는 게임 동작은 누르는 순간 메뉴가 열려 누를 때만 씁니다.')
                      : undefined
                  }
                  onChange={e => change({press: e.target.value as StartCard['press']})}
                >
                  {startPresses.map(p => (
                    <option key={p} value={p} disabled={p !== 'down' && menuControl(s.control)}>
                      {pressName(p)}
                    </option>
                  ))}
                </select>
              </DetailRow>
            </>
          ) : (
            <DetailRow label={tr('이벤트')}>
              <EventPicker
                label={tr('이벤트')}
                value={s.event}
                events={markerNames(w)}
                change={event => change({event})}
              />
            </DetailRow>
          )}
        </>
      ),
    },
    {
      id: 'actor',
      label: tr('보낸 쪽'),
      value: s.actor === 'player' ? tr('플레이어') : s.actor === 'npc' ? 'NPC' : tr('둘 다'),
      set: s.actor !== 'both',
      applies: !input,
      reset: () => change(startDefaults.actor),
      fields: () => (
        <DetailRow label={tr('보낸 쪽')} hint={tr('이 이벤트를 보낸 액터가 플레이어일 때, NPC일 때, 둘 다.')}>
          <select value={s.actor} onChange={e => change({actor: e.target.value as StartCard['actor']})}>
            <option value="both">{tr('둘 다')}</option>
            <option value="player">{tr('플레이어')}</option>
            <option value="npc">NPC</option>
          </select>
        </DetailRow>
      ),
    },
    {
      id: 'partner',
      label: tr('페어 상대'),
      value: s.target === 'combatTarget' ? tr('전투 대상') : tr('가장 가까운 액터'),
      set: s.target === 'combatTarget',
      applies: !input && !!pairTarget,
      reset: () => change(startDefaults.partner),
      fields: () => (
        <DetailRow
          label={tr('페어 상대')}
          hint={tr('페어를 시작할 때 상대: 가장 가까운 액터 또는 보낸 쪽의 전투 대상.')}
        >
          <select value={s.target} onChange={e => change({target: e.target.value as StartCard['target']})}>
            <option value="nearest">{tr('가장 가까운 액터')}</option>
            <option value="combatTarget">{tr('전투 대상')}</option>
          </select>
        </DetailRow>
      ),
    },
    {
      id: 'target',
      label: tr('대상'),
      value:
        s.target === 'combatTarget'
          ? tr('전투 대상')
          : tr('전방 대상 · {range} · {angle}°', {range: s.range ?? frontRange, angle: s.angle ?? frontAngle}),
      set: s.target === 'combatTarget' || s.range !== undefined || s.angle !== undefined,
      applies: ordinary,
      reset: () => change(startDefaults.target),
      fields: () => (
        <>
          <DetailRow
            label={tr('대상')}
            hint={tr(
              '조건의 「상대」와 공간 확보에서 빼고 볼 액터입니다. 전방 대상: 본인 앞 부채꼴 안에서 가장 가까운 액터. 전투 대상: 보낸 쪽(키면 플레이어)의 전투 대상.'
            )}
          >
            <select
              aria-label={tr('대상')}
              value={s.target}
              onChange={e => change({target: e.target.value as StartCard['target']})}
            >
              <option value="nearest">{tr('전방 대상')}</option>
              <option value="combatTarget">{tr('전투 대상')}</option>
            </select>
          </DetailRow>
          {s.target === 'nearest' && (
            <>
              <DetailRow label={tr('거리')} hint={tr('게임 거리 단위입니다.')}>
                <NumberInput
                  value={s.range ?? frontRange}
                  min={1}
                  max={2000}
                  step={10}
                  change={range => change({range})}
                />
              </DetailRow>
              <DetailRow label={tr('각도')} hint={tr('본인 앞 부채꼴의 전체 각도(도)입니다.')}>
                <NumberInput
                  value={s.angle ?? frontAngle}
                  min={1}
                  max={360}
                  step={5}
                  change={angle => change({angle})}
                />
              </DetailRow>
            </>
          )}
        </>
      ),
    },
    {
      id: 'cooldown',
      label: tr('쿨다운'),
      value: tr('{v0}초', {v0: s.cooldown}),
      set: s.cooldown > 0,
      reset: () => change(startDefaults.cooldown),
      fields: () => (
        <DetailRow
          label={tr('쿨다운')}
          hint={tr(
            '이 시작이 시작시킨 동작이 끝난 뒤, 이 시작만 기다리는 시간(초)입니다. 다른 시작·전환은 막지 않습니다.'
          )}
        >
          <NumberInput value={s.cooldown} min={0} max={600} step={0.05} change={cooldown => change({cooldown})} />
        </DetailRow>
      ),
    },
    {
      id: 'block',
      label: tr('바닐라 차단'),
      value: (
        <span className="cond-chips">
          {s.block?.events.map(e => (
            <span key={e} className="cond-chip">
              {e}
            </span>
          ))}
        </span>
      ),
      set: !!s.block,
      reset: () => change(startDefaults.block),
      fields: () => (
        <>
          <DetailRow
            label={tr('바닐라 차단')}
            hint={tr('쉼표로 나눈 바닐라 이벤트(예: blockStart,bashStart). 비우면 차단하지 않습니다.')}
          >
            <input
              value={blockText ?? s.block?.events.join(',') ?? ''}
              aria-invalid={!!blockError || undefined}
              onChange={e => {
                const text = e.target.value;
                setBlockText(text);
                const list = text.split(',').map(x => x.trim());
                if (!text.trim()) change({block: undefined});
                else if (!eventListError(list))
                  change({block: {events: uniqueEvents(list), when: s.block?.when ?? 'startable'}});
              }}
              onBlur={() => setBlockText(null)}
            />
          </DetailRow>
          {s.block && (
            <DetailRow label={tr('차단 시점')}>
              <select
                value={s.block.when}
                onChange={e => change({block: {...s.block!, when: e.target.value as 'startable' | 'active' | 'both'}})}
              >
                <option value="startable">{tr('시작할 수 있을 때')}</option>
                <option value="active">{tr('시작시킨 동작이 재생 중일 때')}</option>
                <option value="both">{tr('둘 다')}</option>
              </select>
            </DetailRow>
          )}
          {blockError && <p role="alert">{blockError}</p>}
        </>
      ),
    },
  ];
}

/** A transition card's settings, edited on the card (unify ⑨): its key or event, the window it is taken in, its blend
 *  (set only to differ from the destination HKX's start blend). */
export function useTransitionSettings(w: Workspace, id: string, edit: Edit): Setting[] {
  const l = w.links.find(l => l.id === id);
  if (!l) return [];
  const from = w.actions.find(a => a.uid === l.from);
  const change = (patch: Partial<Link>) => edit(w => patchLink(w, id, patch));
  const inputBinding = from?.config.inputs.find(i => i.id === l.input);
  const setKey = (key: string, gamepad: number, control?: GameControl) =>
    edit(w => setLinkKey(w, id, key, gamepad, control));
  const shared = sharesSourceWindow(w, l) && !l.ownWindow;
  const to = w.actions.find(a => a.uid === l.to);
  const blendable = !!to && !l.card && !from?.pair && !to.pair;
  // A key's press, or (charge) a key let go: the key of its own, or the one that started the action.
  const keyed = l.mode === 'input' || (l.mode === 'release' && !!l.input);
  const keyName =
    keyText(inputBinding?.key ?? '', inputBinding?.gamepad ?? 0, inputBinding?.control) || tr('키 미지정');
  return [
    {
      id: 'trigger',
      label:
        l.mode === 'input'
          ? tr('누를 때')
          : l.mode === 'end'
            ? tr('끝나면')
            : l.mode === 'release'
              ? tr('키를 떼면')
              : l.mode === 'move'
                ? tr('이동키를 누르면')
                : tr('받을 때'),
      value: chip(
        l.mode === 'end'
          ? tr('이 HKX가 끝날 때')
          : l.mode === 'move'
            ? tr('이동키 · 선입력·유지 포함')
            : l.mode === 'event'
              ? l.event || tr('이벤트 미지정')
              : keyed
                ? keyName
                : tr('시작한 키')
      ),
      set: true,
      fixed: true,
      fields: () => (
        <>
          <DetailRow
            label={tr('입력')}
            hint={tr(
              '끝나면: 이 HKX가 끝나는 순간(종료 지점) 끝내는 대신 넘어갑니다. 키를 떼면: 감지 구간 안에서 키가 떼져 있으면 넘어갑니다(구간 전에 뗐으면 구간이 열리는 순간).'
            )}
          >
            <select value={l.mode} onChange={e => edit(w => setLinkMode(w, id, e.target.value as Link['mode']))}>
              <option value="input">{tr('키 입력')}</option>
              <option value="event">{tr('이벤트')}</option>
              <option value="end" disabled={!!from?.config.loop}>
                {tr('끝나면')}
              </option>
              <option value="release">{tr('키를 떼면')}</option>
              <option value="move">{tr('이동키를 누르면')}</option>
            </select>
          </DetailRow>
          {l.mode === 'release' && (
            <DetailRow
              label={tr('뗄 키')}
              hint={tr('시작한 키: 이 동작을 시작한 키(끝나면·키를 떼면으로 이어진 동안 유지).')}
            >
              <select
                value={l.input ? 'own' : 'start'}
                onChange={e => edit(w => setReleaseKey(w, id, e.target.value === 'own'))}
              >
                <option value="start">{tr('시작한 키')}</option>
                <option value="own">{tr('직접 지정')}</option>
              </select>
            </DetailRow>
          )}
          {l.mode === 'end' || l.mode === 'move' || (l.mode === 'release' && !keyed) ? null : keyed ? (
            <DetailRow label={tr('키')}>
              <KeyField
                value={inputBinding?.key ?? ''}
                gamepad={inputBinding?.gamepad ?? 0}
                change={key => setKey(key, inputBinding?.gamepad ?? 0)}
                changeGamepad={gamepad => setKey(inputBinding?.key ?? '', gamepad)}
                control={inputBinding?.control}
                changeControl={control => (control ? setKey('', 0, control) : setKey('E', 0))}
              />
            </DetailRow>
          ) : (
            <DetailRow label={tr('이벤트')}>
              <EventPicker
                label={tr('이벤트')}
                value={l.event}
                events={markerNames(w)}
                change={event => change({event})}
              />
            </DetailRow>
          )}
        </>
      ),
    },
    {
      id: 'window',
      label: tr('감지 구간'),
      applies: l.mode !== 'end',
      value: shared
        ? tr('이 HKX 공통')
        : l.window
          ? timingLabel(l.open) + ' → ' + timingLabel(l.close)
          : tr('클립 전체'),
      set: true,
      fixed: true,
      fields: () => (
        <>
          {sharesSourceWindow(w, l) && (
            <DetailRow
              label={tr('감지 구간')}
              hint={tr(
                '이 HKX 공통: 출발 HKX의 입력 감지를 이 HKX의 다른 키 전환과 함께 씁니다. 이 전환만: 이 전환의 열림·닫힘을 따로 둡니다.'
              )}
            >
              <select
                value={l.ownWindow ? 'own' : 'shared'}
                onChange={e => edit(w => setLinkWindowScope(w, id, e.target.value === 'own'))}
              >
                <option value="shared">{tr('이 HKX 공통')}</option>
                <option value="own">{tr('이 전환만')}</option>
              </select>
            </DetailRow>
          )}
          {!shared && (
            <DetailRow label={tr('감지 구간 사용')} hint={tr('끄면 클립 전체에서 받습니다.')}>
              <input type="checkbox" checked={l.window} onChange={e => change({window: e.target.checked})} />
            </DetailRow>
          )}
          {!shared && l.window && (
            <WindowFields
              w={w}
              action={from}
              value={{open: l.open, close: l.close, buffered: l.buffered}}
              events={markerNames(w)}
              closeBasis="either"
              change={next => change(next)}
            />
          )}
        </>
      ),
    },
    {
      id: 'blend',
      label: tr('블렌드'),
      value: tr('{v0}초', {v0: l.blend ?? 0}),
      set: l.blend !== undefined,
      applies: blendable,
      add: () => change(linkBlend.add),
      reset: () => change(linkBlend.reset),
      fields: () => (
        <DetailRow label={tr('블렌드')} hint={tr('이 전환으로 들어갈 때의 블렌드(초). 없으면 도착 HKX의 시작 블렌드.')}>
          <NumberInput value={l.blend ?? 0.3} min={0} max={5} step={0.05} change={blend => change({blend})} />
        </DetailRow>
      ),
    },
  ];
}
