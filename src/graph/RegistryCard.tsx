import {useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {Effect, Workspace} from '../workspace.ts';
import {
  addEventRow,
  addFunction,
  unchosen,
  ragdollDirections,
  ragdollForce,
  ragdollLabels,
  strikeChoices,
  strikeExtras,
  soundBones,
  textSettings,
  eventKey,
  eventOps,
  functionSummary,
  isBooleanSetting,
  newEventName,
  registryFields,
  opInfo,
  removeEventRow,
  renameEvent,
  setFunctions,
  shortUses,
  shortUseKinds,
  useKind,
  groupUses,
  settingDefault,
  settingLabels,
  settingRange,
  isSpan,
  spanRange,
  vanillaName,
  isMagic,
  magicActions,
  magicOps,
  type EventOp,
  type RegistryEntry,
  playerOnlyHint,
} from '../eventRegistry.ts';
import {ChecklistContext} from './ChecklistCard.tsx';
import {NumberInput} from '../ui/details/NumberInput.tsx';
import {DetailPanel, DetailRow, NestedDetailPanel} from '../ui/details/DetailRow.tsx';
import {clipKey, roleLabel, sentEvent, useClipAnnotations} from './annotations.ts';
import './registry.css';
import {renderedRegistry} from './renderCache.ts';
import {tr} from '../i18n/korean.ts';
import {SoundSourceFields} from '../ui/details/SoundFile.tsx';
import {errorText} from '../errorText.ts';
import {Unchosen} from '../ui/details/Unchosen.tsx';

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
      setError(errorText(e));
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
    <>
      {/* The card's one summary line, where an HKX card says how it starts (11-12 audit: the HKX card's form). */}
      <div className="card-start nodrag via">
        <span>
          {tr('전역')} · {tr('연결 없음')} · {tr('기능')} <b className="fn">{withFunctions}</b> · {tr('시점')}{' '}
          <b>{usesOnly}</b>
        </span>
      </div>
      <div
        className="checklist-body registry-body nodrag nopan"
        onDoubleClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
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
        <section className="checklist-section">
          <div className="checklist-section-title">
            {/* What the registry is, on its title (it was a paragraph on every card). */}
            <span
              className="help-tip-target"
              title={[
                tr('이 프로젝트에서 쓰는 이벤트를 전부 여기 등록합니다.'),
                tr('기능') + tr('은 전역이라 어느 애니메이션에서 오든 실행되고(다른 모드·바닐라·OAR 포함),'),
                tr('용도') + tr('는 감지 창·QTE·회복·트리거처럼 이 프로젝트 HKX의 시점에 쓰입니다.'),
              ].join(' ')}
            >
              <span className="help-tip-label">{tr('이벤트')}</span>
            </span>{' '}
            <span className="section-count">{entries.length}</span>
          </div>
          <div className="registry-rows">
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
          <div className="checklist-add-actions">
            <div className="checklist-add-menu">
              <button
                onClick={() =>
                  attempt(() => {
                    const name = newEventName(w);
                    edit(w => addEventRow(w, name));
                    // Only the new row is open: rows left open before showed several name fields at once (10-28 rebuild).
                    setOpen(new Set([eventKey(name)]));
                    setFlash(eventKey(name));
                  })
                }
              >
                {tr('+ 이벤트')}
              </button>
            </div>
          </div>
        </section>
        {error && (
          <p role="alert" className="checklist-error">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

/** What an event does, on its one line (docs/mockup-registry-oneline A): its functions, then its uses (shortUses),
 *  cut with an ellipsis; the whole text on hover and in the open row. */
function whatOf(e: RegistryEntry, senders: Sender[]) {
  const fns = (e.row?.functions ?? []).map(
    f => functionSummary(f.values) + (opInfo[f.values.op as EventOp]?.lasting ? tr(' · 켜 둠') : '')
  );
  const uses = shortUses(e.name, e.uses),
    kinds = shortUseKinds(e.uses);
  const none = !fns.length && !uses.length ? (senders.length ? tr('그래프 등록만') : tr('참조 없음')) : '';
  const warn = fns.length && vanillaName(e.name) ? tr('⚠ 게임 전체 적용') : '';
  return (
    <small className="time registry-what" title={[...fns, ...uses, none, warn].filter(Boolean).join(' · ')}>
      {fns.map((t, i) => (
        <span key={'f' + i} className="fn">
          {t}
        </span>
      ))}
      {uses.map((t, i) => (
        <span key={'u' + i} className={'use on-' + kinds[i]}>
          {t}
        </span>
      ))}
      {none && <span className="none">{none}</span>}
      {warn && <span className="warn">{warn}</span>}
    </small>
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
  const {w, edit, show} = useContext(ChecklistContext)!;
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
  // Nothing does anything with it: its name steps back.
  const unused = !fns.length && !entry.uses.length;
  const change = (next: Effect[]) => attempt(() => edit(w => setFunctions(w, entry.name, next)));
  const rename = () => {
    if (name !== entry.name) attempt(() => edit(w => renameEvent(w, entry.name, name.trim())));
  };
  return (
    <div
      ref={ref}
      className={
        'checklist-row registry-row' + (open ? ' open' : '') + (flash ? ' flash' : '') + (unused ? ' unused' : '')
      }
      data-registry-row={eventKey(entry.name)}
    >
      <div className="checklist-row-heading">
        <button className="checklist-row-toggle" aria-expanded={open} onClick={toggle}>
          <span>{entry.name}</span>
          {whatOf(entry, senders)}
        </button>
        {open && entry.row && (
          <span className="checklist-row-icons">
            <button
              type="button"
              className="danger"
              aria-label={tr('이벤트 삭제')}
              disabled={!!entry.uses.length}
              title={entry.uses.length ? tr('용도에서 쓰는 중 — 참조를 먼저 바꾸세요') : tr('이벤트 삭제')}
              onClick={() => attempt(() => edit(w => removeEventRow(w, entry.row!.id)))}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
              </svg>
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="checklist-fields registry-fields">
          <NestedDetailPanel.Provider value={true}>
            <DetailPanel>
              <DetailRow label={tr('이름')}>
                <input
                  aria-label={tr('이벤트 이름')}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={rename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') rename();
                  }}
                />
              </DetailRow>
              {fns.map((f, i) => (
                <FunctionEditor
                  key={f.id}
                  fn={f}
                  change={next => change(fns.map((x, j) => (j === i ? next : x)))}
                  remove={() => change(fns.filter((_, j) => j !== i))}
                />
              ))}
            </DetailPanel>
          </NestedDetailPanel.Provider>
          {!fns.length && (
            <div className="registry-empty-line">
              {tr('기능 없음 — 그래프에 이름만 등록합니다(아래 용도나 다른 플러그인이 이 이벤트를 받음).')}
            </div>
          )}
          {!!fns.length && vanillaName(entry.name) && (
            <div className="registry-warn">
              {tr(
                '⚠ 바닐라·흔한 이벤트 이름입니다. 기능을 붙이면 게임 전체 애니메이션에서 실행됩니다. 모드 고유 접두어를 권장합니다.'
              )}
            </div>
          )}
          <div className="checklist-add-actions">
            <div className="checklist-add-menu">
              <button onClick={() => attempt(() => edit(w => addFunction(w, entry.name)))}>{tr('+ 기능')}</button>
            </div>
          </div>
          {/* Uses are set where they are (QTE, Start, HKX and link cards); here they are only listed. */}
          <div className="detail-row registry-list-row">
            <div className="detail-label-help">
              <span className="detail-name">{tr('용도')}</span>
            </div>
            <ul className="detail-value registry-uses copyable nodrag nopan">
              {groupUses(entry.uses).map(g => (
                <li key={g.label} className={'on-' + useKind(g.uses[0].node)}>
                  {g.text}
                  {/* Kept from the registry card's own click, which would choose the registry again. */}
                  <button
                    className="registry-link"
                    onClick={e => {
                      e.stopPropagation();
                      show(g.uses[0].node);
                    }}
                  >
                    {tr('보기')}
                  </button>
                </li>
              ))}
              {!entry.uses.length && <li className="dim">{tr('없음')}</li>}
            </ul>
          </div>
          <div className="detail-row registry-list-row">
            <div className="detail-label-help">
              <span className="detail-name" title={tr('이 프로젝트에서 이 이벤트를 보내는 HKX')}>
                {tr('보내는 HKX')}
              </span>
            </div>
            <ul className="detail-value registry-usage copyable nodrag nopan">
              {senders.map((s, i) => (
                <li key={i}>
                  <span>{s.label}</span>
                  <span className="at">
                    {s.time.toFixed(2)}
                    {tr('초')}
                  </span>
                </li>
              ))}
              {!senders.length && (
                <li className="dim" title={tr('없음 — 다른 프로젝트·모드의 애니메이션에서만 올 수 있습니다')}>
                  {tr('없음')}
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** One registered function: its row (the choice and ×), then its own settings a row each under it. */
export function FunctionEditor({fn, change, remove}: {fn: Effect; change: (fn: Effect) => void; remove: () => void}) {
  const v = fn.values;
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
      return strikeExtras().map(([name, text]) => (
        <DetailRow key={key + ':' + name} label={text}>
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
        </DetailRow>
      ));
    }
    // A strike's whom and how (runtime 0.12.293); the hit choice is an area's only.
    if (strikeChoices[key]) {
      if (key === 'hit' && v.pick !== 'area') return null;
      const choices = strikeChoices[key]();
      return (
        <DetailRow key={key} label={label}>
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
            {v[key] === '' && <Unchosen />}
            {choices.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </DetailRow>
      );
    }
    if (isBooleanSetting(key))
      return (
        <DetailRow key={key} label={label}>
          <input
            type="checkbox"
            checked={(v[key] ?? settingDefault[key] ?? 'false') === 'true'}
            onChange={e => set(key, String(e.target.checked))}
          />
        </DetailRow>
      );
    // A ragdoll's direction, and its force defaulting by direction (runtime 0.12.278).
    if (key === 'direction')
      return (
        <DetailRow key={key} label={label}>
          <select
            value={v.direction ?? 'down'}
            onChange={e => set(key, e.target.value === 'down' ? undefined : e.target.value)}
          >
            {v.direction === '' && <Unchosen />}
            {ragdollDirections.map(d => (
              <option key={d} value={d}>
                {ragdollLabels[d]}
              </option>
            ))}
          </select>
        </DetailRow>
      );
    if (key === 'force') {
      const def = ragdollForce[v.direction ?? 'down'] ?? 1;
      return (
        <DetailRow key={key} label={label}>
          <NumberInput
            aria-label={label}
            min={0}
            max={20}
            step={0.5}
            value={v.force === undefined ? def : Number(v.force)}
            change={value => set(key, value === def ? undefined : String(value))}
          />
        </DetailRow>
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
            <DetailRow key={k} label={text}>
              {control}
            </DetailRow>
          )}
        />
      );
    if (key === 'plugin' || key === 'form' || textSettings.includes(key))
      return (
        <DetailRow key={key} label={label}>
          <input
            type="text"
            className={key === 'plugin' || key === 'text' ? 'wide' : ''}
            value={v[key] ?? ''}
            onChange={e => set(key, e.target.value)}
          />
        </DetailRow>
      );
    // A sound's bone and a global's restore (runtime 0.12.296).
    if (key === 'bone')
      return (
        <DetailRow key={key} label={label}>
          <select
            value={v.bone ?? 'spine'}
            onChange={e => set(key, e.target.value === 'spine' ? undefined : e.target.value)}
          >
            {v.bone === '' && <Unchosen />}
            {soundBones().map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </DetailRow>
      );
    // A cost's unit (runtime 10-31): the values as written, or percent of each maximum.
    if (key === 'measure')
      return (
        <DetailRow key={key} label={label}>
          <select
            value={v.measure === '' ? '' : v.measure === 'percent' ? 'percent' : 'value'}
            onChange={e => set(key, e.target.value === 'percent' ? 'percent' : undefined)}
          >
            {v.measure === '' && <Unchosen />}
            <option value="value">{tr('수치')}</option>
            <option value="percent">{tr('최대치의 %')}</option>
          </select>
        </DetailRow>
      );
    if (key === 'restore')
      return (
        <DetailRow key={key} label={label}>
          <input
            type="checkbox"
            checked={v.restore === 'end'}
            onChange={e => set(key, e.target.checked ? 'end' : undefined)}
          />
        </DetailRow>
      );
    // A window's span (runtime 11-02): 0 is none.
    if (isSpan(v.op, key))
      return (
        <DetailRow key={key} label={tr('지속 시간(초)')}>
          <NumberInput
            aria-label={tr('지속 시간(초)')}
            min={spanRange[0]}
            max={spanRange[1]}
            step={0.05}
            value={Number(v[key] ?? 0)}
            change={value => set(key, value ? String(value) : undefined)}
          />
        </DetailRow>
      );
    const [min, max] = settingRange(key) ?? [0, 600];
    return (
      <DetailRow key={key} label={label}>
        <NumberInput
          aria-label={label}
          min={min}
          max={max}
          step={key === 'damage' ? 5 : 0.05}
          value={Number(v[key] ?? settingDefault[key] ?? 0)}
          change={value => set(key, String(value))}
        />
      </DetailRow>
    );
  };
  // Its own settings, a row each under it (11-12 re-check: on one wrapping line they scattered, and with many the
  // row's name was squeezed away).
  const rows = [
    isMagic(v.op) && (
      <DetailRow key="action" label={tr('동작')}>
        <span className="moment-seg" role="group" aria-label={tr('동작')}>
          {magicActions().map(([op, label]) => (
            <button
              key={op}
              type="button"
              aria-pressed={v.op === op}
              onClick={() => v.op !== op && change({...fn, values: {...v, op}})}
            >
              {label}
            </button>
          ))}
        </span>
      </DetailRow>
    ),
    // What it acts with only: the numbers are each HKX node's (runtime 0.12.281, docs/mockup-event-node-values).
    ...registryFields(v.op).flatMap(setting),
  ].filter(Boolean);
  return (
    <>
      {/* It changes the actor that sent the event (runtime 0.12.273): no target or sender filter to choose. */}
      <DetailRow
        label={tr('기능')}
        hint={
          tr('전역 — 어느 애니메이션에서 오든 실행 · 수치는 보내는 HKX 카드에서') +
          ' · ' +
          tr('기능 · 이벤트를 보낸 액터에게')
        }
      >
        <div className="registry-fn-top">
          {/* A player-only function says so in its help (a tag looked like a setting, 10-27). */}
          <select
            aria-label={tr('기능')}
            title={playerOnlyHint(v.op) || undefined}
            value={v.op}
            onChange={e => change({...fn, values: {op: e.target.value, ...unchosen(e.target.value)}})}
          >
            <Unchosen />
            {eventOps
              // The magic function is one choice; its action is below (11-01).
              .filter(op => !isMagic(op) || op === (isMagic(v.op) ? v.op : magicOps[0]))
              .map(op => (
                <option key={op} value={op}>
                  {isMagic(op) ? tr('마법 효과') : opInfo[op].label}
                </option>
              ))}
          </select>
          <button className="registry-del" title={tr('기능 삭제')} aria-label={tr('기능 삭제')} onClick={remove}>
            ×
          </button>
        </div>
      </DetailRow>
      {!!rows.length && <div className="registry-fn-sub">{rows}</div>}
    </>
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
            <div
              key={e.name}
              className={'checklist-row registry-row' + (!e.row?.functions.length && !e.uses.length ? ' unused' : '')}
            >
              <div className="checklist-row-heading">
                <button className="checklist-row-toggle" onClick={() => jump(eventKey(e.name))}>
                  <span>{e.name}</span>
                  {whatOf(e, senders.get(eventKey(e.name)) ?? [])}
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
