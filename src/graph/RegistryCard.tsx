import {useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {Effect, Workspace} from '../workspace.ts';
import {
  addEventRow,
  addFunction,
  bindSlot,
  arrowModes,
  ragdollDirections,
  ragdollForce,
  ragdollLabels,
  strikeChoices,
  strikeExtras,
  soundBones,
  textSettings,
  eventKey,
  eventOps,
  eventSlots,
  functionSummary,
  isBooleanSetting,
  newEventName,
  registryFields,
  opInfo,
  removeEventRow,
  renameEvent,
  setFunctions,
  shortUses,
  groupUses,
  settingDefault,
  settingLabels,
  settingRange,
  vanillaName,
  type EventOp,
  type RegistryEntry,
} from '../eventRegistry.ts';
import {ChecklistContext} from './ChecklistCard.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {clipKey, roleLabel, sentEvent, useClipAnnotations} from './annotations.ts';
import {timingLabel} from '../model.ts';
import './registry.css';
import {renderedRegistry} from './renderCache.ts';
import {tr} from '../i18n/korean.ts';
import {SoundSourceFields} from '../ui/details/SoundFile.tsx';

// The graph renders only on-screen nodes: a registry node brought into view mounts after the request
// (and may mount twice while the view moves), so a request stays for two seconds.
let pendingRow = {key: '', time: 0};
/** Brings the registry node into view and selects it; with a name, also opens and highlights that
 *  event's row. The graph moves the view, the registry body the row. */
export const showRegistry = (name = '') => {
  pendingRow = {key: name && eventKey(name), time: Date.now()};
  window.dispatchEvent(new CustomEvent('ai-registry-flash', {detail: pendingRow.key}));
};

type Filter = 'all' | 'fn' | 'use' | 'none';
type Sender = {label: string; time: number; uid: string};
/** Where this project's HKX send each event (from their annotations; desktop only). */
function useSenders(w: Workspace): Map<string, Sender[]> {
  const annotations = useClipAnnotations(w);
  return useMemo(() => {
    const out = new Map<string, Sender[]>();
    for (const a of w.actions)
      for (const s of a.config.steps)
        for (const n of annotations.get(clipKey(s.clip)) ?? []) {
          const e = sentEvent(n.text, !!a.pair);
          if (!e) continue;
          const key = eventKey(e.name),
            list = out.get(key) ?? [];
          const role = e.role ? ' · ' + roleLabel[e.role] : '';
          list.push({label: `${a.config.name} · ${s.label || s.id}${role}`, time: n.time, uid: a.uid});
          out.set(key, list);
        }
    return out;
  }, [w, annotations]);
}

export function RegistryBody() {
  const {w, edit} = useContext(ChecklistContext)!;
  const entries = renderedRegistry(w);
  const senders = useSenders(w);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<Filter>('all'),
    [view, setView] = useState<'event' | 'function'>('event'),
    [open, setOpen] = useState<Set<string>>(new Set()),
    [flash, setFlash] = useState(''),
    [error, setError] = useState('');
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  useEffect(() => {
    const reveal = (key: string) => {
      if (!key) return;
      setView('event');
      setFilter('all');
      setQuery('');
      setOpen(s => new Set(s).add(key));
      setFlash(key);
      setTimeout(() => setFlash(f => (f === key ? '' : f)), 2000);
    };
    const listener = (e: Event) => reveal((e as CustomEvent<string>).detail);
    if (Date.now() - pendingRow.time < 2000) reveal(pendingRow.key);
    window.addEventListener('ai-registry-flash', listener);
    return () => window.removeEventListener('ai-registry-flash', listener);
  }, []);
  const withFunctions = entries.filter(e => e.row?.functions.length).length,
    usesOnly = entries.filter(e => !e.row?.functions.length && e.uses.length).length;
  const matches = (e: RegistryEntry) => {
    const fns = e.row?.functions ?? [];
    if (filter === 'fn' && !fns.length) return false;
    if (filter === 'use' && (fns.length || !e.uses.length)) return false;
    if (filter === 'none' && (fns.length || e.uses.length)) return false;
    if (!query) return true;
    const text = [e.name, ...fns.map(f => functionSummary(f.values)), ...e.uses.map(u => u.label)].join(' ');
    return text.toLowerCase().includes(query.toLowerCase());
  };
  const shown = entries.filter(matches);
  const toggle = (key: string) =>
    setOpen(s => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div
      className="checklist-body registry-body nodrag nopan"
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="registry-count">
        <span className="registry-no-port">{tr('연결 없음')}</span>
        {entries.length}
        {tr('개 이벤트 · 기능')} {withFunctions} {tr('· 시점')} {usesOnly}
      </div>
      <p className="registry-intro">
        {tr('이 프로젝트에서 쓰는 이벤트를 전부 여기 등록합니다.')} <b>{tr('기능')}</b>
        {tr('은 전역이라 어느 애니메이션에서 오든 실행되고(다른 모드·바닐라·OAR 포함),')}{' '}
        <b className="use">{tr('용도')}</b>
        {tr('는 감지 창·QTE·회복·트리거처럼 이 프로젝트 HKX의 시점에 쓰입니다.')}
      </p>
      <div className="registry-tools">
        <input
          aria-label={tr('이벤트 검색')}
          placeholder={tr('이벤트·기능·용도 검색')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select aria-label={tr('이벤트 거르기')} value={filter} onChange={e => setFilter(e.target.value as Filter)}>
          <option value="all">{tr('전체')}</option>
          <option value="fn">{tr('기능 있는 이벤트')}</option>
          <option value="use">{tr('시점에만 쓰는 이벤트')}</option>
          <option value="none">{tr('참조 없음')}</option>
        </select>
        <span className="registry-seg" role="group" aria-label={tr('보기')}>
          <button className={view === 'event' ? 'on' : ''} onClick={() => setView('event')}>
            {tr('이벤트별')}
          </button>
          <button className={view === 'function' ? 'on' : ''} onClick={() => setView('function')}>
            {tr('기능별')}
          </button>
        </span>
      </div>
      <div className="registry-rows">
        {view === 'event' && shown.length > 0 && (
          // The column heads, once: each row is one line under them (docs/mockup-registry-oneline A).
          <div className="registry-colhead">
            <span>{tr('이벤트')}</span>
            <span>{tr('하는 일')}</span>
            <span>HKX</span>
          </div>
        )}
        {view === 'event' ? (
          shown.map(e => (
            <RegistryRow
              key={eventKey(e.name)}
              entry={e}
              open={open.has(eventKey(e.name))}
              flash={flash === eventKey(e.name)}
              toggle={() => toggle(eventKey(e.name))}
              senders={senders.get(eventKey(e.name)) ?? []}
              attempt={attempt}
            />
          ))
        ) : (
          <FunctionView
            entries={shown}
            senders={senders}
            jump={key => {
              setView('event');
              setOpen(s => new Set(s).add(key));
              setFlash(key);
            }}
          />
        )}
        {!shown.length && <p className="registry-empty">{tr('조건에 맞는 이벤트가 없습니다.')}</p>}
      </div>
      <div className="registry-add">
        <button
          onClick={() =>
            attempt(() => {
              const name = newEventName(w);
              edit(w => addEventRow(w, name));
              setOpen(s => new Set(s).add(eventKey(name)));
              setFlash(eventKey(name));
            })
          }
        >
          {tr('＋ 이벤트 추가')}
        </button>
      </div>
      {error && (
        <p role="alert" className="checklist-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** What an event does, on its one line (docs/mockup-registry-oneline A): its functions, then its uses (shortUses),
 *  cut with an ellipsis; the whole text on hover and in the open row. */
function whatOf(e: RegistryEntry, senders: Sender[]) {
  const fns = (e.row?.functions ?? []).map(
    f => functionSummary(f.values) + (opInfo[f.values.op as EventOp]?.lasting ? tr(' · 켜 둠') : '')
  );
  const uses = shortUses(e.name, e.uses);
  const none = !fns.length && !uses.length ? (senders.length ? tr('그래프 등록만') : tr('참조 없음')) : '';
  const warn = fns.length && vanillaName(e.name) ? tr('⚠ 게임 전체 적용') : '';
  return (
    <span className="registry-what" title={[...fns, ...uses, none, warn].filter(Boolean).join(' · ')}>
      {fns.map((t, i) => (
        <span key={'f' + i} className="fn">
          {t}
        </span>
      ))}
      {uses.map((t, i) => (
        <span key={'u' + i} className="use">
          {t}
        </span>
      ))}
      {none && <span className="none">{none}</span>}
      {warn && <span className="warn">{warn}</span>}
    </span>
  );
}

function RegistryRow({
  entry,
  open,
  flash,
  toggle,
  senders,
  attempt,
}: {
  entry: RegistryEntry;
  open: boolean;
  flash: boolean;
  toggle: () => void;
  senders: Sender[];
  attempt: (fn: () => void) => void;
}) {
  const {w, edit, select} = useContext(ChecklistContext)!;
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(entry.name);
  useEffect(() => setName(entry.name), [entry.name]);
  useEffect(() => {
    if (!flash) return;
    requestAnimationFrame(() => {
      const row = ref.current,
        list = row?.closest('.registry-rows');
      if (!row || !(list instanceof HTMLElement)) return;
      const top = row.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = Math.max(0, top - 8);
    });
  }, [flash]);
  const fns = entry.row?.functions ?? [];
  const slots = useMemo(() => (open ? eventSlots(w) : []), [open, w]);
  const registeredOps = useMemo(
    () => new Set((w.eventRegistry ?? []).flatMap(r => r.functions.map(f => f.values.op))),
    [w.eventRegistry]
  );
  const change = (next: Effect[]) => attempt(() => edit(w => setFunctions(w, entry.name, next)));
  const rename = () => {
    if (name !== entry.name) attempt(() => edit(w => renameEvent(w, entry.name, name.trim())));
  };
  return (
    <div
      ref={ref}
      className={'registry-row' + (open ? ' open' : '') + (flash ? ' flash' : '')}
      data-registry-row={eventKey(entry.name)}
    >
      <button className="registry-row-head" aria-expanded={open} onClick={toggle}>
        <span className="registry-name">{entry.name}</span>
        {whatOf(entry, senders)}
        <span className="registry-usage-count" title={tr('이 프로젝트에서 이 이벤트를 보내는 HKX 주석 수')}>
          {senders.length}
        </span>
      </button>
      {open && (
        <div className="registry-row-body">
          <label className="registry-field-line">
            <span>{tr('이름')}</span>
            <input
              aria-label={tr('이벤트 이름')}
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={e => {
                if (e.key === 'Enter') rename();
              }}
            />
          </label>
          <div className="registry-sub-title">
            {tr('기능')} <span>{tr('전역 — 어느 애니메이션에서 오든 실행 · 수치는 보내는 HKX 카드에서')}</span>
          </div>
          {fns.map((f, i) => (
            <FunctionEditor
              key={f.id}
              fn={f}
              registeredOps={registeredOps}
              change={next => change(fns.map((x, j) => (j === i ? next : x)))}
              remove={() => change(fns.filter((_, j) => j !== i))}
            />
          ))}
          {!fns.length && (
            <div className="registry-empty-line">
              {tr('기능 없음 — 그래프에 이름만 등록합니다(아래 용도나 다른 플러그인이 이 이벤트를 받음).')}
            </div>
          )}
          {!!fns.length && vanillaName(entry.name) && (
            <div className="registry-warn">
              {tr(
                '⚠ 바닐라·흔한 이벤트 이름입니다. 기능을 붙이면 게임 전체 애니메이션에서 실행됩니다. 모드 고유 접두어(예: Grapple_)를 권장합니다.'
              )}
            </div>
          )}
          <div className="registry-add">
            <button onClick={() => attempt(() => edit(w => addFunction(w, entry.name, 'hide')))}>
              {tr('＋ 기능 추가')}
            </button>
          </div>
          <div className="registry-sub-title">
            {tr('용도')} <span>{tr('이 프로젝트의 HKX 시점 — 여기서도, 해당 항목에서도 지정')}</span>
          </div>
          <ul className="registry-uses">
            {groupUses(entry.uses).map(g => {
              const slots = g.uses.flatMap(u => (u.slot ? [u.slot] : []));
              return (
                <li key={g.label}>
                  {g.text}
                  <button className="registry-link" onClick={() => select(g.uses[0].node)}>
                    {tr('보기')}
                  </button>
                  {!!slots.length && (
                    <button
                      className="registry-link dim"
                      title={
                        slots.length > 1
                          ? tr('이 {length}개 항목은 클립 시각 기준으로 돌아갑니다', {length: slots.length})
                          : tr('이 항목은 클립 시각 기준으로 돌아갑니다')
                      }
                      onClick={() => attempt(() => edit(w => slots.reduce((n, slot) => bindSlot(n, slot, ''), w)))}
                    >
                      {tr('✕ 해제')}
                    </button>
                  )}
                </li>
              );
            })}
            {!entry.uses.length && <li className="dim">{tr('없음')}</li>}
          </ul>
          <select
            className="registry-add-use"
            aria-label={tr('용도 추가')}
            value=""
            onChange={e => {
              const key = e.target.value;
              if (key) attempt(() => edit(w => bindSlot(w, key, entry.name)));
            }}
          >
            <option value="">{tr('＋ 용도 추가 — 이 이벤트를 쓸 항목 고르기…')}</option>
            {slots
              .filter(s => !(s.mark.basis === 'event' && eventKey(s.mark.event) === eventKey(entry.name)))
              .map(s => (
                <option key={s.key} value={s.key}>
                  {s.label} {tr('(지금:')} {timingLabel(s.mark)})
                </option>
              ))}
          </select>
          <div className="registry-usage">
            <div className="registry-usage-title">{tr('이 프로젝트에서 이 이벤트를 보내는 HKX')}</div>
            <ul>
              {senders.map((s, i) => (
                <li key={i}>
                  {s.label} · {s.time.toFixed(2)}
                  {tr('초')}
                </li>
              ))}
              {!senders.length && (
                <li className="dim">{tr('없음 — 다른 프로젝트·모드의 애니메이션에서만 올 수 있습니다')}</li>
              )}
            </ul>
          </div>
          {entry.row && (
            <div className="registry-add">
              <button
                disabled={!!entry.uses.length}
                title={entry.uses.length ? tr('용도에서 쓰는 중 — 참조를 먼저 바꾸세요') : undefined}
                onClick={() => attempt(() => edit(w => removeEventRow(w, entry.row!.id)))}
              >
                {tr('이벤트 삭제')}
                {entry.uses.length ? tr(' (용도에서 쓰는 중)') : ''}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One registered function: op, target and trigger on one line, the op's settings below. */
export function FunctionEditor({
  fn,
  change,
  remove,
  registeredOps,
}: {
  fn: Effect;
  change: (fn: Effect) => void;
  remove: () => void;
  registeredOps: Set<string>;
}) {
  const v = fn.values,
    info = opInfo[v.op as EventOp];
  const set = (key: string, value: string | undefined) => {
    const values = {...v};
    if (value === undefined || value === '') delete values[key];
    else values[key] = value;
    change({...fn, values});
  };
  const setting = (key: string) => {
    const label = settingLabels[key];
    // What a strike's hit brings along (runtime 0.12.294): each on unless `without` names it.
    if (key === 'without') {
      const off = new Set((v.without ?? '').split(',').filter(Boolean));
      return (
        <span key={key} className="strike-extras">
          {strikeExtras().map(([name, text]) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={!off.has(name)}
                onChange={e => {
                  if (e.target.checked) off.delete(name);
                  else off.add(name);
                  const list = strikeExtras()
                    .map(([k]) => k)
                    .filter(k => off.has(k))
                    .join(',');
                  set(key, list || undefined);
                }}
              />
              {text}
            </label>
          ))}
        </span>
      );
    }
    // A strike's whom and how (runtime 0.12.293); the hit choice is an area's only.
    if (strikeChoices[key]) {
      if (key === 'hit' && v.pick !== 'area') return null;
      const choices = strikeChoices[key]();
      return (
        <label key={key}>
          {label}
          <select
            value={v[key] ?? choices[0][0]}
            onChange={e => {
              const values = {...v};
              if (e.target.value === choices[0][0]) delete values[key];
              else values[key] = e.target.value;
              if (key === 'pick' && e.target.value !== 'area') delete values.hit;
              change({...fn, values});
            }}
          >
            {choices.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (isBooleanSetting(key))
      return (
        <label key={key}>
          <input
            type="checkbox"
            checked={(v[key] ?? settingDefault[key] ?? 'false') === 'true'}
            onChange={e => set(key, String(e.target.checked))}
          />
          {label}
        </label>
      );
    if (key === 'damage' && v.mode !== 'direct') return null;
    if (key === 'mode')
      return (
        <label key={key}>
          {label}
          <select
            value={v.mode === 'direct' ? 'direct' : ''}
            onChange={e => {
              const values = {...v};
              if (e.target.value) values.mode = e.target.value;
              else {
                delete values.mode;
                delete values.damage;
              }
              change({...fn, values});
            }}
          >
            {arrowModes().map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      );
    // A ragdoll's direction, and its force defaulting by direction (runtime 0.12.278).
    if (key === 'direction')
      return (
        <label key={key}>
          {label}
          <select
            value={v.direction ?? 'down'}
            onChange={e => set(key, e.target.value === 'down' ? undefined : e.target.value)}
          >
            {ragdollDirections.map(d => (
              <option key={d} value={d}>
                {ragdollLabels[d]}
              </option>
            ))}
          </select>
        </label>
      );
    if (key === 'force') {
      const def = ragdollForce[v.direction ?? 'down'] ?? 1;
      return (
        <label key={key}>
          {label}
          <NumberInput
            aria-label={label}
            min={0}
            max={20}
            step={0.5}
            value={v.force === undefined ? def : Number(v.force)}
            change={value => set(key, value === def ? undefined : String(value))}
          />
        </label>
      );
    }
    // A sound's source (mockup ②): 출처 파일 | 등록 사운드.
    if (v.op === 'sound' && (key === 'plugin' || key === 'form')) return null;
    if (key === 'file')
      return (
        <SoundSourceFields
          key={key}
          values={v}
          setMany={patch => {
            const values = {...v};
            for (const [k, value] of Object.entries(patch))
              if (value === undefined || value === '') delete values[k];
              else values[k] = value;
            change({...fn, values});
          }}
          row={(text, control, k) => (
            <label key={k} className="sound-source-row">
              {text}
              {control}
            </label>
          )}
        />
      );
    if (key === 'plugin' || key === 'form' || textSettings.includes(key))
      return (
        <label key={key}>
          {label}
          <input
            type="text"
            className={key === 'plugin' || key === 'text' ? 'wide' : ''}
            value={v[key] ?? ''}
            onChange={e => set(key, e.target.value)}
          />
        </label>
      );
    // A sound's bone and a global's restore (runtime 0.12.296).
    if (key === 'bone')
      return (
        <label key={key}>
          {label}
          <select
            value={v.bone ?? 'spine'}
            onChange={e => set(key, e.target.value === 'spine' ? undefined : e.target.value)}
          >
            {soundBones().map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      );
    if (key === 'restore')
      return (
        <label key={key}>
          <input
            type="checkbox"
            checked={v.restore === 'end'}
            onChange={e => set(key, e.target.checked ? 'end' : undefined)}
          />
          {label}
        </label>
      );
    const [min, max] = settingRange(key) ?? [0, 600];
    return (
      <label key={key}>
        {label}
        <NumberInput
          aria-label={label}
          min={min}
          max={max}
          step={key === 'damage' ? 5 : 0.05}
          value={Number(v[key] ?? settingDefault[key] ?? 0)}
          change={value => set(key, String(value))}
        />
      </label>
    );
  };
  return (
    <div className="registry-fn">
      <div className="registry-fn-caption">
        {/* It changes the actor that sent the event (runtime 0.12.273): no target or sender filter to choose. */}
        <span>{tr('기능 · 이벤트를 보낸 액터에게')}</span>
        <span />
      </div>
      <div className="registry-fn-top">
        <select aria-label={tr('기능')} value={v.op} onChange={e => change({...fn, values: {op: e.target.value}})}>
          {eventOps.map(op => (
            <option key={op} value={op}>
              {opInfo[op].label}
            </option>
          ))}
        </select>
        <button className="registry-del" title={tr('기능 삭제')} aria-label={tr('기능 삭제')} onClick={remove}>
          ✕
        </button>
      </div>
      {/* What it acts with only: the numbers are each HKX node's (runtime 0.12.281, docs/mockup-event-node-values). */}
      {!!registryFields(v.op).length && <div className="registry-fn-fields">{registryFields(v.op).map(setting)}</div>}
      {info?.lasting && (
        <div
          className="registry-note"
          title={tr('짝 기능 "{pair}", 이 동작의 종료, 사망·래그돌·불러오기 때 해제됩니다.', {
            pair: opInfo[info.lasting].label,
          })}
        >
          {tr('해제: {pair} · 동작 끝', {pair: opInfo[info.lasting].label})}
          {registeredOps.has(info.lasting) ? '' : tr('(등록 없음 ⚠)')}
        </div>
      )}
      {info?.player && (
        <div className="registry-note player">
          <span className="moment-tag" title={tr('플레이어에게만 적용됩니다.')}>
            {tr('플레이어만')}
          </span>
        </div>
      )}
    </div>
  );
}

function FunctionView({
  entries,
  senders,
  jump,
}: {
  entries: RegistryEntry[];
  senders: Map<string, Sender[]>;
  jump: (key: string) => void;
}) {
  const groups = new Map<string, RegistryEntry[]>();
  const put = (label: string, e: RegistryEntry) => {
    const list = groups.get(label) ?? [];
    if (!list.includes(e)) list.push(e);
    groups.set(label, list);
  };
  for (const e of entries) {
    for (const f of e.row?.functions ?? [])
      put(tr('기능 · ') + (opInfo[f.values.op as EventOp]?.label ?? f.values.op), e);
    for (const u of e.uses) put(tr('용도 · ') + u.label.split(' · ')[0], e);
    if (!e.row?.functions.length && !e.uses.length) put(tr('참조 없음'), e);
  }
  return (
    <>
      {[...groups].map(([label, list]) => (
        <div key={label}>
          <div className="registry-group-title">
            {label} <span>{list.length}</span>
          </div>
          {list.map(e => (
            <button key={e.name} className="registry-row-head" onClick={() => jump(eventKey(e.name))}>
              <span className="registry-name">{e.name}</span>
              {whatOf(e, senders.get(eventKey(e.name)) ?? [])}
              <span className="registry-usage-count">{senders.get(eventKey(e.name))?.length ?? 0}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
