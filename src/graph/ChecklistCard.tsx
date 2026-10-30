import {createContext, useContext, useState, useEffect, useRef, useMemo} from 'react';
import {useDismiss} from '../ui/useDismiss.ts';
import {useUpdateNodeInternals} from '@xyflow/react';
import {createPortal} from 'react-dom';
import type {Action, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {assetLibrary} from '../assets.ts';
import type {FlatNode} from './flat.ts';
import {addConnected, contextualAdds} from './contextAdd.ts';
import {deleteFlat} from './flat.ts';
import {GraphDetails} from './GraphDetails.tsx';
import {BlendDetails} from './BlendDetails.tsx';
import {StateDetails} from '../ui/details/StateDetails.tsx';
import {StepFiles, ViewFields, viewName, type ViewRow} from '../ui/details/ViewFields.tsx';
import {
  NestedDetailPanel,
  InspectorLayout,
  CategoryRows,
  ItemTitle,
  DetailRow,
  OnlySection,
} from '../ui/details/DetailRow.tsx';
import {detachInspectorNode} from '../ui/details/inspectorModel.ts';
import {switchPlaybackKind, playbackKind, playbackKinds, actionKindLabels} from '../actionTypes.ts';
import {duplicate, rows} from '../timeline/model.ts';
import {type ChecklistItem, checklistModel, transferItem} from './checklist.ts';
import './checklist.css';
import './registry.css';
import {useClipAnnotations, clipKey, sentEvent, roleLabel} from './annotations.ts';
import {functionSummary, eventKey, addEventRow, ownUseLabels, vanillaName, playerOnlyHint} from '../eventRegistry.ts';
import {commandSummary} from '../annotationCommands.ts';
import {ordinaryEffectOps} from '../clipEffects.ts';
import {MomentFields, useHkxMoments, RegistryMomentRow, CommandMomentRow, useClipLength} from './MomentFields.tsx';
import {byPlace, itemPlace, type Place} from './momentOrder.ts';
import {actionClip, sentEvents as hkxSentEvents} from './hkxMoments.ts';
import {openedBySwitch} from './momentOpen.ts';
import {showRegistry} from './RegistryCard.tsx';
import {HelpTip} from '../ui/HelpTip.tsx';
import {stepSource, actionView, projectView, setActionView, firstPersonStart, setFirstPersonStart} from '../view.ts';
import {timingLabel} from '../model.ts';
import {playbackState, resetAttack, resetDetection, resetExit} from './playbackSettings.ts';
import {exitSummary} from '../ui/details/inspectorModel.ts';
import {sourceWindow} from './clipWindows.ts';
import {t} from '../i18n/index.ts';
import {AddSetting, SettingChips, useSettings, type Setting} from './cardSettings.tsx';
import {renderedRegistry} from './renderCache.ts';
import {tr} from '../i18n/korean.ts';
import {errorText} from '../errorText.ts';

type Context = {
  w: Workspace;
  model: ReturnType<typeof checklistModel>;
  library: ReturnType<typeof assetLibrary>;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  select: (s: string) => void;
  /** Chooses a card and brings it into view at this zoom (the registry's "보기"). */
  show: (s: string) => void;
  selected: string;
  globalSettings: () => void;
};
export const ChecklistContext = createContext<Context | null>(null);
// A card's folds start as they are each time it opens (10-23): a section or item left open is not remembered.
// The key names the fold for readers; nothing is stored under it.
function useFold(_key: string, initial = false) {
  return useState(initial);
}
/** `fold`: the card is left in the summary view (an HKX card kept open by 「펼치기」): its open setting closes. */
export function ChecklistBody({node, fold = false}: {node: FlatNode; fold?: boolean}) {
  const ctx = useContext(ChecklistContext)!;
  const {w, edit, status, model, library} = ctx;
  const action = w.actions.find(a => a.uid === node.action);
  const clip = action?.config.steps.find(s => s.id === node.step);
  const [allOpen, setAllOpen] = useState<boolean>(),
    [error, setError] = useState('');
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
      setError(errorText(e));
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
  // The registered functions of the events this HKX sends and its AI. annotation commands (10-23).
  const sent = useHkxMoments(w, node.kind === 'hkxPlay' ? action : undefined);
  const items = storedItems;
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
      // A clip-time function may come several times (0.12.274); a slot is the action's once.
      if (
        !ordinaryEffectOps.includes(kind) &&
        items.some(i => i.node.notify === kind || i.node.notify === `${kind}:${node.step}`)
      )
        return false;
    }
    // The blends are playback settings (「＋ 설정」, unify ⑩), not features.
    if (o.kind === 'blend') return false;
    return true;
  });
  // 「모두 펼치기 · 모두 접기」 from the card's right-click menu (FlatGraph): every list and item of this card.
  useEffect(() => {
    const unfold = (e: Event) => {
      const d = (e as CustomEvent<{id: string; open: boolean}>).detail;
      if (d.id !== node.id) return;
      setAllOpen(d.open);
    };
    addEventListener('card-unfold', unfold);
    return () => removeEventListener('card-unfold', unfold);
  }, [node.id]);
  // The end and start blends are part of how the clip plays: playback settings, not 기능 (docs/mockup-card-layout).
  const blends = items.filter(i => i.node.kind === 'blend');
  const eventOption = (kind: string) =>
    kind === 'cameraRestore' ||
    kind === 'carryRelease' ||
    kind === 'carryFix' ||
    (kind.startsWith('notify:') &&
      !['rotate', 'iframe', 'armor', 'cost', 'recovery', 'vanillaCancel'].includes(kind.slice(7)));
  // The playback settings (docs/mockup unify ⑩, 10-27): a chip for each that differs from its default, opening in
  // place to its fields; the rest from 「＋ 설정」. A category of the Details (StateDetails) opens alone (OnlySection).
  const only =
    (id: string): ViewRow =>
    (rid, label, control, hint) =>
      rid === id ? cardRow(rid, label, control, hint) : null;
  const section = (id: string) => <OnlySection.Provider value={id}>{settings()}</OnlySection.Provider>;
  const playback = (): Setting[] => {
    if (!action) return [];
    const a = action,
      p = a.config,
      view = actionView(w, a),
      step = node.step ?? p.entry,
      state = playbackState(w, a, step),
      window = sourceWindow(a, step).value,
      attack = p.steps.length === 1 ? p.steps[0].attack || p.attack : p.attack || p.steps.find(s => s.attack)?.attack;
    const blend = (role: 'enter' | 'exit'): Setting => {
      const item = blends.find(i => i.blend === role),
        option = options.find(o => o.kind === 'blend' && !!o.before === (role === 'enter'));
      return {
        id: 'blend:' + role,
        label: item?.node.title ?? (role === 'enter' ? tr('블렌드(시작)') : tr('블렌드(종료)')),
        value: item?.node.summary ?? '',
        set: !!item,
        applies: !!item || !!option,
        add: () => option && attempt(() => edit(w => addConnected(w, settingsTarget, option, node.position).workspace)),
        reset: () => item && attempt(() => edit(w => deleteFlat(detachInspectorNode(w, item.node.id), item.node.id))),
        fields: () => item && <BlendDetails w={w} id={item.node.id} edit={edit} status={status} />,
      };
    };
    return [
      {
        id: 'kind',
        label: tr('유형'),
        value: actionKindLabels[playbackKind(a)],
        ...state.kind,
        fields: () => (
          <DetailRow label={tr('유형')}>
            <select
              aria-label={tr('동작 유형')}
              value={playbackKind(a)}
              onChange={e =>
                attempt(() => edit(w => switchPlaybackKind(w, a.uid, e.target.value as (typeof playbackKinds)[number])))
              }
            >
              {playbackKinds.map(k => (
                <option key={k} value={k}>
                  {actionKindLabels[k]}
                </option>
              ))}
            </select>
          </DetailRow>
        ),
      },
      {
        id: 'view',
        label: t('row.view'),
        value: viewName(view),
        ...state.view,
        reset: () => attempt(() => edit(w => setActionView(w, a.uid, projectView(w)))),
        fields: () => <ViewFields w={w} action={a} edit={edit} row={only('view')} />,
      },
      {
        id: 'firstPerson',
        label: t('row.firstPerson'),
        value: t('view.' + firstPersonStart(w, a)),
        ...state.firstPerson,
        reset: () => attempt(() => edit(w => setFirstPersonStart(w, a.uid, 'block'))),
        fields: () => <ViewFields w={w} action={a} edit={edit} row={only('firstPerson')} />,
      },
      {
        id: 'detection',
        label: tr('입력 감지'),
        value: timingLabel(window.open) + ' → ' + timingLabel(window.close),
        ...state.detection,
        reset: () => edit(w => resetDetection(w, a.uid, step)),
        fields: () => section('detection'),
      },
      {
        id: 'exit',
        label: tr('종료'),
        value: exitSummary(a),
        ...state.exit,
        reset: () => edit(w => resetExit(w, a.uid)),
        fields: () => section('exit'),
      },
      {
        id: 'attack',
        label: tr('공격 데이터'),
        value: attack ?? '',
        ...state.attack,
        reset: () => edit(w => resetAttack(w, a.uid)),
        fields: () => section('attack'),
      },
      blend('enter'),
      blend('exit'),
    ];
  };
  const playSettings = useSettings(playback(), fold);
  // One "+ 기능" (10-16, docs/mockup-feature-merge): what applies to the whole play, then what happens at a moment.
  const addMenu = () => (
    <AddItemMenu
      groups={[
        {title: tr('재생 전체'), options: internal.filter(o => !eventOption(o.kind))},
        {title: tr('특정 순간 ⏱'), options: internal.filter(o => eventOption(o.kind))},
      ]}
      label={tr('기능')}
      add={option => attempt(() => edit(w => addConnected(w, settingsTarget, option, node.position).workspace))}
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
      {action && (
        <>
          {/* The header rows share one label column (docs/mockup-layout-audit ①): every control starts at the same
                place whatever the longest label is. */}
          <div className="checklist-head">
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
          </div>
          {/* What of the playback differs from its default, as chips (unify ⑩, docs/mockup-playback-settings before). */}
          <SettingChips settings={playSettings} />
          {/* The features and the HKX's events fold each on their own (one "기능 · 이벤트" fold above them was the
                same fold twice, 10-20). */}
          {
            <ChecklistSection
              owner={node.id}
              items={items.filter(i => i.category === 'feature' && i.node.kind !== 'blend')}
              moments={items.filter(i => i.category === 'event')}
              sent={sent}
              action={action}
              allOpen={allOpen}
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
          <div className="checklist-add-actions two">
            {addMenu()}
            <AddSetting settings={playSettings} />
          </div>
          <section className="checklist-section checklist-info">
            <NestedDetailPanel.Provider value={true}>
              <CategoryRows.Provider value={{}}>{settings('info')}</CategoryRows.Provider>
            </NestedDetailPanel.Provider>
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="checklist-error">
          {error}
        </p>
      )}
    </div>
  );
}
// One list (10-16, docs/mockup-feature-merge), ordered by when each happens (10-23, graph/momentOrder.ts): the whole
// play and the start blend first, then every moment by its trigger time whether on the clip or an event, the end
// blend last. What happens at a moment is marked ⏱.
function ChecklistSection({
  owner,
  items,
  moments,
  sent,
  action,
  allOpen,
}: {
  owner: string;
  items: ChecklistItem[];
  moments: ChecklistItem[];
  sent?: ReturnType<typeof useHkxMoments>;
  action?: Action;
  allOpen?: boolean;
}) {
  const {w, selected, edit} = useContext(ChecklistContext)!;
  const extra = (sent?.registry.length ?? 0) + (sent?.commands.length ?? 0);
  // Ordered by when each happens (graph/momentOrder.ts): an item keeps its place on the clip or an event.
  const annotations = useClipAnnotations(w).get(clipKey(action ? actionClip(w, action) : ''));
  const length = useClipLength(w, action);
  const eventTimes = useMemo(
    () => new Map(hkxSentEvents(annotations, !!action?.pair).map(e => [eventKey(e.name), e.times[0] ?? Infinity])),
    [annotations, action?.pair]
  );
  // The list is open when its card opens; each item in it starts closed (10-23).
  const [open, setOpen] = useFold(`checklist:section:${w.id}:${owner}:feature`, true);
  useEffect(() => {
    if ([...items, ...moments].some(i => i.node.id === selected)) setOpen(true);
  }, [selected]);
  return (
    <section className="checklist-section">
      <div className="checklist-section-title">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {tr('기능')} <span className="section-count">{items.length + moments.length + extra}</span>
        </button>
      </div>
      {open &&
        byPlace([
          ...[...items, ...moments].map(item => {
            const place = action
              ? itemPlace(w, action, item.node, item.blend, eventTimes, length)
              : ({group: 0, t: 0} as Place);
            return {
              place,
              key: item.node.id,
              // What happens at a moment is marked ⏱, on the clip or an event alike.
              el: (moment: boolean) => (
                <ChecklistRow key={item.node.id} item={item} owner={owner} allOpen={allOpen} moment={moment} />
              ),
            };
          }),
          ...(action
            ? (sent?.registry ?? []).map(r => ({
                place: {group: 1, t: r.sent.times[0] ?? Infinity} as Place,
                key: r.key,
                el: () => <RegistryMomentRow key={r.key} w={w} action={action} item={r} edit={edit} />,
              }))
            : []),
          ...(sent?.commands ?? []).map(c => ({
            place: {group: 1, t: c.rows[0]?.time ?? c.bad[0]?.time ?? Infinity} as Place,
            key: c.key,
            el: () => <CommandMomentRow key={c.key} item={c} />,
          })),
        ]).map(entry => entry.el(entry.place.group === 1))}
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
  const {w, edit, status, select} = ctx;
  const n = item.node,
    a = w.actions.find(a => a.uid === n.action)!;
  // An item a clip/event switch just made opens (MomentFields.tsx openAfterSwitch).
  const [open, setOpen] = useFold(
    `checklist:${w.id}:${owner}:${n.id}`,
    !!n.notify && openedBySwitch(`${n.action}|${n.notify}`)
  );
  const [error, setError] = useState('');
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
  const {title, summary} = n;
  // Dragged by its name onto another HKX card (unify ⑪, as a condition between condition cards): it moves there, or
  // is copied with Ctrl held. Pointer events (graph/ConditionCardFace.tsx says why); 5 px before it is a drag.
  const [ghost, setGhost] = useState<{x: number; y: number; copy: boolean} | null>(null);
  const begin = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.checklist-row-icons')) return;
    const x0 = e.clientX,
      y0 = e.clientY;
    let moving = false,
      target: HTMLElement | null = null;
    const mark = (card: HTMLElement | null) => {
      if (card === target) return;
      target?.classList.remove('item-drop');
      target = card;
      target?.classList.add('item-drop');
    };
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moving = true;
      const card = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '.p3-node.hkxPlay[data-card]'
      );
      mark(card && card.dataset.card !== owner ? card : null);
      setGhost({x: ev.clientX, y: ev.clientY, copy: ev.ctrlKey});
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!moving) return;
      const card = target?.dataset.card;
      mark(null);
      setGhost(null);
      // The click after the release would open the row.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => removeEventListener('click', swallow, {capture: true}), 0);
      const to = card && ctx.model.raw.nodes.find(x => x.id === card)?.action;
      if (!to || ev.type !== 'pointerup') return;
      try {
        // Made first: edit reports a refusal itself and goes on, and the message here would cover it.
        const next = transferItem(w, n.id, to, ev.ctrlKey);
        edit(() => next);
        status(ev.ctrlKey ? tr('기능을 그 HKX 카드에 복사했습니다.') : tr('기능을 그 HKX 카드로 옮겼습니다.'));
      } catch (e) {
        status(errorText(e));
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div
      ref={rowRef}
      className={'checklist-row' + (moment ? ' moment' : '') + (ctx.selected === n.id ? ' active-item' : '')}
      data-item={n.id}
    >
      {ghost &&
        createPortal(
          <div
            className={'cond-drag-ghost' + (ghost.copy ? ' copy' : '')}
            style={{left: ghost.x + 12, top: ghost.y + 10}}
          >
            {ghost.copy && <b>{tr('복사')}</b>}
            {title}
          </div>,
          document.body
        )}
      {/* No checkbox (10-23, docs/mockup-no-checkbox): an item is used while it is there and deleted to stop. */}
      <div className="checklist-row-heading" onPointerDown={begin}>
        <button
          className="checklist-row-toggle"
          title={[item.scope, playerOnlyHint(rows(w, a).find(r => r.id === n.notify)?.kind ?? '')]
            .filter(Boolean)
            .join(' · ')}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            select(owner);
          }}
        >
          <span>{title}</span>
          {/* A moment's when: an event is a chip, a clip time plain text (graph/cardTheme.css). */}
          <small title={summary} className={moment && /^[\d.]/.test(summary) ? 'time' : undefined}>
            {/* A summary that only repeats the title ("상태 조건 · 상태 조건") is left out. */}
            {summary === title ? '' : summary}
          </small>
        </button>
        {open && (
          <span className="checklist-row-icons">
            {item.category === 'event' && n.notify && (
              <button
                type="button"
                aria-label={tr('복제')}
                title={tr('복제')}
                onClick={() =>
                  attempt(() =>
                    edit(w => {
                      const row = rows(w, a).find(r => r.id === n.notify)!;
                      return duplicate(w, a.uid, n.notify!, row.from.seconds).workspace;
                    })
                  )
                }
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
                  <path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" />
                </svg>
              </button>
            )}
            {item.removable && (
              <button
                type="button"
                className="danger"
                aria-label={n.kind === 'blend' ? tr('삭제 · 엔진 기본값으로') : tr('삭제')}
                title={n.kind === 'blend' ? tr('지우면 엔진 기본 블렌드를 씁니다.') : tr('삭제')}
                onClick={() => attempt(() => edit(w => deleteFlat(detachInspectorNode(w, n.id), n.id)))}
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
            )}
          </span>
        )}
      </div>
      {open && item.scope !== tr('이 클립') && <span className="checklist-shared">{item.scope}</span>}
      {open && (
        <div className="checklist-fields">
          <NestedDetailPanel.Provider value={true}>
            <ItemTitle.Provider value={title}>
              {n.kind === 'stateCondition' && a ? (
                <AirRule action={a} edit={edit} />
              ) : item.category === 'event' || n.notify ? (
                // Moments and timed features alike: 시점 [클립 | 이벤트] first (docs/mockup-moment-timing).
                <MomentFields
                  w={w}
                  action={a}
                  node={n}
                  edit={edit}
                  status={status}
                  globalSettings={ctx.globalSettings}
                />
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
            </ItemTitle.Provider>
          </NestedDetailPanel.Provider>
        </div>
      )}
      {error && (
        <p role="alert" className="checklist-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The 「공중」 item: where the HKX may start. It is an item only while the air is allowed (graph/flat.ts); deleting it
 *  makes the HKX ground only. Its start graph has no nodes for GraphDetails to show, so it edits here. */
function AirRule({action, edit}: {action: Action; edit: (fn: (w: Workspace) => Workspace) => void}) {
  const air = action.config.air;
  return (
    <DetailRow label={tr('시작 위치')}>
      <div className="qte-seg" role="group" aria-label={tr('시작 위치')}>
        {(
          [
            ['allow', tr('땅·공중')],
            ['only', tr('공중에서만')],
          ] as const
        ).map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-pressed={air === value}
            onClick={() => edit(w => putAction(w, {...action, config: {...action.config, air: value}}))}
          >
            {name}
          </button>
        ))}
      </div>
    </DetailRow>
  );
}

function AddItemMenu({
  groups,
  label,
  add,
  search = true,
}: {
  groups: {title: string; options: ReturnType<typeof contextualAdds>}[];
  label: string;
  add: (o: ReturnType<typeof contextualAdds>[number]) => void;
  /** A short list needs no search box. */
  search?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => {
    setOpen(false);
    setQuery('');
  });
  return (
    <div className="checklist-add-menu" ref={ref}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        + {label}
      </button>
      {open && (
        <div className="nowheel">
          {search && (
            <input
              aria-label={tr('{label} 검색', {label})}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tr('{label} 검색…', {label})}
            />
          )}
          {groups.map(g => {
            const shown = g.options.filter(o => o.label.includes(query));
            return shown.length ? (
              <div key={g.title} className="checklist-add-group" role="group" aria-label={g.title}>
                <small>{g.title}</small>
                {shown.map((o, i) => (
                  <button
                    key={i}
                    disabled={!!o.disabled}
                    title={o.disabled}
                    onClick={() => {
                      add(o);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    {o.label
                      .replace(tr('앞에 블렌드 추가'), tr('블렌드(시작)'))
                      .replace(tr('뒤에 블렌드 추가'), tr('블렌드(종료)'))
                      .replace(/ 추가$/, '')}
                    {o.disabled && <small> · {o.disabled}</small>}
                    {!o.disabled && o.note && <small> · {o.note}</small>}
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
  const [open, setOpen] = useFold(`checklist:section:${w.id}:${owner}:hkxEvents`);
  useEffect(() => {
    const unfold = (e: Event) => {
      const d = (e as CustomEvent<{id: string; open: boolean}>).detail;
      if (d.id === owner) setOpen(d.open);
    };
    addEventListener('card-unfold', unfold);
    return () => removeEventListener('card-unfold', unfold);
  }, [owner]);
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
  // An HKX that sends nothing shows no events section (unify ⑩); an unread one still says how to see them.
  if (sent?.length === 0) return null;
  return (
    <section className="checklist-section hkx-events">
      <div className="checklist-section-title">
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {/* What this section is goes to the help of its name (10-20, docs/mockup-ux-polish ④). */}
          <HelpTip
            label={tr('이벤트 · HKX 주석')}
            help={tr(
              '이 HKX가 보내는 이벤트를 HKX 주석에서 읽어 보여 줍니다(읽기 전용). 데스크톱 앱에서 HKX 원본 파일을 연결하면 보입니다. 이벤트 기능은 이벤트 등록에서 편집합니다. 주석 AI.CamShake|세기|시간은 등록 없이 그 시점에 카메라를 흔듭니다.'
            )}
          >
            <span className="help-tip-label">{tr('이벤트')}</span>
          </HelpTip>{' '}
          <span className="section-count">{sent?.length ?? 0}</span>
        </button>
      </div>
      {open && (
        <>
          {!sent && <p className="hkx-events-hint">{tr('HKX 원본 파일을 연결하면 보입니다.')}</p>}
          {sent?.length === 0 && <p className="hkx-events-hint">{tr('보내는 이벤트 없음')}</p>}
          {sent?.map((e, i) => {
            const entry = entries.get(eventKey(e.name)),
              fns = entry?.row?.functions ?? [],
              uses = entry ? ownUseLabels(entry.uses, action, step) : [];
            const title = (
              <div className="hkx-event-name">
                {e.role && <span className={'hkx-event-role ' + e.role}>{roleLabel[e.role]}</span>}
                {e.command ? 'AI.' + e.values : e.name}
                {!e.command && e.values && (
                  <span className="hkx-event-values">
                    {' '}
                    {tr('· 값')} {e.values.split('|').join(', ')}
                  </span>
                )}
              </div>
            );
            // "AI.Command|..." runs at once, declared nowhere (runtime 0.12.274).
            if (e.command) {
              const summary = commandSummary(e.values);
              return (
                <div key={i} className="hkx-event">
                  <span className="hkx-event-time">{e.time.toFixed(2)}</span>
                  <div className="hkx-event-body">
                    {title}
                    {summary ? (
                      <div className="hkx-event-fn">
                        {tr('주석 명령')} · {summary}
                      </div>
                    ) : (
                      <div className="hkx-event-state warn">
                        {tr('알 수 없는 주석 명령 · AI.CamShake|세기|시간 형식만 실행됩니다')}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            // "name|value" makes the whole text the event name, which no registry may hold: never sent.
            if (e.values)
              return (
                <div key={i} className="hkx-event unregistered">
                  <span className="hkx-event-time">{e.time.toFixed(2)}</span>
                  <div className="hkx-event-body">
                    {title}
                    <div className="hkx-event-state warn">
                      {tr('「|」가 든 주석은 게임에서 발생하지 않습니다 · 흔들림은 AI.CamShake|세기|시간으로 적으세요')}
                    </div>
                  </div>
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
                          edit(w => addEventRow(w, e.name));
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

/** Settings no card holds: none in format 6 (every item belongs to its HKX card). */
export function UnassignedSettings() {
  return null;
}
