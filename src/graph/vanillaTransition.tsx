import type {Action, Link, Workspace} from '../workspace.ts';
import {timingLabel} from '../model.ts';
import {DetailRow} from '../ui/details/DetailRow.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {WindowFields} from '../ui/details/ClipWindowFields.tsx';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {MultiValuePicker} from './MultiValuePicker.tsx';
import {SettingRows, useSettings, type Setting} from './cardSettings.tsx';
import {cancelToLink} from './cardEdits.ts';
import {joinTargets, listItems, vanillaChoices, vanillaNames, vanillaTargets} from './vanilla.ts';
import {tr} from '../i18n/korean.ts';

// A vanilla transition (runtime <Vanilla to>, 11-01, docs/mockup-moment-effects ④): a transition card whose input is
// the game's own action. It stays the action's `cancels` item; the card shows it as a transition (A7).

type Edit = (f: (w: Workspace) => Workspace) => void;
type Cancel = Action['cancels'][number];

/** The chosen actions (공격 takes the power attack along) and the events written by hand. */
export function VanillaTargets({to, change}: {to: string; change: (to: string) => void}) {
  const {aliases, events} = vanillaTargets(to);
  const attack = aliases.includes('Attack');
  const choices = vanillaChoices().filter(([k]) => !(attack && k === 'PowerAttack'));
  return (
    <>
      <DetailRow label={tr('동작')} hint={tr('이 동작을 하면 넘어갑니다. 「공격」은 강공격도 포함합니다.')}>
        <MultiValuePicker
          value={aliases.join(',')}
          choices={choices}
          label={tr('바닐라 동작')}
          change={value => {
            const next = value.split(',').filter(Boolean);
            change(joinTargets(next.includes('Attack') ? next.filter(k => k !== 'PowerAttack') : next, events));
          }}
        />
      </DetailRow>
      <DetailRow
        label={tr('직접 입력')}
        hint={tr('목록에 없는 그래프 이벤트 이름의 일부(고급). 쉼표로 여럿을 씁니다.')}
      >
        <input
          aria-label={tr('직접 입력')}
          placeholder={tr('그래프 이벤트 이름 일부 (고급)')}
          value={events.join(',')}
          onChange={e => change(joinTargets(aliases, listItems(e.target.value)))}
        />
      </DetailRow>
    </>
  );
}

const putCancel = (w: Workspace, action: string, id: string, patch: (c: Cancel) => Cancel): Workspace => ({
  ...w,
  actions: w.actions.map(a =>
    a.uid === action ? {...a, cancels: a.cancels.map(c => (c.id === id ? patch(c) : c))} : a
  ),
});
function useVanillaSettings(w: Workspace, action: string, id: string, edit: Edit): Setting[] {
  const a = w.actions.find(a => a.uid === action),
    c = a?.cancels.find(c => c.id === id);
  if (!a || !c) return [];
  const update = (patch: (c: Cancel) => Cancel) => edit(w => putCancel(w, action, id, patch));
  const names = vanillaNames(c.to);
  return [
    {
      id: 'trigger',
      label: tr('바닐라 동작'),
      value: names.length ? (
        names.map(n => (
          <span key={n} className="cond-chip">
            {n}
          </span>
        ))
      ) : (
        <span className="cond-chip">{tr('대상 없음')}</span>
      ),
      set: true,
      fixed: true,
      fields: () => (
        <>
          <DetailRow
            label={tr('입력')}
            hint={tr(
              '바닐라 동작: 감지 구간 안에서 플레이어가 그 바닐라 동작(공격 버튼 등)을 하면, 이 클립을 끝내고 게임 원래 동작으로 넘어갑니다. 키 설정·패드와 상관없이 게임 입력을 그대로 씁니다.'
            )}
          >
            <select
              value="vanilla"
              onChange={e => edit(w => cancelToLink(w, action, id, e.target.value as Link['mode']))}
            >
              <option value="input">{tr('키 입력')}</option>
              <option value="event">{tr('이벤트')}</option>
              <option value="end" disabled={!!a.config.loop}>
                {tr('끝나면')}
              </option>
              <option value="release">{tr('차지 종료')}</option>
              <option value="move">{tr('이동 전환')}</option>
              <option value="vanilla">{tr('바닐라 동작')}</option>
            </select>
          </DetailRow>
          <VanillaTargets to={c.to} change={to => update(c => ({...c, to}))} />
        </>
      ),
    },
    {
      id: 'window',
      label: tr('감지 구간'),
      value: c.always ? tr('클립 전체') : timingLabel(c.open) + ' → ' + timingLabel(c.close),
      set: true,
      fixed: true,
      fields: () => (
        <>
          <DetailRow label={tr('감지 구간 사용')} hint={tr('끄면 클립 전체에서 받습니다.')}>
            <input
              type="checkbox"
              checked={!c.always}
              onChange={e =>
                update(c => {
                  const {always: _, ...rest} = c;
                  return e.target.checked ? rest : {...rest, always: true as const};
                })
              }
            />
          </DetailRow>
          {!c.always && (
            <WindowFields
              w={w}
              action={a}
              value={{open: c.open, close: c.close, buffered: c.buffered}}
              events={markerNames(w)}
              closeBasis="either"
              change={next => update(c => ({...c, ...next}))}
            />
          )}
        </>
      ),
    },
    {
      id: 'blend',
      label: tr('블렌드'),
      value: c.blend === null ? '' : tr('{v0}초', {v0: c.blend}),
      set: c.blend !== null,
      add: () => update(c => ({...c, blend: 0.1})),
      reset: () => update(c => ({...c, blend: null})),
      fields: () => (
        <DetailRow label={tr('블렌드')} hint={tr('이 전환으로 나갈 때의 블렌드 길이(초). 없으면 HKX의 종료 블렌드.')}>
          <NumberInput
            aria-label={tr('블렌드')}
            min="0"
            max="5"
            step="0.05"
            value={c.blend ?? 0.1}
            change={v => update(c => ({...c, blend: v}))}
          />
        </DetailRow>
      ),
    },
    {
      id: 'xmlId',
      label: 'ID',
      value: c.xmlId ?? '',
      set: !!c.xmlId,
      add: () => update(c => ({...c, xmlId: c.id})),
      reset: () =>
        update(c => {
          const {xmlId: _, ...rest} = c;
          return rest;
        }),
      fields: () => (
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
              update(c => {
                const {xmlId: _, ...rest} = c;
                return xmlId ? {...rest, xmlId} : rest;
              });
            }}
          />
        </DetailRow>
      ),
    },
  ];
}

/** The card: its settings, then where it goes, the game's own action (no line leaves it). */
export function VanillaFace({
  w,
  action,
  id,
  edit,
  fold,
}: {
  w: Workspace;
  action: string;
  id: string;
  edit: Edit;
  fold?: boolean;
}) {
  return (
    <SettingRows
      settings={useSettings(useVanillaSettings(w, action, id, edit), fold)}
      after={
        <div className="route-face">
          <div className="route-box tone-plain">
            <span className="route-label">{tr('도착')}</span>
            <span className="cond-to-wrap">
              <span className="cond-chip vanilla-goal">{tr('게임 원래 동작')}</span>
            </span>
          </div>
        </div>
      }
    />
  );
}
