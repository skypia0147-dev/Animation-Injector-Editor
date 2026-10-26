import {useState} from 'react';
import type {Workspace, Link} from '../workspace.ts';
import {choosesOrdinary, frontAngle, frontRange, type StartCard} from '../cards.ts';
import {DetailPanel, DetailRow} from '../ui/details/DetailRow.tsx';
import {KeyField} from '../ui/details/KeyField.tsx';
import {EventPicker} from '../ui/details/EventPicker.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {WindowFields} from '../ui/details/ClipWindowFields.tsx';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {ConditionExpressionEditor} from './ConditionExpressionEditor.tsx';
import {sharesSourceWindow} from './playback.ts';
import {sourceWindow} from './clipWindows.ts';
import {dropBinding} from './flat.ts';
import {addCondition, addRow, moveRow, removeCondition, removeRow, setTrue, type CardPlace} from './cardCommands.ts';
import {eventListError, uniqueEvents} from '../runtimeExtensions.ts';
import {tr} from '../i18n/korean.ts';
import type {GameControl} from '../keys.ts';

type Edit = (f: (w: Workspace) => Workspace) => void;

/** A start card's settings (XML format 6 <Start>): its trigger, the cooldown and block that are this start's. */
export function StartCardFields({w, uid, edit}: {w: Workspace; uid: string; edit: Edit}) {
  const s = w.starts.find(s => s.uid === uid);
  const [blockText, setBlockText] = useState<string | null>(null);
  if (!s) return null;
  const change = (patch: Partial<StartCard>) =>
    edit(w => ({...w, starts: w.starts.map(x => (x.uid === uid ? {...x, ...patch} : x))}));
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
  return (
    <DetailPanel>
      <DetailRow label={tr('트리거')}>
        <select
          aria-label={tr('시작 트리거')}
          value={s.mode}
          onChange={e =>
            change(
              e.target.value === 'event'
                ? {mode: 'event', key: '', gamepad: 0, onKeyUp: false}
                : {mode: 'input', event: '', actor: 'both', target: 'nearest', key: s.key || 'Num0'}
            )
          }
        >
          <option value="input">{tr('키 입력')}</option>
          <option value="event">{tr('이벤트')}</option>
        </select>
      </DetailRow>
      {s.mode === 'input' ? (
        <>
          <DetailRow label={tr('키')}>
            <KeyField
              value={s.key}
              gamepad={s.gamepad}
              change={key => change({key})}
              changeGamepad={gamepad => change({gamepad})}
              control={s.control}
              changeControl={control =>
                change(control ? {control, key: '', gamepad: 0} : {control: undefined, key: 'Num0'})
              }
            />
          </DetailRow>
          <DetailRow label={tr('뗄 때')} hint={tr('키를 뗄 때 시작합니다.')}>
            <input type="checkbox" checked={s.onKeyUp} onChange={e => change({onKeyUp: e.target.checked})} />
          </DetailRow>
        </>
      ) : (
        <>
          <DetailRow label={tr('이벤트')}>
            <EventPicker
              label={tr('이벤트')}
              value={s.event}
              events={markerNames(w)}
              change={event => change({event})}
            />
          </DetailRow>
          <DetailRow label={tr('보낸 쪽')} hint={tr('이 이벤트를 보낸 액터가 플레이어일 때, NPC일 때, 둘 다.')}>
            <select value={s.actor} onChange={e => change({actor: e.target.value as StartCard['actor']})}>
              <option value="both">{tr('둘 다')}</option>
              <option value="player">{tr('플레이어')}</option>
              <option value="npc">NPC</option>
            </select>
          </DetailRow>
          {pairTarget && (
            <DetailRow
              label={tr('페어 상대')}
              hint={tr('페어를 시작할 때 상대: 가장 가까운 액터 또는 보낸 쪽의 전투 대상.')}
            >
              <select value={s.target} onChange={e => change({target: e.target.value as StartCard['target']})}>
                <option value="nearest">{tr('가장 가까운 액터')}</option>
                <option value="combatTarget">{tr('전투 대상')}</option>
              </select>
            </DetailRow>
          )}
        </>
      )}
      {ordinary && (
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
      )}
      <DetailRow
        label={tr('쿨다운')}
        hint={tr(
          '이 시작이 시작시킨 동작이 끝난 뒤, 이 시작만 기다리는 시간(초)입니다. 다른 시작·전환은 막지 않습니다.'
        )}
      >
        <NumberInput value={s.cooldown} min={0} max={600} step={0.05} change={cooldown => change({cooldown})} />
      </DetailRow>
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
    </DetailPanel>
  );
}

/** A transition card's settings: its key or event, the window it is taken in, its blend. */
export function TransitionFields({w, id, edit}: {w: Workspace; id: string; edit: Edit}) {
  const l = w.links.find(l => l.id === id);
  if (!l) return null;
  const from = w.actions.find(a => a.uid === l.from);
  const change = (patch: Partial<Link>) =>
    edit(w => ({...w, links: w.links.map(x => (x.id === id ? {...x, ...patch} : x))}));
  const input = from?.config.inputs.find(i => i.id === l.input);
  /** The key lives in the source HKX's inputs (written in place in the XML). */
  const setKey = (key: string, gamepad: number, control?: GameControl) =>
    edit(w => {
      const n = structuredClone(w),
        a = n.actions.find(a => a.uid === l.from)!,
        link = n.links.find(x => x.id === id)!;
      let i = a.config.inputs.find(i => i.id === link.input);
      // A binding something else also uses (another transition with the same key, a carry, a shared input): this
      // transition gets its own instead of changing theirs.
      const others = i
        ? n.sharedInputs.some(s => s.id === i!.id) ||
          n.links.some(x => x !== link && x.from === a.uid && x.mode === 'input' && x.input === i!.id) ||
          a.pair?.carry?.input === i.id
        : false;
      if (!i || others) {
        let k = 1;
        while (a.config.inputs.some(i => i.id === 'binding' + k)) k++;
        i = {id: 'binding' + k, label: 'binding' + k, key: '', gamepad: 0};
        a.config.inputs.push(i);
        link.input = i.id;
      }
      i.key = key;
      i.gamepad = gamepad;
      if (control) i.control = control;
      else delete i.control;
      return n;
    });
  const shared = sharesSourceWindow(w, l) && !l.ownWindow;
  const to = w.actions.find(a => a.uid === l.to);
  const blendable = !!to && !l.card && !from?.pair && !to.pair;
  return (
    <DetailPanel>
      <DetailRow label={tr('입력')}>
        <select
          value={l.mode}
          onChange={e =>
            e.target.value === 'event'
              ? edit(w =>
                  dropBinding(
                    {...w, links: w.links.map(x => (x.id === id ? {...x, mode: 'event' as const, input: ''} : x))},
                    l.from,
                    l.input
                  )
                )
              : change({mode: 'input', event: '', window: true})
          }
        >
          <option value="input">{tr('키 입력')}</option>
          <option value="event">{tr('이벤트')}</option>
        </select>
      </DetailRow>
      {l.mode === 'input' ? (
        <DetailRow label={tr('키')}>
          <KeyField
            value={input?.key ?? ''}
            gamepad={input?.gamepad ?? 0}
            change={key => setKey(key, input?.gamepad ?? 0)}
            changeGamepad={gamepad => setKey(input?.key ?? '', gamepad)}
            control={input?.control}
            changeControl={control => (control ? setKey('', 0, control) : setKey('E', 0))}
          />
        </DetailRow>
      ) : (
        <DetailRow label={tr('이벤트')}>
          <EventPicker label={tr('이벤트')} value={l.event} events={markerNames(w)} change={event => change({event})} />
        </DetailRow>
      )}
      {sharesSourceWindow(w, l) && (
        <DetailRow
          label={tr('감지 구간')}
          hint={tr(
            '이 HKX 공통: 출발 HKX의 입력 감지를 이 HKX의 다른 키 전환과 함께 씁니다. 이 전환만: 이 전환의 열림·닫힘을 따로 둡니다.'
          )}
        >
          <select
            value={l.ownWindow ? 'own' : 'shared'}
            onChange={e =>
              edit(w => ({
                ...w,
                links: w.links.map(x => {
                  if (x.id !== id) return x;
                  const {ownWindow, ...rest} = x;
                  return e.target.value === 'own'
                    ? {
                        ...rest,
                        ownWindow: true,
                        window: true,
                        ...structuredClone(sourceWindow(from!, from!.config.entry).value),
                      }
                    : rest;
                }),
              }))
            }
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
      {blendable && (
        <DetailRow label={tr('블렌드')} hint={tr('이 전환으로 들어갈 때의 블렌드(초). 비우면 도착 HKX의 시작 블렌드.')}>
          <span>
            <input
              type="checkbox"
              aria-label={tr('블렌드 사용')}
              checked={l.blend !== undefined}
              onChange={e => change({blend: e.target.checked ? 0.3 : undefined})}
            />
            {l.blend !== undefined && (
              <NumberInput value={l.blend} min={0} max={5} step={0.05} change={blend => change({blend})} />
            )}
          </span>
        </DetailRow>
      )}
    </DetailPanel>
  );
}

/** A condition card's body (docs/mockup-format6-editor): its common conditions, then its rows (each with its
 *  conditions) or True; where each goes is the route row at the card's foot. */
export function ConditionCardBody({
  w,
  uid,
  edit,
  focus,
  status,
}: {
  w: Workspace;
  uid: string;
  edit: Edit;
  focus?: string;
  status: (s: string) => void;
}) {
  const c = w.cards.find(c => c.uid === uid);
  if (!c) return null;
  const attempt = (f: (w: Workspace) => Workspace) => {
    try {
      edit(f);
    } catch (e) {
      status(String(e));
    }
  };
  const roots = (place: CardPlace, ids: string[]) =>
    ids.map(id => (
      <ConditionExpressionEditor
        key={id}
        embedded
        w={w}
        owner={uid}
        id={id}
        edit={edit}
        focus={focus}
        remove={() => edit(w => removeCondition(w, uid, place, id))}
      />
    ));
  const adders = (place: CardPlace) => (
    <div className="condition-expression-tools">
      <button onClick={() => attempt(w => addCondition(w, uid, place).workspace)}>{tr('＋ 조건')}</button>
      <button onClick={() => attempt(w => addCondition(w, uid, place, true).workspace)}>{tr('＋ 그룹')}</button>
    </div>
  );
  return (
    <div className="condition-card-body">
      <section className="condition-card-part">
        <div className="condition-card-part-title">{tr('공통 조건')}</div>
        {roots('guards', c.guards)}
        {!c.guards.length && <p className="checklist-entry-empty">{tr('없음 · 모든 경우')}</p>}
        {adders('guards')}
      </section>
      {c.true !== undefined ? (
        <section className="condition-card-part">
          <div className="condition-card-row-head">
            <span className="key true">True</span>
            <span>{tr('공통 조건이 맞으면')}</span>
            <button onClick={() => attempt(w => setTrue(w, uid, false))}>{tr('행으로 바꾸기')}</button>
          </div>
        </section>
      ) : (
        c.rows.map((r, i) => (
          <section key={r.id} className="condition-card-part">
            <div className="condition-card-row-head">
              <span className="key">{i + 1}</span>
              <span>{tr('행 {n}', {n: i + 1})}</span>
              <button
                disabled={i === 0}
                onClick={() => attempt(w => moveRow(w, uid, r.id, i - 1))}
                aria-label={tr('위로')}
              >
                ↑
              </button>
              <button
                disabled={i === c.rows.length - 1}
                onClick={() => attempt(w => moveRow(w, uid, r.id, i + 1))}
                aria-label={tr('아래로')}
              >
                ↓
              </button>
              <button onClick={() => attempt(w => removeRow(w, uid, r.id))} aria-label={tr('행 삭제')}>
                ×
              </button>
            </div>
            {roots(`row:${r.id}`, r.guards)}
            {adders(`row:${r.id}`)}
          </section>
        ))
      )}
      <div className="condition-expression-tools">
        {c.true === undefined && <button onClick={() => attempt(w => addRow(w, uid).workspace)}>{tr('＋ 행')}</button>}
        {c.true === undefined && c.rows.length <= 1 && (
          <button onClick={() => attempt(w => setTrue(w, uid, true))}>{tr('True로 (공통 조건만)')}</button>
        )}
      </div>
    </div>
  );
}
