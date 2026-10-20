import {createContext, useContext, useState, useEffect, useRef, useMemo} from 'react';
import {createPortal} from 'react-dom';
import {useUpdateNodeInternals} from '@xyflow/react';
import type {Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {assetLibrary} from '../assets.ts';
import type {FlatNode} from './flat.ts';
import {deleteFlat} from './flat.ts';
import {addConnected, contextualAdds} from './contextAdd.ts';
import {ConditionExpressionEditor} from './ConditionExpressionEditor.tsx';
import {ConditionTableDetails} from './ConditionTableDetails.tsx';
import {GraphDetails} from './GraphDetails.tsx';
import {BlendDetails} from './BlendDetails.tsx';
import {NotifyDetails} from '../timeline/Details.tsx';
import {StateDetails} from '../ui/details/StateDetails.tsx';
import {StepFiles, ViewFields, type ViewRow} from '../ui/details/ViewFields.tsx';
import {NestedDetailPanel, InspectorLayout} from '../ui/details/DetailRow.tsx';
import {detachInspectorNode, sharedNodeMembers} from '../ui/details/inspectorModel.ts';
import {switchPlaybackKind, playbackKind, playbackKinds, actionKindLabels} from '../actionTypes.ts';
import {duplicate, rows} from '../timeline/model.ts';
import {nodeSettings} from './nodeSettings.ts';
import {shareNodeSettings} from './sharing.ts';
import {setChecklistEnabled, type ChecklistItem, checklistModel} from './checklist.ts';
import {DraftDetails} from './DraftDetails.tsx';
import {attachDraft} from './drafts.ts';
import './checklist.css';
import './registry.css';
import {useClipAnnotations, clipKey, sentEvent, roleLabel} from './annotations.ts';
import {functionSummary, eventKey, addEventRow, addEventValue, ownUseLabels, vanillaName} from '../eventRegistry.ts';
import {showRegistry} from './RegistryCard.tsx';
import {HelpTip} from '../ui/HelpTip.tsx';
import {stepSource} from '../view.ts';
import {renderedRegistry} from './renderCache.ts';
import {tr} from '../i18n/korean.ts';

type Context = {
  w: Workspace;
  model: ReturnType<typeof checklistModel>;
  library: ReturnType<typeof assetLibrary>;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  select: (s: string) => void;
  selected: string;
  globalSettings: () => void;
};
export const ChecklistContext = createContext<Context | null>(null);
function useFold(key: string, initial = false) {
  const [open, set] = useState(() => {
    try {
      return localStorage.getItem(key) === null ? initial : localStorage.getItem(key) === '1';
    } catch {
      return initial;
    }
  });
  return [
    open,
    (v: boolean) => {
      set(v);
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {}
    },
  ] as const;
}
/** fold: the summary view decides whether a condition's editor is open (open while its card is chosen); without it
 *  the card keeps the open state it was left in. */
export function ChecklistBody({node, fold}: {node: FlatNode; fold?: 'open' | 'closed'}) {
  const ctx = useContext(ChecklistContext)!;
  const {w, edit, status, model, library} = ctx;
  const action = w.actions.find(a => a.uid === node.action);
  const clip = action?.config.steps.find(s => s.id === node.step);
  const [kept, setKept] = useFold(`checklist:${w.id}:${node.id}`, node.kind !== 'hkxPlay');
  // In the summary view the toggle only closes the chosen card for now; choosing another card resets it.
  const [handClosed, setHandClosed] = useState(false);
  useEffect(() => {
    if (fold !== 'open') setHandClosed(false);
  }, [fold]);
  const expanded = fold ? fold === 'open' && !handClosed : kept,
    setExpanded = (v: boolean) => (fold ? setHandClosed(!v) : setKept(v));
  const [allOpen, setAllOpen] = useState<boolean>(),
    [error, setError] = useState('');
  const [info, setInfo] = useFold(`checklist:info:${w.id}:${node.id}`);
  const update = useUpdateNodeInternals(),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let pending = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => update(node.id));
    });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
    };
  }, [node.id, update]);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  // A row's note is the help of its name (10-20, docs/mockup-ux-polish ④): it no longer takes a line of the card.
  const cardRow: ViewRow = (id, label, control, hint) => (
    <div key={id} className="checklist-file">
      {hint ? (
        <HelpTip label={label} help={hint}>
          <span className="help-tip-label">{label}</span>
        </HelpTip>
      ) : (
        <span>{label}</span>
      )}
      {control}
    </div>
  );
  const storedItems = model.items.get(node.id) ?? [];
  const items = storedItems.filter(i => !(i.node.kind === 'blend' && !i.enabled));
  const settings = (group: 'playback' | 'info' = 'playback') =>
    action && (
      <InspectorLayout.Provider value={group}>
        <StateDetails
          integrated
          w={w}
          action={action}
          stepId={node.step}
          library={library}
          change={a => edit(w => putAction(w, a))}
          edit={edit}
          switchKind={k => edit(w => switchPlaybackKind(w, action.uid, k))}
          status={status}
          onGlobalSettings={ctx.globalSettings}
        />
      </InspectorLayout.Provider>
    );
  const settingsTarget =
    node.kind === 'hkxPlay'
      ? node.id
      : (model.raw.nodes.find(n => n.action === node.action && n.kind === 'hkxPlay')?.id ?? node.id);
  const options = action ? contextualAdds(w, settingsTarget, model.raw) : [];
  const internal = options.filter(o => {
    if (['keyInput', 'markerReceive', 'playNode', 'conditionBranch', 'qte'].includes(o.kind)) return false;
    if (!action?.pair && o.kind.startsWith('notify:')) {
      const kind = o.kind.slice(7);
      if (items.some(i => i.node.notify === kind || i.node.notify === `${kind}:${node.step}`)) return false;
    }
    if (
      o.kind === 'blend' &&
      items.some(i => i.node.kind === 'blend' && i.node.summary.includes(o.before ? tr('시작') : tr('종료')))
    )
      return false;
    return true;
  });
  useEffect(() => {
    if (ctx.selected !== node.id && model.owners.get(ctx.selected)?.includes(node.id)) setExpanded(true);
  }, [ctx.selected]);
  const eventOption = (kind: string) =>
    kind === 'cameraRestore' ||
    kind === 'fireArrow' ||
    kind === 'carryRelease' ||
    kind === 'carryFix' ||
    (kind.startsWith('notify:') &&
      !['rotate', 'iframe', 'armor', 'cost', 'recovery', 'vanillaCancel'].includes(kind.slice(7)));
  // One "+ 기능" (10-16, docs/mockup-feature-merge): what applies to the whole play, then what happens at a moment.
  const addMenu = () => (
    <AddItemMenu
      groups={[
        {title: tr('재생 전체'), options: internal.filter(o => !eventOption(o.kind))},
        {title: tr('특정 순간 ⏱'), options: internal.filter(o => eventOption(o.kind))},
      ]}
      label={tr('기능')}
      add={option =>
        attempt(() =>
          edit(w => {
            const disabled =
              option.kind === 'blend' &&
              storedItems.find(
                i =>
                  !i.enabled &&
                  i.node.kind === 'blend' &&
                  i.node.summary.includes(option.before ? tr('시작') : tr('종료'))
              );
            return disabled
              ? setChecklistEnabled(w, disabled, true)
              : addConnected(w, settingsTarget, option, node.position).workspace;
          })
        )
      }
    />
  );
  return (
    <div
      ref={ref}
      className="checklist-body nodrag nopan"
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Escape' || e.nativeEvent.isComposing)
          e.stopPropagation();
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {node.kind === 'conditionBranch' ? (
        <>
          <button className="checklist-summary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '▾' : '▸'} {node.summary || tr('조건 편집')}
          </button>
          {expanded && <ConditionExpressionEditor embedded focus={ctx.selected} w={w} id={node.id} edit={edit} />}
        </>
      ) : node.kind === 'conditionTable' ? (
        <>
          <button className="checklist-summary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '▾' : '▸'} {node.summary}
          </button>
          {expanded && (
            <ConditionTableDetails
              embedded
              focus={ctx.selected}
              w={w}
              owner={node.action ?? node.id.slice('conditionTable:'.length)}
              edit={edit}
              status={status}
            />
          )}
        </>
      ) : (
        action && (
          <>
            {clip && (
              <StepFiles
                w={w}
                action={action}
                step={clip}
                library={library}
                status={status}
                edit={edit}
                scopeKey={`${w.id}:${node.id}`}
                row={cardRow}
                change={(value, localPath) =>
                  edit(w => ({
                    ...w,
                    actions: w.actions.map(a =>
                      a.uid === action.uid
                        ? {
                            ...a,
                            config: {
                              ...a.config,
                              steps: a.config.steps.map(s => (s.id === node.step ? {...s, clip: value, localPath} : s)),
                            },
                          }
                        : a
                    ),
                  }))
                }
              />
            )}
            <label className="checklist-file">
              {tr('유형')}
              <select
                aria-label={tr('동작 유형')}
                value={playbackKind(action)}
                onChange={e =>
                  attempt(() =>
                    edit(w => switchPlaybackKind(w, action.uid, e.target.value as (typeof playbackKinds)[number]))
                  )
                }
              >
                {playbackKinds.map(k => (
                  <option key={k} value={k}>
                    {actionKindLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            <ViewFields w={w} action={action} edit={edit} row={cardRow} />
            <button className="checklist-summary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? '▾' : '▸'} {tr('재생 설정')}
            </button>
            {expanded && (
              <NestedDetailPanel.Provider value={true}>
                <div className="checklist-fields">{settings()}</div>
              </NestedDetailPanel.Provider>
            )}
            {/* The features and the HKX's events fold each on their own (one "기능 · 이벤트" fold above them was the
                same fold twice, 10-20). */}
            {
              <ChecklistSection
                owner={node.id}
                items={items.filter(i => i.category === 'feature')}
                moments={byMoment(items.filter(i => i.category === 'event'))}
                allOpen={allOpen}
                toggleAll={() => setAllOpen(v => !v)}
              />
            }
            {clip && (
              <HkxEvents
                clip={stepSource(w, action, clip).clip}
                owner={node.id}
                action={action.uid}
                step={node.step}
                pair={!!action.pair}
              />
            )}
            <div className="checklist-add-actions">{addMenu()}</div>
            <button className="checklist-summary" aria-expanded={info} onClick={() => setInfo(!info)}>
              {info ? '▾' : '▸'} {tr('식별 정보')}
            </button>
            {info && (
              <NestedDetailPanel.Provider value={true}>
                <div className="checklist-fields">{settings('info')}</div>
              </NestedDetailPanel.Provider>
            )}
          </>
        )
      )}
      {node.kind !== 'hkxPlay' && items.length > 0 && (
        <section className="checklist-section">
          <div className="checklist-section-title">{tr('진입 공통 설정')}</div>
          {/* A selecting action's conditions only (graph/checklist.ts): nothing played here takes features. */}
          {items.map(item => (
            <ChecklistRow key={item.node.id} item={item} owner={node.id} />
          ))}
        </section>
      )}
      {error && (
        <p role="alert" className="checklist-error">
          {error}
        </p>
      )}
    </div>
  );
}
/** A moment item's time in seconds when its summary is one ("3.067초"); an event-named one sorts after. */
const momentSeconds = (i: ChecklistItem) => {
  const m = /^(\d+(?:\.\d+)?)\s*초/.exec(i.node.summary ?? '');
  return m ? Number(m[1]) : Infinity;
};
const byMoment = (items: ChecklistItem[]) =>
  items
    .map((item, index) => ({item, index}))
    .sort((a, b) => momentSeconds(a.item) - momentSeconds(b.item) || a.index - b.index)
    .map(x => x.item);
// One list (10-16, docs/mockup-feature-merge): what applies to the whole play first, then what happens at a moment
// (⏱, by time). They differed only in when they apply and how they are edited; both stay as they were per row.
function ChecklistSection({
  owner,
  items,
  moments,
  allOpen,
  toggleAll,
}: {
  owner: string;
  items: ChecklistItem[];
  moments: ChecklistItem[];
  allOpen?: boolean;
  toggleAll: () => void;
}) {
  const {w, selected} = useContext(ChecklistContext)!;
  const [open, setOpen] = useFold(`checklist:section:${w.id}:${owner}:feature`, true);
  useEffect(() => {
    if ([...items, ...moments].some(i => i.node.id === selected)) setOpen(true);
  }, [selected]);
  return (
    <section className="checklist-section">
      <div className="checklist-section-title">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {tr('기능 ·')} {items.length + moments.length}
        </button>
        {open && <button onClick={toggleAll}>{allOpen ? tr('전체 접기') : tr('전체 펼치기')}</button>}
      </div>
      {open && items.map(item => <ChecklistRow key={item.node.id} item={item} owner={owner} allOpen={allOpen} />)}
      {open && moments.length > 0 && <div className="checklist-moments">{tr('특정 순간')}</div>}
      {open && moments.map(item => <ChecklistRow key={item.node.id} item={item} owner={owner} moment />)}
    </section>
  );
}
function ChecklistRow({
  item,
  owner,
  allOpen,
  moment = false,
}: {
  item: ChecklistItem;
  owner: string;
  allOpen?: boolean;
  /** Happens at one moment of the HKX: marked ⏱, its time (or event) as a badge. */
  moment?: boolean;
}) {
  const ctx = useContext(ChecklistContext)!;
  const {w, edit, status, select, model} = ctx;
  const n = item.node,
    a = w.actions.find(a => a.uid === n.action)!;
  const [open, setOpen] = useFold(`checklist:${w.id}:${owner}:${n.id}`);
  const [error, setError] = useState('');
  const [eventEditor, setEventEditor] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (allOpen !== undefined) setOpen(allOpen);
  }, [allOpen]);
  useEffect(() => {
    if (ctx.selected === n.id) {
      setOpen(true);
      requestAnimationFrame(() => rowRef.current?.scrollIntoView({block: 'nearest', inline: 'nearest'}));
    }
  }, [ctx.selected]);
  const members = sharedNodeMembers(w, n.id),
    settings = nodeSettings(w, n.id);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const candidates = useMemo(
    () =>
      open
        ? model.raw.nodes.filter(v => {
            if (v.id === n.id || !settings) return false;
            try {
              return nodeSettings(w, v.id)?.kind === settings.kind;
            } catch {
              return false;
            }
          })
        : [],
    [open, model, n.id, settings?.kind]
  );
  return (
    <div
      ref={rowRef}
      className={
        'checklist-row' +
        (moment ? ' moment' : '') +
        (!item.enabled ? ' is-disabled' : '') +
        (ctx.selected === n.id ? ' active-item' : '')
      }
      data-item={n.id}
    >
      <div className="checklist-row-heading">
        {item.toggleable && (
          <input
            type="checkbox"
            title={tr('사용 여부를 변경합니다. 접기는 설정에 영향을 주지 않습니다.')}
            aria-label={tr('{title} 사용', {title: n.title})}
            checked={item.enabled}
            onChange={e => attempt(() => edit(w => setChecklistEnabled(w, item, e.target.checked)))}
          />
        )}
        <button
          title={item.scope}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            select(owner);
          }}
        >
          <span>{n.title}</span>
          <small title={n.summary}>
            {/* A summary that only repeats the title ("상태 조건 · 상태 조건") is left out. */}
            {item.enabled
              ? n.summary === n.title
                ? ''
                : n.summary
              : n.kind === 'blend'
                ? tr('엔진 기본값 사용')
                : tr('사용 안 함 · 설정 유지')}
          </small>
          <span>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open && item.scope !== tr('이 클립') && <span className="checklist-shared">{item.scope}</span>}
      {members.length > 1 && (
        <span className="checklist-shared" title={members.join('\n')}>
          {tr('공유 ·')} {members.length}
          {tr('개 항목')}
        </span>
      )}
      {open && (
        <div className="checklist-fields">
          <NestedDetailPanel.Provider value={true}>
            {item.category === 'event' ? (
              <button onClick={() => setEventEditor(true)}>{tr('이벤트 편집…')}</button>
            ) : n.notify ? (
              <NotifyDetails w={w} action={a} id={n.notify} edit={edit} />
            ) : n.kind === 'blend' ? (
              <BlendDetails w={w} id={n.id} edit={edit} status={status} />
            ) : (
              <GraphDetails
                w={w}
                graph={n.scope}
                node={n.original}
                edit={edit}
                status={status}
                open={() => select(owner)}
                selectedAsset=""
                onGlobalSettings={ctx.globalSettings}
              />
            )}
          </NestedDetailPanel.Provider>
          <div className="checklist-row-actions">
            {members.length > 1 && (
              <button onClick={() => edit(w => detachInspectorNode(w, n.id))}>{tr('이 동작만 분리')}</button>
            )}
            {settings && (
              <select
                aria-label={tr('공유 설정 사용')}
                value=""
                onChange={e => {
                  const id = e.target.value;
                  if (id) attempt(() => edit(w => shareNodeSettings(w, id, n.id)));
                }}
              >
                <option value="">{tr('공유 설정 사용…')}</option>
                {candidates.map(v => (
                  <option key={v.id} value={v.id}>
                    {w.actions.find(a => a.uid === v.action)?.config.name} · {v.title}
                  </option>
                ))}
              </select>
            )}
            {item.category === 'event' && n.notify && (
              <button
                onClick={() =>
                  attempt(() =>
                    edit(w => {
                      const row = rows(w, a).find(r => r.id === n.notify)!;
                      return duplicate(w, a.uid, n.notify!, row.from.seconds).workspace;
                    })
                  )
                }
              >
                {tr('복제')}
              </button>
            )}
            {item.toggleable && (
              <button onClick={() => attempt(() => edit(w => deleteFlat(detachInspectorNode(w, n.id), n.id)))}>
                {tr('삭제')}
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="checklist-error">
          {error}
        </p>
      )}
      {eventEditor && <EventEditor node={n} close={() => setEventEditor(false)} />}
    </div>
  );
}

function AddItemMenu({
  groups,
  label,
  add,
}: {
  groups: {title: string; options: ReturnType<typeof contextualAdds>}[];
  label: string;
  add: (o: ReturnType<typeof contextualAdds>[number]) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  return (
    <div className="checklist-add-menu">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        + {label}
      </button>
      {open && (
        <div className="nowheel">
          <input
            aria-label={tr('{label} 검색', {label})}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tr('{label} 검색…', {label})}
          />
          {groups.map(g => {
            const shown = g.options.filter(o => o.label.includes(query));
            return shown.length ? (
              <div key={g.title} className="checklist-add-group" role="group" aria-label={g.title}>
                <small>{g.title}</small>
                {shown.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      add(o);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    {o.label
                      .replace(tr('앞에 블렌드 추가'), tr('시작 블렌드'))
                      .replace(tr('뒤에 블렌드 추가'), tr('종료 블렌드'))
                      .replace(/ 추가$/, '')}
                  </button>
                ))}
              </div>
            ) : null;
          })}
          {!groups.some(g => g.options.length) && <small>{tr('현재 동작에 추가할 항목이 없습니다.')}</small>}
        </div>
      )}
    </div>
  );
}

function EventEditor({node, close}: {node: FlatNode; close: () => void}) {
  const {w, edit, status, globalSettings} = useContext(ChecklistContext)!;
  const base = useRef(w),
    [draft, setDraft] = useState(() => structuredClone(w)),
    [error, setError] = useState('');
  const changed = w !== base.current,
    action = draft.actions.find(a => a.uid === node.action)!;
  const modal = useRef<HTMLDialogElement>(null);
  // Edits may change the workspace they are given and return it (putAction does), as the app's edit hands them
  // a copy: give them one here too, or the draft keeps its identity and the dialog never shows the change.
  const editDraft = (f: (w: Workspace) => Workspace) => setDraft(d => f(structuredClone(d)));
  useEffect(() => {
    modal.current?.showModal();
    return () => modal.current?.close();
  }, []);
  return createPortal(
    <dialog
      ref={modal}
      className="checklist-event-dialog"
      aria-label={tr('이벤트 편집')}
      onCancel={e => {
        e.preventDefault();
        close();
      }}
      onKeyDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <header>
        <strong>{node.title}</strong>
        <button onClick={close} aria-label={tr('이벤트 편집 닫기')}>
          ×
        </button>
      </header>
      <div className="checklist-body checklist-event-content">
        <NestedDetailPanel.Provider value={true}>
          {node.notify ? (
            <NotifyDetails w={draft} action={action} id={node.notify} edit={editDraft} />
          ) : (
            <GraphDetails
              w={draft}
              graph={node.scope}
              node={node.original}
              edit={editDraft}
              status={status}
              open={() => {}}
              selectedAsset=""
              onGlobalSettings={globalSettings}
            />
          )}
        </NestedDetailPanel.Provider>
      </div>
      {changed && <p role="alert">{tr('원본이 변경되었습니다. 창을 닫고 최신 설정을 다시 여세요.')}</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button onClick={close}>{tr('취소')}</button>
        <button
          disabled={changed}
          onClick={() => {
            try {
              edit(current => {
                if (JSON.stringify(current) !== JSON.stringify(base.current)) throw Error(tr('원본이 변경되었습니다.'));
                return draft;
              });
              close();
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          {tr('적용')}
        </button>
      </footer>
    </dialog>,
    document.body
  );
}

/** The events this clip sends (its HKX annotations) and what each does here: read only. Registered
 *  functions come from the event registry node; unregistered annotations can be registered. AMR root
 *  motion data is not an event; a paired clip's "NPC"/"2_" prefix names the sending actor. */
function HkxEvents({
  clip,
  owner,
  action,
  step,
  pair,
}: {
  clip: string;
  owner: string;
  action: string;
  step?: string;
  pair: boolean;
}) {
  const {w, edit} = useContext(ChecklistContext)!;
  const [open, setOpen] = useFold(`checklist:section:${w.id}:${owner}:hkxEvents`, true);
  const annotations = useClipAnnotations(w).get(clipKey(clip));
  const sent = useMemo(
    () =>
      annotations?.flatMap(a => {
        const e = sentEvent(a.text, pair);
        return e ? [{...e, time: a.time}] : [];
      }),
    [annotations, pair]
  );
  const entries = useMemo(() => new Map(renderedRegistry(w).map(e => [eventKey(e.name), e])), [w]);
  return (
    <section className="checklist-section hkx-events">
      <div className="checklist-section-title">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {/* What this section is goes to the help of its name (10-20, docs/mockup-ux-polish ④). */}
          <HelpTip
            label={tr('이벤트 · HKX 주석')}
            help={tr(
              '이 HKX가 보내는 이벤트를 HKX 주석에서 읽어 보여 줍니다(읽기 전용). 데스크톱 앱에서 HKX 원본 파일을 연결하면 보입니다. 이벤트 기능은 이벤트 등록에서 편집합니다.'
            )}
          >
            <span className="help-tip-label">{tr('이벤트')}</span>
          </HelpTip>{' '}
          · {sent?.length ?? 0}
        </button>
      </div>
      {open && (
        <>
          {!sent && <p className="hkx-events-hint">{tr('HKX 원본 파일을 연결하면 보입니다.')}</p>}
          {sent?.length === 0 && <p className="hkx-events-hint">{tr('보내는 이벤트 없음')}</p>}
          {sent?.map((e, i) => {
            const entry = entries.get(eventKey(e.name)),
              fns = entry?.row?.functions ?? [],
              uses = entry ? ownUseLabels(entry.uses, action, step) : [],
              // "name|value" is sent only when that whole spelling is registered (the row's values).
              valueMissing =
                !!e.values && !(entry?.row?.values ?? []).some(v => v.toLowerCase() === e.values.toLowerCase());
            const title = (
              <div className="hkx-event-name">
                {e.role && <span className={'hkx-event-role ' + e.role}>{roleLabel[e.role]}</span>}
                {e.name}
                {e.values && (
                  <span className="hkx-event-values">
                    {' '}
                    {tr('· 값')} {e.values.split('|').join(', ')}
                  </span>
                )}
              </div>
            );
            // The game itself handles vanilla behavior and SoundPlay events: nothing to register here.
            if (!entry && vanillaName(e.name))
              return (
                <div key={i} className="hkx-event unregistered">
                  <span className="hkx-event-time">{e.time.toFixed(2)}</span>
                  <div className="hkx-event-body">
                    {title}
                    <div className="hkx-event-state">{tr('게임 이벤트')}</div>
                  </div>
                </div>
              );
            if (!entry)
              return (
                <div key={i} className="hkx-event unregistered">
                  <span className="hkx-event-time">{e.time.toFixed(2)}</span>
                  <div className="hkx-event-body">
                    {title}
                    <div className="hkx-event-state">
                      {tr('미등록')}
                      <button
                        onClick={ev => {
                          // The card would select itself on this click; the registry is the target.
                          ev.stopPropagation();
                          edit(w => {
                            const next = addEventRow(w, e.name);
                            return e.values ? addEventValue(next, e.name, e.values) : next;
                          });
                          showRegistry(e.name);
                        }}
                      >
                        {tr('＋ 등록')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            return (
              <div
                key={i}
                className="hkx-event"
                title={tr('이벤트 등록 카드에서 이 이벤트 보기')}
                onClick={ev => {
                  ev.stopPropagation();
                  showRegistry(e.name);
                }}
              >
                <span className="hkx-event-time">{e.time.toFixed(2)}</span>
                <div className="hkx-event-body">
                  {title}
                  {!!fns.length && (
                    <div className="hkx-event-fn">{fns.map(f => functionSummary(f.values)).join(' / ')}</div>
                  )}
                  {!!uses.length && <div className="hkx-event-use">{uses.join(' / ')}</div>}
                  {!fns.length && !uses.length && (
                    <div className="hkx-event-state">
                      {entry.uses.length ? tr('이 동작에서 쓰지 않음') : tr('그래프 등록만 · 기능 없음')}
                    </div>
                  )}
                  {valueMissing && (
                    <div className="hkx-event-state warn">
                      {tr('값 이름 미등록 · 게임에서 이 주석이 발생하지 않음')}
                      <button
                        onClick={ev => {
                          ev.stopPropagation();
                          edit(w => addEventValue(w, e.name, e.values));
                        }}
                      >
                        {tr('＋ 값 등록')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!!sent?.length && (
            <p className="hkx-events-hint">
              <button
                onClick={ev => {
                  ev.stopPropagation();
                  showRegistry();
                }}
              >
                {tr('이벤트 등록에서 편집')}
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function UnassignedSettings() {
  const {w, model, edit, status, selected} = useContext(ChecklistContext)!;
  const [open, setOpen] = useState(false),
    [chosen, setChosen] = useState('');
  useEffect(() => {
    if (model.unassigned.some(n => n.id === selected)) {
      setChosen(selected);
      setOpen(true);
    }
  }, [selected]);
  if (!model.unassigned.length) return null;
  return (
    <div className="checklist-unassigned">
      <button onClick={() => setOpen(!open)}>
        {tr('미배정 설정')} {model.unassigned.length}
      </button>
      {open && (
        <div className="checklist-unassigned-panel">
          <button onClick={() => setOpen(false)}>{tr('닫기')}</button>
          <p>{tr('적용 대상을 선택하세요. 기존 값은 배정 전까지 보관합니다.')}</p>
          {model.unassigned.map(n => (
            <section key={n.id}>
              <button aria-expanded={chosen === n.id} onClick={() => setChosen(chosen === n.id ? '' : n.id)}>
                {chosen === n.id ? '▾' : '▸'} {n.title} · {n.summary}
              </button>
              {chosen === n.id && (
                <div className="checklist-body">
                  <DraftDetails w={w} id={n.id} edit={edit} status={status} />
                  <select
                    aria-label={tr('미배정 설정 적용 대상')}
                    value=""
                    onChange={e => {
                      const target = model.raw.nodes.find(n => n.id === e.target.value);
                      if (!target?.action) return;
                      edit(
                        w =>
                          attachDraft(
                            w,
                            w.drafts!.find(d => d.id === n.id)!,
                            target.action!,
                            target.step
                          ).workspace
                      );
                    }}
                  >
                    <option value="">{tr('적용할 HKX 선택…')}</option>
                    {model.raw.nodes
                      .filter(n => n.kind === 'hkxPlay')
                      .map(p => (
                        <option key={p.id} value={p.id}>
                          {w.actions.find(a => a.uid === p.action)?.config.name} · {p.step}
                        </option>
                      ))}
                  </select>
                  <button onClick={() => edit(w => deleteFlat(w, n.id))}>{tr('삭제')}</button>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
