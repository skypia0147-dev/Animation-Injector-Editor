import {ChecklistBody, ChecklistContext, UnassignedSettings} from './ChecklistCard.tsx';
import {PinMenu, openPinMenu} from './PinMenu.tsx';
import {setBranchTarget} from './conditionCommands.ts';
import {routeTarget} from './ConditionExpressionEditor.tsx';
import {connectPin, createdLink, pinRows, portLabel, routable, routePins, routeTone, routeEmpty} from './pinTargets.ts';
import {parseNodeId} from './nodeRef.ts';
import {RegistryBody} from './RegistryCard.tsx';
import {checklistModel, checklistProjection, copyChecklistNodes, deleteChecklistNode} from './checklist.ts';
import {actionView, placeStepFile} from '../view.ts';
import {pasteNodes, nodeClipboard, setNodeClipboard} from './clipboard.ts';
import {beginFocus, retainFocus, type FocusSession} from './focusSession.ts';
import {ConnectionEdge} from './ConnectionEdge.tsx';
import {executeGraphCommand} from './commands.ts';
import {startRow, type StartRow} from './startRow.ts';
import {freePlayPosition, visibleNodePosition, visiblePastePosition} from './placement.ts';
import {visibleEdges} from './disconnect.ts';
import {fitsAt, neighbors} from './navigation.ts';
import {arrangeLayout} from './arrange.ts';
import {HelpTip} from '../ui/HelpTip.tsx';
import {MenuList} from '../ui/MenuList.tsx';
import {contextualAdds} from './contextAdd.ts';
import {ruleNode} from './sharing.ts';
import {shareUnchanged} from './historySharing.ts';
import {QteGlyph} from './QteGlyph.tsx';
import {listenMerges, cutQteListen, connectQteToEvent} from './qteListen.ts';
import {useClipAnnotations, clipKey, sentEvent} from './annotations.ts';
import {boxMode, boxSelection, spanned, toggled, touches, SELECTION_COMMAND, type Rect} from './marquee.ts';
import {createContext, memo, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  useUpdateNodeInternals,
  useStore,
  applyNodeChanges,
} from '@xyflow/react';
import type {Node, NodeProps} from '@xyflow/react';
import type {Workspace} from '../workspace.ts';
import {flatNode, addFlat, deleteFlat, REGISTRY_NODE} from './flat.ts';
import {renderedChecklist, renderedLibrary, renderedRegistry} from './renderCache.ts';
import {advanceGate, gateState} from './cardGate.ts';
import type {FlatNode} from './flat.ts';
import {moveNodes, addComment} from './projection.ts';
import {CanvasControls, Icon} from '../EditorChrome.tsx';
import {presentCard, cardWidth, cardHeight, pinTop, summaryHeight} from './cardPresentation.ts';
import type {CardPresentation} from './cardPresentation.ts';
import {useEditorMenu} from '../ContextMenu.tsx';
import {t, useLanguage} from '../i18n/index.ts';
import {tr} from '../i18n/korean.ts';
/** routeTo: where each route row's pin goes now, by name (routePins). */
type Visual = Node<
  FlatNode & {presentation: CardPresentation; collapsed?: boolean; routeTo?: Record<string, string>; start?: StartRow},
  'flat'
>;
type CardModel = ReturnType<typeof renderedChecklist>;
/** What decides when a card draws again (graph/cardGate.ts). */
const CardGate = createContext<{
  w: Workspace;
  model: CardModel;
  library: unknown;
  selected: string;
  epoch: number;
  versions: Map<string, number>;
} | null>(null);
/** HKX card view (docs/mockup-arrange): summaries, or every card in full. A summary opens when its card is
 *  chosen or by its own button; an open card floats over its neighbours (the layout keeps summary heights). */
const CardView = createContext<{
  summary: boolean;
  opened: Set<string>;
  open: (id: string, open: boolean) => void;
} | null>(null);
const cardViewKey = (id: string) => 'aieditor-cardview:' + id;
function storedCardView(id: string): 'summary' | 'full' {
  try {
    return localStorage.getItem(cardViewKey(id)) === 'full' ? 'full' : 'summary';
  } catch {
    return 'summary';
  }
}
const viewNames = {
  get third() {
    return tr('3인칭');
  },
  get first() {
    return tr('1인칭');
  },
  get both() {
    return tr('1·3인칭');
  },
} as const;
/** A collapsed HKX card: its file, kind and view, and the features and HKX moments in use. */
function HkxSummary({node}: {node: Visual['data']}) {
  const gate = useContext(CardGate)!,
    view = useContext(CardView)!;
  const a = gate.w.actions.find(a => a.uid === node.action),
    step = a?.config.steps.find(s => s.id === node.step);
  const used = (gate.model.items.get(node.id) ?? []).filter(i => i.enabled),
    shown = used.slice(0, 6);
  return (
    <div className="hkx-summary">
      <div className="node-field">
        <span>{tr('파일')}</span>
        <span className="node-value" title={step?.clip}>
          {step?.clip ? step.clip.split(/[\\/]/).pop() : tr('(HKX 없음)')}
        </span>
      </div>
      <div className="node-field">
        <span>{tr('종류 · 인칭')}</span>
        <span className="node-value">
          {a?.pair ? tr('페어') : tr('일반')} · {a ? viewNames[actionView(gate.w, a)] : ''}
        </span>
      </div>
      <div className="hkx-chips">
        {shown.map(i => (
          <span
            key={i.node.id}
            className="hkx-chip"
            title={i.node.title + (i.node.summary ? ' · ' + i.node.summary : '')}
          >
            {i.node.title}
            {i.node.summary && i.node.summary !== i.node.title && i.node.summary.length <= 14 && (
              <em>{i.node.summary}</em>
            )}
          </span>
        ))}
        {used.length > shown.length && <span className="hkx-chip more">+{used.length - shown.length}</span>}
      </div>
      <div className="hkx-summary-foot">
        <span>
          {tr('기능')} {used.length}
        </span>
        <button
          type="button"
          className="nodrag"
          onClick={e => {
            e.stopPropagation();
            view.open(node.id, true);
          }}
        >
          {tr('펼치기')}
        </button>
      </div>
    </div>
  );
}
/** "정렬 ▾" of the graph toolbar: arrange everything or the chosen card's block, and the HKX card view. */
function ArrangeMenu({
  all,
  chosen,
  summary,
  setSummary,
}: {
  all: () => void;
  chosen?: () => void;
  summary: boolean;
  setSummary: (summary: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  return (
    <div className="tb-dropdown arrange-menu" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        title={tr(
          '입력·조건·HKX·전환을 한 줄로 잇고, 이어지지 않은 묶음은 그래프 칸 비율에 맞춰 채웁니다. 이벤트 등록은 맨 왼쪽입니다. Ctrl+Z로 되돌릴 수 있습니다.'
        )}
      >
        {tr('정렬 ▾')}
      </button>
      {open && (
        <div className="menu-popup" role="menu">
          <MenuList
            close={() => setOpen(false)}
            items={[
              {label: tr('전체 정렬'), run: all},
              {label: tr('고른 동작만 정렬'), disabled: !chosen, run: chosen},
              '-',
              {label: tr('HKX 카드 요약으로 보기'), checked: summary, run: () => setSummary(true)},
              {label: tr('모든 HKX 카드 펼치기'), checked: !summary, run: () => setSummary(false)},
            ]}
          />
        </div>
      )}
    </div>
  );
}
// The card bodies read the document through ChecklistContext (one identity, the latest values); these props
// are only what makes them draw again.
const CardBody = memo(function CardBody({
  node,
  fold,
}: {
  node: Visual['data'];
  items: unknown;
  epoch: number;
  version: number;
  selection: string;
  library: unknown;
  fold?: 'open' | 'closed';
}) {
  return <ChecklistBody node={node} fold={fold} />;
});
function GatedChecklist({node}: {node: Visual['data']}) {
  const gate = useContext(CardGate)!,
    items = gate.model.items.get(node.id),
    s = gate.selected;
  // The body follows the selection only when it is this card, one of its items or something it owns.
  const touched =
    !!s && (s === node.id || !!items?.some(i => i.node.id === s) || !!gate.model.owners.get(s)?.includes(node.id));
  // Summary view: a condition's editor is open while the card (or what it owns) is chosen, as an HKX card is.
  const summary = useContext(CardView)?.summary,
    fold =
      summary && (node.kind === 'conditionBranch' || node.kind === 'conditionTable')
        ? touched
          ? ('open' as const)
          : ('closed' as const)
        : undefined;
  return (
    <CardBody
      fold={fold}
      node={node}
      items={items}
      epoch={gate.epoch}
      version={node.action ? (gate.versions.get(node.action) ?? 0) : 0}
      selection={touched ? s : ''}
      library={gate.library}
    />
  );
}
// The registry lists every event's uses: it draws with every document.
const RegistryCardBody = memo(function RegistryCardBody(_: {w: Workspace}) {
  return <RegistryBody />;
});
function GatedRegistry() {
  return <RegistryCardBody w={useContext(CardGate)!.w} />;
}
/** The "시작" row under an HKX card's title (mockup A, 10-20): how the action starts. A key or event picks its start
 *  card; nothing yet offers a start key or event (as the card's right-click menu does). */
function StartLine({node, start}: {node: Visual['data']; start: StartRow}) {
  const ctx = useContext(ChecklistContext);
  const add = (kind: 'keyInput' | 'markerReceive') => {
    if (!ctx) return;
    try {
      let made = '';
      ctx.edit(w => {
        const r = executeGraphCommand(w, {
          type: 'addConnected',
          source: node.id,
          option: {label: '', kind, before: true},
          position: {x: node.position.x - 300, y: node.position.y},
        });
        made = r.id ?? '';
        return r.workspace;
      });
      if (made) ctx.select(made);
    } catch (e) {
      ctx.status(String(e));
    }
  };
  return (
    <div className={'card-start nodrag ' + start.tone}>
      {start.tone === 'set' && start.node ? (
        <button type="button" className="card-start-pick" onClick={() => ctx?.select(start.node!)}>
          {tr('시작 · ') + start.text}
        </button>
      ) : (
        <span>{start.tone === 'none' ? start.text : tr('시작 · ') + start.text}</span>
      )}
      {start.tone === 'none' && (
        <>
          <button type="button" onClick={() => add('keyInput')}>
            {tr('＋ 키')}
          </button>
          <button type="button" onClick={() => add('markerReceive')}>
            {tr('＋ 이벤트')}
          </button>
        </>
      )}
    </div>
  );
}
function Card({id, data, selected}: NodeProps<Visual>) {
  // React Flow measures a card's pins when it mounts or resizes: a pin added without a size change (an HKX's
  // victim input once a pair's transition reaches it) needs a new measure, or lines to it are not drawn.
  const update = useUpdateNodeInternals(),
    pins = data.inputs.join(',') + '|' + data.outputs.join(','),
    measured = useRef(pins);
  useEffect(() => {
    // Mounting measures already: only a change of pins after that.
    if (measured.current === pins) return;
    measured.current = pins;
    update(id);
  }, [id, pins, update]);
  const cardView = useContext(CardView);
  const roles = data.outputs.includes('partner'),
    context = useContext(ChecklistContext),
    ctx = routable(data) ? context : null;
  // Every pin with a destination list is a row at the card's foot (below); any other pin stays on the card's edge.
  const routes = routePins(data),
    edgePins = routes.length ? data.outputs.filter(p => !routes.includes(p)) : data.outputs,
    branch = parseNodeId(data.id),
    test =
      branch.kind === 'branch' && context
        ? context.w.actions.find(a => a.uid === branch.owner)?.flow?.tests.find(t => t.id === branch.test)
        : undefined;
  // A condition's route reads from its test (an unconnected one says what then happens: next condition or none).
  const routeText = (p: string) =>
    test && (p === 'pass' || p === 'fail') && context ? routeTarget(context.w, test, p) : data.routeTo?.[p] || '';
  const routeSet = (p: string) => (test && (p === 'pass' || p === 'fail') ? !!test[p] : !!data.routeTo?.[p]);
  // A routing pin's destination is also chosen from a list (graph/pinTargets.ts), read when it opens.
  // The shown document's view comes from the render cache; an edit's copy is projected on its own.
  const view = (w: Workspace) => checklistProjection(w, renderedChecklist(w));
  const choose = (p: string, target: string) => {
    let made = '';
    try {
      ctx!.edit(w => {
        const after = connectPin(w, checklistProjection(w, checklistModel(w)), data.id, p, target);
        made = createdLink(w, after);
        return after;
      });
    } catch (e) {
      ctx!.status(String(e));
    }
    if (made) ctx!.select(made);
  };
  // A route row: what it is, where it goes, its list (the whole row opens it) and its pin on the row's edge.
  const routeRow = (p: string, kind: React.ReactNode, text: string, empty: boolean, extra = '') => (
    <div key={p} className={'branch-route tone-' + routeTone(data, p) + extra}>
      <span className="branch-route-kind">{kind}</span>
      <span className={'branch-route-to' + (empty ? ' empty' : '')}>{text}</span>
      {ctx && (
        <PinMenu
          className="branch-route-menu"
          label="▾"
          title={portLabel(data, p) + tr(' 연결 대상 고르기')}
          load={() => pinRows(ctx.w, view(ctx.w), data.id).find(r => r.pin === p)}
          pick={target => choose(p, target)}
        />
      )}
      <Handle id={p} type="source" position={Position.Right} title={portLabel(data, p)} />
    </div>
  );
  // A lone QTE's results (docs/mockup-qte-redesign/pair-results): each outcome's row, then who goes where under it:
  // a pair's transition the attacker's and the victim's rows, an event its row; "계속" is the outcome's row alone.
  const outcomeNames = {success: tr('성공'), failure: tr('실패'), perfect: tr('완벽')} as const,
    roleNames = {self: tr('가해자'), partner: tr('피해자'), both: tr('양쪽')} as const;
  const qteRows = data.presentation.qte?.results?.flatMap(r => {
    const pin = r.k === 'success' ? 'pass' : r.k === 'failure' ? 'fail' : 'perfect',
      partner = `choice:${r.k}:partner`;
    if (r.mode === 'continue')
      return [
        routeRow(pin, outcomeNames[r.k], r.k === 'perfect' ? tr('성공 경로 사용') : tr('계속'), true, ' qte-outcome'),
      ];
    const rows = [
      <div key={r.k + ':head'} className={'branch-route qte-outcome qte-outcome-head tone-' + routeTone(data, pin)}>
        <span className="branch-route-kind">{outcomeNames[r.k]}</span>
      </div>,
    ];
    if (r.mode === 'event')
      rows.push(
        routeRow(
          pin,
          <i className="qte-role event">⚡</i>,
          (routeSet(pin) ? routeText(pin).replace(/^⚡ /, '') : r.event || tr('이벤트를 지정하세요')) +
            (r.pair && !r.player ? ' · ' + roleNames[r.recipient] : ''),
          !routeSet(pin),
          ' qte-role-row'
        )
      );
    else {
      rows.push(
        routeRow(
          pin,
          <i className={'qte-role ' + (r.player ? 'player' : r.pair ? 'attacker' : 'next')}>
            {r.player ? tr('플레이어') : r.pair ? tr('가해자') : tr('다음')}
          </i>,
          routeSet(pin) ? routeText(pin) : tr('동작을 고르세요'),
          !routeSet(pin),
          ' qte-role-row'
        )
      );
      if (r.pair)
        rows.push(
          routeRow(
            partner,
            <i className={'qte-role ' + (r.player ? 'partner' : 'victim')}>{r.player ? tr('상대') : tr('피해자')}</i>,
            routeSet(partner) ? routeText(partner) : r.player ? tr('지정 안 함') : tr('그대로 (하던 페어)'),
            !routeSet(partner),
            ' qte-role-row'
          )
        );
    }
    return rows;
  });
  return (
    <div
      className={
        'p3-node ' +
        data.kind +
        (selected ? ' selected' : '') +
        (data.collapsed ? ' collapsed' : '') +
        (data.neighbor ? ' neighbor' : '')
      }
      style={
        data.collapsed
          ? {width: cardWidth(data), minWidth: cardWidth(data), height: summaryHeight(data)}
          : {width: cardWidth(data), minWidth: cardWidth(data), minHeight: cardHeight(data)}
      }
      data-card={data.id}
    >
      {data.inputs.map((p, i) => (
        <Handle key={p} id={p} type="target" position={Position.Left} style={{top: pinTop(data) + i * 24}} title={p} />
      ))}
      <strong className="checklist-drag-handle" title={data.presentation.title}>
        <Icon name={data.presentation.icon} size={19} />
        <span>{data.presentation.title}</span>
      </strong>
      {data.start && <StartLine node={data} start={data.start} />}
      {data.kind === 'eventRegistry' ? (
        <GatedRegistry />
      ) : data.collapsed ? (
        <HkxSummary node={data} />
      ) : ['hkxPlay', 'conditionBranch', 'conditionTable'].includes(data.kind) ? (
        <GatedChecklist node={data} />
      ) : data.presentation.qte ? (
        <div className="qte-face">
          <QteGlyph
            type={data.presentation.qte.type}
            design={data.presentation.qte.design}
            pressCount={data.presentation.qte.pressCount}
            label={data.presentation.qte.key}
            size={52}
          />
          <div>
            <strong>{data.presentation.qte.typeName}</strong>
            <span>{data.presentation.qte.input}</span>
            <span>{data.presentation.qte.start}</span>
          </div>
          {data.presentation.qte.rules > 0 && (
            <em className="qte-face-tag">
              {tr('묶음 ·')} {data.presentation.qte.rules}
              {tr('규칙')}
            </em>
          )}
        </div>
      ) : (
        <div className="node-fields">
          {data.presentation.rows.map((r, i) => (
            <div className="node-field" key={i}>
              <span>{r.label}</span>
              <span className="node-value" title={r.value}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {qteRows ? (
        <div className="branch-routes qte-routes">{qteRows}</div>
      ) : (
        routes.length > 0 && (
          // Routes are rows at the card's foot: what the route is, where it goes, its list (the whole row opens it)
          // and its pin on the row's edge (docs/mockup-branch-pins, docs/mockup-route-rows, 10-15).
          <div className="branch-routes">
            {routes.map(p =>
              routeRow(p, portLabel(data, p), routeSet(p) || test ? routeText(p) : routeEmpty(data, p), !routeSet(p))
            )}
          </div>
        )
      )}
      {edgePins.map((p, i) => (
        <Handle
          key={p}
          id={p}
          type="source"
          position={Position.Right}
          style={{top: pinTop(data) + i * 24}}
          title={portLabel(data, p)}
        >
          {(p === 'pass' || p === 'fail' || p === 'perfect' || p.startsWith('choice:') || roles) && (
            <span className="node-port-label">{portLabel(data, p)}</span>
          )}
        </Handle>
      ))}
      {cardView?.summary && data.kind === 'hkxPlay' && !data.collapsed && cardView.opened.has(id) && (
        <div className="card-fold">
          <button type="button" className="nodrag" onClick={() => cardView.open(id, false)}>
            {tr('접기')}
          </button>
        </div>
      )}
    </div>
  );
}
const nodeTypes = {flat: memo(Card)};
/** A route's line colour by its row's tone (ui/graphite.css --route-*), muted under the cards. */
const routeLine = {
  pass: '#6f8f77',
  fail: '#9a6d68',
  perfect: '#b3a25a',
  starter: '#a8875a',
  partner: '#9a8bb3',
  operand: '#8ba89e',
  plain: '#777777',
} as const;
/** A coloured line when its card or itself is chosen: the same colour, lit (the row and chip colours,
 *  ui/graphite.css). A plain grey line takes the direction colours instead (10-20, user request). */
const routeLit = {
  pass: '#8fc09b',
  fail: '#eda59e',
  perfect: '#f2dc7a',
  starter: '#e0b56f',
  partner: '#b9a6d6',
  operand: '#b6d4ca',
  plain: '',
} as const;
const MIN_ZOOM = 0.08;
const edgeTypes = {connection: ConnectionEdge};
/** The canvas grid: 24 screen pixels at every zoom (Background scales its gap by the zoom). */
function ScreenGrid() {
  const zoom = useStore(s => s.transform[2]);
  return <Background variant={BackgroundVariant.Lines} gap={24 / zoom} color="#292929" lineWidth={0.7} />;
}
/** The chosen cards' ring keeps about the same screen width at any zoom (a 2px ring vanishes when zoomed out). */
function SelectionRing({target}: {target: React.RefObject<HTMLDivElement | null>}) {
  const zoom = useStore(s => s.transform[2]);
  useEffect(() => {
    target.current?.style.setProperty('--select-ring', `${Math.max(2, 2.5 / zoom).toFixed(1)}px`);
  }, [zoom, target]);
  return null;
}
/** Lines keep at least 1.5 screen pixels when zoomed out (a 1.6 line is 0.3px on the whole-graph view): every edge
 *  width and dash scales by --edge-k, so a chosen line stays thicker than the rest. */
function EdgeWidth({target}: {target: React.RefObject<HTMLDivElement | null>}) {
  const zoom = useStore(s => s.transform[2]);
  useEffect(() => {
    target.current?.style.setProperty('--edge-k', Math.max(1, 1.5 / (1.6 * zoom)).toFixed(3));
  }, [zoom, target]);
  return null;
}
const edgePx = (px: number) => `calc(${px}px * var(--edge-k, 1))`;
const NO_NODES: never[] = [];
/** The minimap opens from its corner button; closed by default so it does not cover cards (10-20). */
const MINIMAP_KEY = 'aieditor-minimap';
function storedMinimap(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) === 'open';
  } catch {
    return false;
  }
}
export type LinePick = {from: {id: string; title: string}; to: {id: string; title: string}; route: string};
/** Whether two lists hold the same objects in the same order. */
const sameItems = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);
function FlatGraphPanel({
  w,
  selected,
  select,
  edit,
  status,
  globalSettings,
  arrangeRequest = 0,
  settle,
  reveal,
  onPick,
  onLine,
}: {
  w: Workspace;
  selected: string;
  select: (id: string) => void;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  globalSettings: () => void;
  // Each new value arranges the graph by region once, applied through `settle` (no history step).
  arrangeRequest?: number;
  settle?: (fn: (w: Workspace) => Workspace) => void;
  // Each new `seq` brings the action's selected card (or the card standing for it) into view.
  reveal?: {action: string; seq: number};
  // The cards chosen together (two or more), for the details panel; empty for one card or none.
  onPick?: (cards: {id: string; title: string}[]) => void;
  // A line chosen by itself, for the details panel: where it leaves, where it arrives and its route's name.
  onLine?: (line?: LinePick) => void;
}) {
  const [selectedEdge, setSelectedEdge] = useState('');
  // Several cards chosen at once (a box, Shift/Ctrl clicks, Ctrl+A, a paste). One card is the app's `selected`.
  const [picked, setPicked] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<Rect>();
  const boxCancel = useRef<() => void>(undefined),
    boxEnded = useRef(false),
    dragging = useRef(false),
    space = useRef(false);
  const pasteSequence = useRef({clipboard: nodeClipboard, count: 0});
  const [focusAction, setFocusAction] = useState('');
  const [focusSession, setFocusSession] = useState<FocusSession>();
  const [focusChoices, setFocusChoices] = useState<string[]>([]);
  const [focusNode, setFocusNode] = useState('');
  const [focusPositions, setFocusPositions] = useState<Record<string, {x: number; y: number}>>({});
  const [fitRequest, setFitRequest] = useState(0);
  const [cardView, setCardViewState] = useState(() => storedCardView(w.id)),
    [opened, setOpened] = useState<Set<string>>(() => new Set()),
    summaryMode = cardView === 'summary';
  useEffect(() => {
    setCardViewState(storedCardView(w.id));
    setOpened(new Set());
  }, [w.id]);
  const setCardView = (v: 'summary' | 'full') => {
    setCardViewState(v);
    try {
      localStorage.setItem(cardViewKey(w.id), v);
    } catch {}
  };
  const cardViewValue = useMemo(
    () => ({
      summary: summaryMode,
      opened,
      open: (id: string, open: boolean) =>
        setOpened(s => {
          const next = new Set(s);
          if (open) next.add(id);
          else next.delete(id);
          return next;
        }),
    }),
    [summaryMode, opened]
  );
  // While arranging, every card is drawn (not only those in view) so each has a measured height.
  const [measuring, setMeasuring] = useState<{apply: (fn: (w: Workspace) => Workspace) => void; only?: string}>();
  const language = useLanguage(),
    checklist = useMemo(() => renderedChecklist(w), [w, language]),
    rawProjection = checklist.raw,
    library = renderedLibrary(w),
    fullProjection = useMemo(() => checklistProjection(w, checklist), [w, checklist]),
    retained = useMemo(() => {
      if (!focusAction || !focusSession) return undefined;
      const aliases: Record<string, string> = {};
      for (const group of w.sharedRules ?? [])
        for (const member of group.members)
          aliases[ruleNode(group.kind, member, w)] = ruleNode(group.kind, group.members[0], w);
      return retainFocus(fullProjection, focusSession, aliases);
    }, [fullProjection, focusAction, focusSession, w.sharedRules]),
    projection = retained?.graph ?? fullProjection;
  useEffect(() => {
    if (retained && retained.session !== focusSession) setFocusSession(retained.session);
  }, [retained, focusSession]);
  const [nodes, setNodes] = useState<Visual[]>([]),
    [owner, setOwner] = useState('');
  const {screenToFlowPosition, fitView, getZoom, setCenter, getNodes} = useReactFlow();
  const presentations = useMemo(
    () => new Map(fullProjection.nodes.map(n => [n.id, presentCard(w, n)])),
    [fullProjection, w]
  );
  // A node or edge equal to its previous version stays that object: React Flow then skips it (the
  // projection is rebuilt whole for every document change).
  const previousData = useRef(new Map<string, Visual['data']>());
  const visualData = useMemo(() => {
    const next = new Map<string, Visual['data']>();
    // A route row names its destination: an action's HKX card by the action's name, any other card by its title.
    const byId = new Map(projection.nodes.map(n => [n.id, n])),
      names = new Map(w.actions.map(a => [a.uid, a.config.name || a.config.actionId])),
      routed = new Map<string, Record<string, string>>(),
      qteRouted = new Map<string, string[]>();
    const onward = new Map<string, string>();
    for (const e of projection.edges) if (!onward.has(e.source)) onward.set(e.source, e.target);
    for (const e of projection.edges) {
      // A transition's blend sits on its line: the row names the action the line reaches through it.
      let t = byId.get(e.target);
      for (let hop = 0; t?.kind === 'blend' && hop < 4; hop++) t = byId.get(onward.get(t.id) ?? '') ?? t;
      if (!t) continue;
      const label = (t.kind === 'hkxPlay' && t.action && names.get(t.action)) || t.title;
      routed.set(e.source, {...routed.get(e.source), [e.pin]: label});
      if (byId.get(e.source)?.kind === 'qte') {
        const list = (qteRouted.get(e.source + '|' + e.pin) ?? []).concat(e.via ? '⚡ ' + e.via : '→ ' + label);
        qteRouted.set(e.source + '|' + e.pin, [...new Set(list)]);
      }
    }
    // A QTE's result row says how it goes on: → the HKX it plays, ⚡ the event it sends (and how many more).
    for (const [key, list] of qteRouted) {
      const [source, pin] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
      routed.set(source, {
        ...routed.get(source),
        [pin]: list[0] + (list.length > 1 ? tr(' 외 {v0}', {v0: list.length - 1}) : ''),
      });
    }
    for (const n of projection.nodes) {
      const pins = routePins(n),
        routeTo = pins.length ? Object.fromEntries(pins.map(p => [p, routed.get(n.id)?.[p] ?? ''])) : undefined;
      // How the action starts reads every line into its card, not only the ones a flow view shows.
      const start = n.kind === 'hkxPlay' ? startRow(w, n, fullProjection) : undefined;
      const fresh = {
          ...n,
          presentation: presentations.get(n.id)!,
          ...(routeTo ? {routeTo} : {}),
          ...(start ? {start} : {}),
        },
        old = previousData.current.get(n.id);
      next.set(n.id, old ? shareUnchanged(old, fresh) : fresh);
    }
    previousData.current = next;
    return next;
  }, [projection, fullProjection, presentations, w]);
  const region = useRef<HTMLDivElement>(null),
    cancelled = useRef(false),
    right = useRef({x: 0, y: 0});
  const [minimapOpen, setMinimapOpen] = useState(storedMinimap);
  const toggleMinimap = () =>
    setMinimapOpen(open => {
      try {
        localStorage.setItem(MINIMAP_KEY, open ? 'closed' : 'open');
      } catch {}
      return !open;
    });
  const visibleSelected =
    checklist.owners.get(selected)?.find(id => projection.nodes.some(n => n.id === id)) ?? selected;
  const selectedNode = projection.nodes.find(n => n.id === visibleSelected);
  // Summary view: the chosen HKX card and the ones opened by hand are drawn in full.
  const openCards = useMemo(() => {
    const s = new Set(opened);
    // A chosen condition card opens its editor too (ChecklistBody fold): it floats like an open HKX card.
    if (selectedNode && ['hkxPlay', 'conditionBranch', 'conditionTable'].includes(selectedNode.kind))
      s.add(selectedNode.id);
    return s;
  }, [opened, selectedNode?.id, selectedNode?.kind]);
  const collapsedData = useRef(new WeakMap<Visual['data'], Visual['data']>());
  const actionId = selectedNode?.action || owner || w.actions[0]?.uid || '';
  const action = w.actions.find(a => a.uid === actionId);
  const box = (n: Visual) => ({
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? cardWidth(n.data),
    h: n.measured?.height ?? cardHeight(n.data),
  });
  const fitNeighbors = (id: string) => {
    const ids = new Set(neighbors(projection, id)),
      pane = region.current?.getBoundingClientRect();
    const around = (getNodes() as Visual[]).filter(n => ids.has(n.id)),
      self = around.find(n => n.id === id);
    // A crowded neighbourhood (a pair with many transitions) does not fit even at the smallest zoom: fitting
    // it would centre the whole and leave the selected card out of view, so the card's title area is shown.
    if (self && pane && !fitsAt(around.map(box), {w: pane.width, h: pane.height}, 0.22, MIN_ZOOM)) {
      const b = box(self);
      void setCenter(b.x + b.w / 2, b.y + Math.min(b.h / 2, 300), {zoom: 0.5, duration: 200});
      return;
    }
    void fitView({nodes: [...ids].map(id => ({id})), padding: 0.22, maxZoom: 1, duration: 200});
  };
  const openFlow = (action: string, id: string) => {
    if (focusAction === action && focusNode === id) return;
    setFocusChoices([]);
    setFocusAction(action);
    setFocusNode(id);
    setFocusSession(beginFocus(fullProjection, action, id, {summary: summaryMode, hidden: merges.hidden}));
    setFocusPositions({});
    setFitRequest(v => v + 1);
    // Laid out again once its cards are drawn and measured: the chosen HKX card is drawn in full.
    arrange();
  };
  const focusFlow = (id: string) => {
    const selected = fullProjection.nodes.find(n => n.id === id);
    const shared = w.sharedRules?.find(g => g.members.some(m => ruleNode(g.kind, m, w) === id));
    const owners = [
      ...new Set(
        shared
          ? shared.members
              .map(m => rawProjection.nodes.find(n => n.id === ruleNode(shared.kind, m, w))?.action)
              .filter((x): x is string => !!x)
          : selected?.action
            ? [selected.action]
            : []
      ),
    ];
    if (!owners.length) {
      for (const edge of fullProjection.edges.filter(e => e.target === id || e.source === id)) {
        const other = fullProjection.nodes.find(n => n.id === (edge.target === id ? edge.source : edge.target));
        if (other?.action && !owners.includes(other.action)) owners.push(other.action);
      }
    }
    if (owners.length > 1) {
      if (focusAction && owners.includes(focusAction)) return;
      setFocusChoices(owners);
      return;
    }
    if (owners[0]) openFlow(owners[0], id);
    else status(tr('연결된 동작이 없습니다.'));
  };
  const arrange = (apply = edit, only?: string) => setMeasuring({apply, only});
  const runArrange =
    useRef<(request: {apply: (fn: (w: Workspace) => Workspace) => void; only?: string}) => void>(undefined);
  runArrange.current = ({apply, only}) => {
    // Every card was drawn for this pass; a height still missing (a card that never drew in time) is estimated.
    const measured = new Map(getNodes().map(n => [n.id, n.measured?.height ? n.measured : undefined]));
    const sized = {
      ...projection,
      nodes: projection.nodes.map(n => ({
        ...n,
        measured: measured.get(n.id) ?? {
          height:
            n.kind === 'hkxPlay'
              ? 350 + (checklist.items.get(n.id)?.length ?? 0) * 42
              : n.kind === 'conditionBranch'
                ? 420
                : n.kind === 'conditionTable'
                  ? 150 + (w.actions.find(a => a.uid === n.action)?.flow?.tests.length ?? 0) * 40
                  : cardHeight(n),
        },
      })),
    };
    const pane = region.current?.getBoundingClientRect();
    const {positions, blocks} = arrangeLayout(sized, {
      view: pane && pane.width > 100 && pane.height > 100 ? {w: pane.width, h: pane.height} : undefined,
      summary: summaryMode,
      hidden: merges.hidden,
    });
    let moved = positions;
    if (only) {
      // The chosen card's block keeps its place: it is laid out again from its current top-left corner.
      const block = blocks.find(b => b.includes(only));
      if (!block) return;
      const at = (id: string) =>
        focusAction
          ? (focusPositions[id] ?? projection.nodes.find(n => n.id === id)!.position)
          : projection.nodes.find(n => n.id === id)!.position;
      const dx = Math.min(...block.map(id => at(id).x)) - Math.min(...block.map(id => positions[id].x)),
        dy = Math.min(...block.map(id => at(id).y)) - Math.min(...block.map(id => positions[id].y));
      moved = Object.fromEntries(block.map(id => [id, {x: positions[id].x + dx, y: positions[id].y + dy}]));
    }
    if (focusAction) setFocusPositions(p => (only ? {...p, ...moved} : moved));
    else apply(w => moveNodes(w, {kind: 'root'}, moved));
    if (!only) setFitRequest(v => v + 1);
  };
  useEffect(() => {
    if (!measuring) return;
    // Timers, not animation frames: a window that is not drawn (hidden, behind another) runs no frames, and
    // an arrange asked for then (an import) still runs, with the heights measured by then.
    // A card keeps the height it was last measured at until it is drawn again (a summary opened since, a
    // card out of view), so the pass waits for every height to settle, not only for every card to have one.
    const start = performance.now();
    let last = '',
      stable = 0,
      timer = 0;
    const tick = () => {
      const all = getNodes(),
        heights = all.map(n => n.measured?.height ?? 0),
        signature = heights.join(',');
      stable = signature === last ? stable + 1 : 0;
      last = signature;
      const elapsed = performance.now() - start;
      if ((heights.every(h => h > 0) && stable >= 3 && elapsed > 150) || elapsed > 2000) {
        runArrange.current!(measuring);
        setMeasuring(undefined);
        return;
      }
      timer = window.setTimeout(tick, 16);
    };
    timer = window.setTimeout(tick, 16);
    return () => clearTimeout(timer);
  }, [measuring, getNodes]);
  // An import is arranged once its nodes reach the flow and the drawn ones are measured (the
  // measured count holds for a few frames), as if the button were pressed then; at most ~1 s.
  // `settle` uses the request up, so it runs once.
  const arrangeLater = useRef(arrange);
  arrangeLater.current = arrange;
  useEffect(() => {
    if (!arrangeRequest || !settle) return;
    let frame = 0,
      last = -1,
      steady = 0,
      handle = 0;
    const ids = projection.nodes.map(n => n.id);
    const tick = () => {
      const nodes = getNodes(),
        present = new Set(nodes.map(n => n.id)),
        count = nodes.filter(n => n.measured?.height).length;
      steady = count > 0 && count === last && ids.every(id => present.has(id)) ? steady + 1 : 0;
      last = count;
      if (steady < 3 && ++frame < 60) {
        handle = requestAnimationFrame(tick);
        return;
      }
      arrangeLater.current(settle);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [arrangeRequest, projection, settle, getNodes]);
  useEffect(() => {
    setFocusAction('');
    setFocusSession(undefined);
  }, [w.id]);
  useEffect(() => {
    if (focusAction && !w.actions.some(a => a.uid === focusAction)) {
      setFocusAction('');
      setFocusSession(undefined);
      setFitRequest(v => v + 1);
    }
  }, [w.actions, focusAction]);
  useEffect(() => {
    if (!fitRequest) return;
    const timer = setTimeout(() => void fitView({padding: 0.15, maxZoom: 0.9, duration: 200}), 100);
    return () => clearTimeout(timer);
  }, [fitRequest, fitView]);

  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      status(String(e));
    }
  };
  const chosen = () => (picked.length ? picked : visibleSelected ? [visibleSelected] : []);
  const choose = (ids: string[]) => {
    setPicked(ids.length > 1 ? ids : []);
    select(ids.length === 1 ? ids[0] : '');
  };
  // A box from an empty spot picks every card it touches (Shift adds, Ctrl toggles); Esc puts the old pick back.
  const startBox = (e: React.PointerEvent) => {
    const mode = boxMode(e),
      base = chosen(),
      origin = {x: e.clientX, y: e.clientY},
      cards = (getNodes() as Visual[]).map(n => ({id: n.id, rect: box(n)}));
    let moved = false,
      latest = base;
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      boxCancel.current = undefined;
      setMarquee(undefined);
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) <= 5) return;
      if (!moved) {
        select('');
        setSelectedEdge('');
      }
      moved = true;
      const pane = region.current?.getBoundingClientRect();
      if (pane)
        setMarquee(
          spanned(
            {x: origin.x - pane.left, y: origin.y - pane.top},
            {x: ev.clientX - pane.left, y: ev.clientY - pane.top}
          )
        );
      const area = spanned(screenToFlowPosition(origin), screenToFlowPosition({x: ev.clientX, y: ev.clientY}));
      latest = boxSelection(
        base,
        cards.filter(c => touches(area, c.rect)).map(c => c.id),
        mode
      );
      setPicked(latest);
    };
    const end = () => {
      stop();
      if (!moved) return;
      // The pane's click follows this release; it must not clear what the box picked.
      boxEnded.current = true;
      setTimeout(() => (boxEnded.current = false));
      choose(latest);
    };
    boxCancel.current = () => {
      stop();
      if (moved) choose(base);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  // A project with nothing in it shows the first steps (canvas-guide) instead of an empty event registry.
  // "이벤트 등록 카드 보기" shows the registry for a project that starts with its events (kept per document).
  const [registryShown, setRegistryShown] = useState('');
  const bare = !w.actions.length && !w.eventRegistry?.length && !w.drafts?.length && registryShown !== w.id;
  // A new HKX card goes where nothing is (a fresh project shows the event registry in the middle).
  const addPlay = () => {
    const r = addFlat(w, '', 'playNode', freePlayPosition(screenToFlowPosition));
    edit(() => r.workspace);
    select(r.id ?? '');
  };
  const removeChosen = () =>
    attempt(() => {
      const ids = chosen().filter(id => id !== 'entry');
      if (!ids.length) return;
      let next = w,
        removed = 0,
        kept = 0;
      for (const id of ids) {
        // Deleting a card can take others with it (an action's own items): those are already gone.
        if (!checklistProjection(next).nodes.some(n => n.id === id)) continue;
        try {
          next = deleteChecklistNode(next, id);
          removed++;
        } catch {
          kept++;
        }
      }
      edit(() => next);
      choose([]);
      status(
        tr('카드 {removed}개를 삭제했습니다.{v1} Ctrl+Z로 되돌릴 수 있습니다.', {
          removed,
          v1: kept ? tr(' {kept}개는 지울 수 없어 남겼습니다.', {kept}) : '',
        })
      );
    });
  const alignChosenLeft = () =>
    attempt(() => {
      const cards = (getNodes() as Visual[]).filter(n => chosen().includes(n.id));
      if (cards.length < 2) return;
      const left = Math.min(...cards.map(n => n.position.x)),
        positions = Object.fromEntries(cards.map(n => [n.id, {x: left, y: n.position.y}]));
      if (focusAction) setFocusPositions(p => ({...p, ...positions}));
      else edit(w => moveNodes(w, {kind: 'root'}, positions));
    });
  // The flow's nodes follow the projection during this render (no effect: an effect renders every card a
  // second time). A node whose data, position and selection are unchanged stays the same object, and a
  // rebuilt one keeps React Flow's measured size: without it the flow drops the edges and minimap nodes
  // of an unmeasured node and measures it again, rendering every card twice more.
  // A line chosen by itself (docs/mockup-edge-highlight/line-select B): its cards are marked "출발"/"도착".
  const lineEnds = useMemo(() => {
    const e = selectedEdge ? projection.edges.find(x => x.id === selectedEdge) : undefined;
    return e ? {from: e.source, to: e.target} : undefined;
  }, [selectedEdge, projection]);
  const nodeInputs = useMemo(
    () => ({
      projection,
      visibleSelected,
      focusAction,
      focusPositions,
      visualData,
      picked,
      summaryMode,
      openCards,
      lineEnds,
    }),
    [projection, visibleSelected, focusAction, focusPositions, visualData, picked, summaryMode, openCards, lineEnds]
  );
  const [synced, setSynced] = useState<typeof nodeInputs>();
  if (synced !== nodeInputs) {
    setSynced(nodeInputs);
    setNodes(current => {
      const old = new Map(current.map(n => [n.id, n]));
      const next: Visual[] = projection.nodes.map(n => {
        const prev = old.get(n.id),
          base = visualData.get(n.id)!,
          position = focusAction ? (focusPositions[n.id] ?? n.position) : n.position,
          selected = n.id === visibleSelected || picked.includes(n.id),
          className = !lineEnds
            ? undefined
            : n.id === lineEnds.from
              ? 'line-from'
              : n.id === lineEnds.to
                ? 'line-to'
                : 'line-dim',
          summary = summaryMode && n.kind === 'hkxPlay',
          zIndex = summaryMode && openCards.has(n.id) ? 10 : undefined;
        let data = base;
        if (summary && !openCards.has(n.id)) {
          data = collapsedData.current.get(base) ?? {...base, collapsed: true};
          collapsedData.current.set(base, data);
        }
        if (
          prev &&
          prev.data === data &&
          prev.selected === selected &&
          prev.zIndex === zIndex &&
          prev.className === className &&
          prev.position.x === position.x &&
          prev.position.y === position.y
        )
          return prev;
        return {
          ...(prev?.measured ? {measured: prev.measured} : {}),
          id: n.id,
          type: 'flat',
          dragHandle: '.checklist-drag-handle',
          data,
          position,
          selected,
          zIndex,
          className,
        };
      });
      // The same nodes keep the same array: React Flow compares it by identity and otherwise updates every
      // node of the store and everything subscribed to it.
      return sameItems(current, next) ? current : next;
    });
  }
  useEffect(() => {
    const id = setTimeout(async () => {
      await fitView({padding: 0.12, maxZoom: 1});
      const first = projection.nodes.find(n => n.kind === 'hkxPlay');
      if (first && getZoom() < 0.55) void setCenter(first.position.x + 130, first.position.y + 80, {zoom: 0.75});
    }, 100);
    return () => clearTimeout(id);
  }, [w.id, fitView]);
  // An action chosen in a side panel: centre the card shown for the selection (an item's card, the HKX
  // card, or a selecting action's decision card) at a readable zoom. Another action's single-flow view
  // does not hold it, so that view closes first.
  const revealNow = useRef((_action: string) => {});
  revealNow.current = (action: string) => {
    if (focusAction && focusAction !== action) {
      setFocusAction('');
      setFocusSession(undefined);
      setTimeout(() => revealNow.current(action), 120);
      return;
    }
    const shown = new Set(projection.nodes.map(n => n.id)),
      id = shown.has(visibleSelected) ? visibleSelected : projection.nodes.find(n => n.action === action)?.id,
      card = (getNodes() as Visual[]).find(n => n.id === id),
      pane = region.current?.getBoundingClientRect();
    if (!card || !pane) return;
    // A card out of view has not been drawn, so its height is a guess (only its width is fixed): it is
    // centred only when its measured height fits; otherwise its title area sits near the top.
    const b = box(card),
      zoom = Math.max(MIN_ZOOM, Math.min(1, (pane.width * 0.7) / b.w)),
      fits = card.measured?.height !== undefined && b.h * zoom <= pane.height * 0.85,
      y = fits ? b.y + b.h / 2 : b.y + (pane.height / 2 - 32) / zoom;
    void setCenter(b.x + b.w / 2, y, {zoom, duration: 250});
  };
  useEffect(() => {
    // After the selection it carries has reached this render.
    if (reveal?.seq) setTimeout(() => revealNow.current(reveal.action), 0);
  }, [reveal?.seq]);
  // An HKX card's event row or link asks for the registry node (showRegistry): select it and bring it
  // into view, leaving a single-flow view that hides it.
  const revealRegistry = useRef(() => {});
  revealRegistry.current = () => {
    select(REGISTRY_NODE);
    if (focusAction) {
      setFocusAction('');
      setFocusSession(undefined);
    }
    setTimeout(() => void fitView({nodes: [{id: REGISTRY_NODE}], padding: 0.08, maxZoom: 1, duration: 200}), 120);
  };
  useEffect(() => {
    const listener = () => revealRegistry.current();
    window.addEventListener('ai-registry-flash', listener);
    return () => window.removeEventListener('ai-registry-flash', listener);
  }, []);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (boxCancel.current) return boxCancel.current();
      if (dragging.current) {
        cancelled.current = true;
        setNodes(ns =>
          ns.map(n => ({...n, position: projection.nodes.find(p => p.id === n.id)?.position ?? n.position}))
        );
        return;
      }
      const target = e.target as HTMLElement;
      if (
        !e.defaultPrevented &&
        !target.closest?.('input,textarea,select,[contenteditable=true],[role=dialog]') &&
        (target === document.body || region.current?.contains(target))
      )
        clearRef.current();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [projection]);
  const clearRef = useRef(() => {});
  clearRef.current = () => {
    if (picked.length || visibleSelected) choose([]);
    if (selectedEdge) setSelectedEdge('');
  };
  // Space + left drag moves the view (React Flow's pan key); the box must not start meanwhile.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable=true]'))
        space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  // The details panel lists the chosen cards (named as their cards are) and sends its buttons back here.
  useEffect(() => {
    onPick?.(
      picked.length > 1
        ? picked.map(id => {
            const n = projection.nodes.find(x => x.id === id);
            return {id, title: !n ? id : n.kind === 'hkxPlay' ? `${t('node.hkxPlay')} · ${n.title}` : n.title};
          })
        : []
    );
  }, [picked, projection]);
  useEffect(() => () => onPick?.([]), []);
  useEffect(() => {
    const e = selectedEdge ? projection.edges.find(x => x.id === selectedEdge) : undefined,
      source = e && projection.nodes.find(n => n.id === e.source);
    const title = (id: string) => visualData.get(id)?.presentation.title ?? id;
    onLine?.(
      e && source
        ? {
            from: {id: e.source, title: title(e.source)},
            to: {id: e.target, title: title(e.target)},
            route: routePins(source).includes(e.pin) ? portLabel(source, e.pin) : '',
          }
        : undefined
    );
  }, [selectedEdge, projection, visualData]);
  useEffect(() => () => onLine?.(undefined), []);
  // "이 카드로 이동" from the line summary: the card becomes the choice and comes into view at this zoom.
  const goCard = (id: string) => {
    setSelectedEdge('');
    setPicked([]);
    select(id);
    const card = (getNodes() as Visual[]).find(n => n.id === id);
    if (!card) return;
    const b = box(card);
    void setCenter(b.x + b.w / 2, b.y + Math.min(b.h / 2, 200), {zoom: getZoom(), duration: 200});
  };
  const commandRef = useRef((_: string) => {});
  commandRef.current = command => {
    if (command === 'copy') copySelection();
    else if (command === 'delete') removeChosen();
    else if (command === 'alignLeft') alignChosenLeft();
    else if (command === 'clear') choose([]);
    else if (command === 'cutLine' && selectedEdge) removeEdge(selectedEdge);
    else if (command.startsWith('go:')) goCard(command.slice(3));
  };
  useEffect(() => {
    const listener = (e: Event) => commandRef.current(String((e as CustomEvent).detail));
    window.addEventListener(SELECTION_COMMAND, listener);
    return () => window.removeEventListener(SELECTION_COMMAND, listener);
  }, []);
  const previousEdges = useRef(new Map<string, object>()),
    previousEdgeList = useRef<object[]>([]);
  // A QTE event line that stands for its action's wait (qteListen.ts): the wait is not drawn, the line is solid.
  const annotations = useClipAnnotations(w);
  const merges = useMemo(() => {
    const nodes = new Map(fullProjection.nodes.map(n => [n.id, n]));
    const sendsItself = (action: string, event: string) => {
      const a = w.actions.find(a => a.uid === action);
      return !!a?.config.steps.some(s =>
        (annotations.get(clipKey(s.clip)) ?? []).some(n => sentEvent(n.text, !!a.pair)?.name === event)
      );
    };
    return listenMerges(fullProjection.edges, nodes, sendsItself);
  }, [fullProjection, annotations, w.actions]);
  const edges = useMemo(() => {
    const sources = new Map(projection.nodes.map(n => [n.id, n]));
    // The chosen cards' lines by direction (10-18, docs/mockup-edge-highlight B): a plain line leaving a chosen
    // card is sky blue (where it hands over), one coming in is pink (what starts it); the rest step back. A line
    // that already has a colour (a route, a role) keeps it, lit and thicker (10-20). A line chosen by itself
    // glows in its colour (sky blue when plain), and the rest step back the same way.
    const chosenCards = new Set(picked.length ? picked : visibleSelected ? [visibleSelected] : []);
    const fresh = projection.edges
      .filter(e => !merges.hidden.has(e.id))
      .map(e => {
        const out = chosenCards.has(e.source),
          hit = out || chosenCards.has(e.target),
          chosenLine = e.id === selectedEdge;
        // A route keeps its row's colour, muted (routeTone); a victim's line stays violet everywhere,
        // and a pair QTE's transition draws the attacker's line in the starter's colour.
        const tone: keyof typeof routeLine = e.id.startsWith('operand:')
          ? 'operand'
          : e.pin === 'partner' || (sources.get(e.source)?.kind === 'qte' && e.pin.endsWith(':partner'))
            ? 'partner'
            : visualData
                  .get(e.source)
                  ?.presentation.qte?.results?.some(
                    r =>
                      r.pair &&
                      r.mode === 'transition' &&
                      e.pin === (r.k === 'success' ? 'pass' : r.k === 'failure' ? 'fail' : 'perfect')
                  )
              ? 'starter'
              : sources.get(e.source)
                ? routeTone(sources.get(e.source)!, e.pin)
                : 'plain';
        const lit = routeLit[tone] || (chosenLine || out ? '#8fd3ff' : '#f08fc8');
        return {
          ...e,
          type: 'connection',
          selected: e.id === selectedEdge,
          interactionWidth: 24,
          sourceHandle: e.pin,
          targetHandle: e.targetPin ?? e.pin,
          label: e.id.startsWith('operand:') ? tr('구성 조건') : undefined,
          zIndex: hit || chosenLine ? 10 : 0,
          style: {
            stroke: chosenLine || hit ? lit : routeLine[tone],
            strokeWidth: edgePx(chosenLine ? 3.2 : hit ? 2.8 : 1.6),
            opacity: (!chosenCards.size && !selectedEdge) || hit || chosenLine ? 1 : 0.3,
            filter: chosenLine ? `drop-shadow(0 0 4px ${lit}cc)` : undefined,
            strokeDasharray: e.id.startsWith('operand:')
              ? `${edgePx(6)} ${edgePx(4)}`
              : e.via && !merges.merged.has(e.id)
                ? `${edgePx(7)} ${edgePx(5)}`
                : undefined,
          },
        };
      });
    const next = new Map<string, object>();
    const shared = fresh.map(e => {
      const old = previousEdges.current.get(e.id) as typeof e | undefined,
        edge = old ? shareUnchanged(old, e) : e;
      next.set(e.id, edge);
      return edge;
    });
    previousEdges.current = next;
    // Unchanged edges keep the same array (React Flow rebuilds its connection lookup for a new one).
    if (sameItems(previousEdgeList.current, shared)) return previousEdgeList.current as typeof shared;
    previousEdgeList.current = shared;
    return shared;
  }, [projection, visibleSelected, picked, selectedEdge, merges, visualData]);
  const removeEdge = (id: string) =>
    attempt(() => {
      const edge = projection.edges.find(e => e.id === id);
      if (!edge) return;
      // A line that stands for its action's wait: the result goes on and the wait goes with it.
      const waits = merges.merged.get(edge.id);
      if (edge.via && waits) {
        const actionOf = (id: string) => projection.nodes.find(n => n.id === id)?.action;
        edit(w => cutQteListen(w, edge, waits, actionOf));
        setSelectedEdge('');
        select('');
        status(
          tr("QTE 결과를 '계속'으로 바꾸고 그 동작의 {via} 대기를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.", {
            via: edge.via,
          })
        );
        return;
      }
      // Any other line through an event is drawn from the QTE result's setting; it is changed there, not cut here.
      if (edge.via)
        throw Error(
          tr("이벤트({via})로 이어진 선입니다. QTE 결과 설정에서 이벤트를 바꾸거나 '계속'으로 바꾸세요.", {
            via: edge.via,
          })
        );
      edit(w => executeGraphCommand(w, {type: 'disconnect', edge}).workspace);
      setSelectedEdge('');
      select('');
      status(
        parseNodeId(edge.source).kind === 'branch' && (edge.pin === 'pass' || edge.pin === 'fail')
          ? tr('조건 경로를 비웠습니다. Ctrl+Z로 되돌릴 수 있습니다.')
          : tr('연결선만 해제했습니다. 카드 설정은 유지됩니다. Ctrl+Z로 되돌릴 수 있습니다.')
      );
    });
  const kinds = ['conditionBranch', 'keyInput', 'markerReceive', 'qte', 'playNode'];
  const copySelection = (clicked?: string) =>
    attempt(() => {
      const ids = getNodes()
        .filter(n => n.selected)
        .map(n => n.id);
      setNodeClipboard(
        copyChecklistNodes(w, clicked && !ids.includes(clicked) ? [clicked] : ids.length ? ids : [selected])
      );
      status(tr('카드를 복사했습니다. Ctrl+V로 붙여넣으세요.'));
    });
  const pasteSelection = (point?: {x: number; y: number}) =>
    attempt(() => {
      if (!nodeClipboard) throw Error(tr('복사한 카드가 없습니다.'));
      if (pasteSequence.current.clipboard !== nodeClipboard)
        pasteSequence.current = {clipboard: nodeClipboard, count: 0};
      const r = pasteNodes(
        w,
        nodeClipboard,
        visiblePastePosition(screenToFlowPosition, point, 24 * (pasteSequence.current.count % 6)),
        actionId
      );
      pasteSequence.current.count++;
      edit(() => r.workspace);
      setPicked(r.ids);
      select(r.ids[0] ?? '');
      const unassigned = checklistModel(r.workspace).unassigned.length - checklist.unassigned.length;
      status(
        unassigned > 0
          ? tr("붙여넣었습니다. 공통 설정 {unassigned}개는 '미배정 설정'에서 적용할 HKX를 선택하세요.", {unassigned})
          : tr('카드와 내부 설정을 붙여넣었습니다.')
      );
    });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        !(e.ctrlKey || e.metaKey) ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true],[role=dialog]')
      )
        return;
      if (!region.current?.contains(e.target as globalThis.Node)) return;
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copySelection();
      }
      if (e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteSelection();
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        choose(projection.nodes.map(n => n.id).filter(id => id !== 'entry'));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const {context, menu} = useEditorMenu((target, x, y) => {
    const edgeId = target.closest('.react-flow__edge')?.getAttribute('data-id');
    if (edgeId) {
      setSelectedEdge(edgeId);
      select('');
      return [{label: tr('연결선 삭제'), run: () => removeEdge(edgeId)}];
    }
    const id = target.closest('.react-flow__node')?.getAttribute('data-id') || '';
    if (id) {
      setSelectedEdge('');
      select(id);
    }
    const sharedRule = w.sharedRules?.find(g => g.members.some(m => ruleNode(g.kind, m, w) === id));
    const a = projection.nodes.find(n => n.id === id)?.action || actionId,
      branch = parseNodeId(id);
    const add = (kind: string) =>
      attempt(() => {
        const position = visibleNodePosition(screenToFlowPosition, {x, y});
        const r = executeGraphCommand(w, {type: 'add', owner: a, kind, position});
        edit(() => r.workspace);
        select(r.id ?? '');
      });
    return [
      ...(id ? [{label: tr('카드 복사'), disabled: id === 'entry', run: () => copySelection(id)}] : []),
      {label: tr('카드 붙여넣기'), disabled: !nodeClipboard, run: () => pasteSelection({x, y})},
      ...(id
        ? [
            {label: tr('선택 카드 주변 맞춤'), run: () => fitNeighbors(id)},
            {
              label: tr('이 동작 흐름만 보기'),
              disabled: !projection.nodes.find(n => n.id === id)?.action,
              run: () => focusFlow(id),
            },
          ]
        : []),
      // A condition's routes: emptied here, changed by a drag or a list (▾), shared only when chosen.
      ...(branch.kind === 'branch'
        ? [
            ...(['pass', 'fail'] as const).flatMap(port =>
              w.actions.find(a => a.uid === branch.owner)?.flow?.tests.find(t => t.id === branch.test)?.[port]
                ? [
                    {
                      label: (port === 'pass' ? tr('통과') : tr('실패')) + tr(' 경로 비우기'),
                      run: () => attempt(() => edit(w => setBranchTarget(w, branch.owner, branch.test, port))),
                    },
                  ]
                : []
            ),
            {label: tr('이 조건을 다른 동작에도 공유…'), run: () => openPinMenu(id + '|share')},
          ]
        : []),
      ...(id
        ? contextualAdds(w, id, rawProjection).map(option => ({
            label: option.label,
            run: () =>
              attempt(() => {
                const position = visibleNodePosition(screenToFlowPosition, {x: x + 24, y: y + 24});
                const r = executeGraphCommand(w, {type: 'addConnected', source: id, option, position});
                edit(() => r.workspace);
                select(r.id ?? '');
              }),
          }))
        : kinds.map(kind => ({
            label:
              kind === 'conditionBranch'
                ? tr('조건 분기 추가')
                : (kind === 'blend' ? t('row.blend') : kind === 'playNode' ? t('node.hkxPlay') : t('node.' + kind)) +
                  tr(' 추가'),
            run: () => add(kind),
            disabled: false,
          }))),
      {
        label: id.startsWith('conditionTable:')
          ? tr('조건 분기 펼치기')
          : sharedRule
            ? tr('이 동작에서만 제거')
            : t('menu.edit.delete'),
        disabled: !id || id === 'entry',
        run: () =>
          attempt(() => {
            edit(w => deleteChecklistNode(w, id));
            select('');
          }),
      },
      ...(sharedRule
        ? [
            {
              label: tr('공유 규칙 전체 제거'),
              run: () =>
                attempt(() => {
                  edit(w => {
                    let next = w;
                    for (const member of sharedRule.members)
                      next = deleteFlat(next, ruleNode(sharedRule.kind, member, next));
                    return next;
                  });
                  select('');
                }),
            },
          ]
        : []),
      {
        label: t('graph.comment'),
        run: () => {
          const r = addComment(w, {kind: 'root'}, screenToFlowPosition({x, y}));
          edit(() => r.workspace);
          select(r.id ?? '');
        },
      },
      {label: t('menu.view.fit'), run: () => void fitView({padding: 0.15})},
    ];
  }, status);
  // One context object with the latest values: the cards read it when they draw, and CardGate decides when.
  const cardContext = useRef({} as NonNullable<React.ContextType<typeof ChecklistContext>>).current;
  Object.assign(cardContext, {w, model: checklist, library, edit, status, select, selected, globalSettings});
  const gateRef = useRef(gateState()),
    registry = renderedRegistry(w);
  const documentGate = useMemo(
    () => advanceGate(gateRef.current, w, [language, registry, library]),
    [w, language, registry, library]
  );
  const cardGate = useMemo(
    () => ({...documentGate, w, model: checklist, library, selected}),
    [documentGate, w, checklist, library, selected]
  );
  return (
    <ChecklistContext.Provider value={cardContext}>
      <CardGate.Provider value={cardGate}>
        <CardView.Provider value={cardViewValue}>
          <div className="graph-workspace">
            <div className="flat-toolbar">
              <b>{tr('통합 그래프')}</b>
              {selectedEdge && (
                <button
                  onClick={() => removeEdge(selectedEdge)}
                  title={tr('양쪽 카드를 유지하고 이 연결만 해제합니다.')}
                >
                  {tr('연결선 삭제')}
                </button>
              )}
              <button
                disabled={!selectedNode}
                onClick={() => fitNeighbors(visibleSelected)}
                title={tr('선택 카드와 직접 연결된 카드들을 화면에 맞춥니다.')}
              >
                <Icon name="fit" />
                {tr('주변 맞춤')}
              </button>
              <button
                disabled={!focusAction && !selectedNode?.action}
                aria-pressed={!!focusAction}
                onClick={() => {
                  if (focusAction) {
                    setFocusAction('');
                    setFitRequest(v => v + 1);
                  } else focusFlow(visibleSelected);
                }}
                title={tr(
                  '선택한 HKX의 진입·적용 기능·종료 경로만 자동 정렬합니다. 다른 HKX와 전체 그래프 배치는 유지됩니다.'
                )}
              >
                {focusAction ? tr('전체 흐름 보기') : tr('이 동작 흐름만')}
              </button>
              <ArrangeMenu
                all={() => arrange()}
                chosen={selectedNode ? () => arrange(edit, visibleSelected) : undefined}
                summary={summaryMode}
                setSummary={v => setCardView(v ? 'summary' : 'full')}
              />
              {focusAction && (
                <button
                  onClick={() => {
                    setFocusSession(beginFocus(fullProjection, focusAction, focusNode, {hidden: merges.hidden}));
                    setFocusPositions({});
                    setFitRequest(v => v + 1);
                  }}
                  title={tr('연결된 카드만 다시 표시합니다. 분리된 카드는 프로젝트에 남습니다.')}
                >
                  {tr('연결된 흐름으로 새로고침')}
                </button>
              )}
              {focusChoices.length > 0 && (
                <select
                  aria-label={tr('흐름 동작 선택')}
                  defaultValue=""
                  onChange={e => openFlow(e.target.value, selected)}
                >
                  <option value="">{tr('볼 동작 선택…')}</option>
                  {focusChoices.map(id => (
                    <option key={id} value={id}>
                      {w.actions.find(a => a.uid === id)?.config.name}
                    </option>
                  ))}
                </select>
              )}
              {focusAction && (
                <span>
                  {tr('흐름:')} {w.actions.find(a => a.uid === focusAction)?.config.name}
                </span>
              )}
              <span>
                {bare ? 0 : projection.nodes.length} {tr('카드')}
              </span>
              <UnassignedSettings />
              <HelpTip
                label={tr('그래프 편집')}
                help={tr(
                  'HKX를 놓고 입력으로 연결하세요. 재생 카드끼리 연결하면 전환이 됩니다. 빈 곳을 우클릭하면 카드를 추가할 수 있습니다.'
                )}
              >
                <button onClick={addPlay}>{tr('＋ HKX 재생')}</button>
              </HelpTip>
            </div>
            <div
              ref={region}
              tabIndex={-1}
              className="p3-canvas"
              data-testid="graph-surface"
              data-graph-kind="flat"
              onKeyDownCapture={e => {
                if (
                  picked.length > 1 &&
                  ['Delete', 'Backspace'].includes(e.key) &&
                  !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  removeChosen();
                  return;
                }
                if (
                  selectedEdge &&
                  ['Delete', 'Backspace'].includes(e.key) &&
                  !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  removeEdge(selectedEdge);
                }
              }}
              onPointerDownCapture={e => {
                if (e.button === 2) right.current = {x: e.clientX, y: e.clientY};
                if (e.button !== 0 || space.current) return;
                const target = e.target as HTMLElement;
                if (target.classList.contains('react-flow__pane')) startBox(e);
                // Moving a card that is not chosen moves it alone: it becomes the choice before the drag reads it.
                const handle = target.closest('.checklist-drag-handle') && target.closest('.react-flow__node');
                const id = handle?.getAttribute('data-id');
                if (id && !e.shiftKey && !e.ctrlKey && !e.metaKey && !chosen().includes(id)) {
                  setPicked([]);
                  select(id);
                }
              }}
              onContextMenuCapture={e => {
                e.preventDefault();
                e.stopPropagation();
                if (Math.hypot(e.clientX - right.current.x, e.clientY - right.current.y) <= 5) context(e);
              }}
              onDragOver={e => {
                if (e.dataTransfer.types.includes('application/aie-resource')) e.preventDefault();
              }}
              onDrop={e => {
                const raw = e.dataTransfer.getData('application/aie-resource');
                if (!raw) return;
                e.preventDefault();
                attempt(() => {
                  const item = JSON.parse(raw),
                    n = flatNode(
                      w,
                      (e.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id') || ''
                    );
                  const draft = w.drafts?.find(d => d.id === n?.id);
                  if (draft) {
                    if (item.kind !== 'hkx' || draft.kind !== 'hkxPlay')
                      throw Error(tr('독립 HKX 카드에는 HKX 파일을 놓으세요.'));
                    edit(w => ({
                      ...w,
                      drafts: w.drafts!.map(d =>
                        d.id === draft.id
                          ? {
                              ...d,
                              value: {
                                ...d.value,
                                config: {
                                  ...d.value.config,
                                  steps: d.value.config.steps.map((s, i) =>
                                    i === 0 ? {...s, clip: item.clip, localPath: item.path || ''} : s
                                  ),
                                },
                              },
                            }
                          : d
                      ),
                    }));
                    return;
                  }
                  if (!n?.action && item.kind === 'hkx') {
                    const added = addFlat(w, '', 'playNode', screenToFlowPosition({x: e.clientX, y: e.clientY}));
                    const node = flatNode(added.workspace, added.id)!,
                      a = added.workspace.actions.find(a => a.uid === node.action)!;
                    a.config.steps[0].label = item.clip.split(/[\\/]/).at(-1) || 'HKX';
                    // A first-person file makes a first-person action (view.ts).
                    edit(() => placeStepFile(added.workspace, a.uid, a.config.steps[0].id, item.clip, item.path || ''));
                    select(added.id);
                    return;
                  }
                  if (!n?.action && item.kind === 'marker') {
                    const added = addFlat(w, '', 'markerReceive', screenToFlowPosition({x: e.clientX, y: e.clientY}));
                    const draft = added.workspace.drafts?.find(d => d.id === added.id);
                    if (!draft) throw Error(tr('이벤트 수신 카드를 만들지 못했습니다.'));
                    draft.value.config.start.mode = 'event';
                    draft.value.config.start.event = item.name;
                    edit(() => added.workspace);
                    select(added.id);
                    return;
                  }
                  if (!n?.action) throw Error(tr('대상 동작 또는 HKX 카드에 놓으세요.'));
                  const next = structuredClone(w),
                    a = next.actions.find(a => a.uid === n.action)!;
                  if (item.kind === 'hkx') {
                    const step = a.config.steps.find(s => s.id === n.step) ?? a.config.steps[0];
                    if (!step) throw Error(tr('HKX 재생 카드를 추가하고 연결하세요.'));
                    edit(w => placeStepFile(w, a.uid, step.id, item.clip, item.path || ''));
                    return;
                  } else if (item.kind === 'input') {
                    const input =
                      w.sharedInputs.find(i => i.id === item.id) ??
                      w.actions.find(a => a.uid === item.action)?.config.inputs.find(i => i.id === item.id);
                    if (!input) throw Error(tr('입력을 찾지 못했습니다.'));
                    if (!a.config.inputs.some(i => i.id === input.id)) a.config.inputs.push(structuredClone(input));
                    a.config.start.mode = 'input';
                    a.config.start.input = input.id;
                  } else if (item.kind === 'marker') {
                    a.config.start.mode = 'event';
                    a.config.start.event = item.name;
                  } else throw Error(tr('지원하지 않는 자산입니다.'));
                  edit(() => next);
                });
              }}
            >
              <ReactFlow<Visual>
                onlyRenderVisibleElements={!measuring}
                nodes={bare ? NO_NODES : nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={(e, n) => {
                  setSelectedEdge('');
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    if (!(e.target as HTMLElement).closest('input,select,textarea,button'))
                      choose(toggled(chosen(), n.id));
                  } else {
                    setPicked([]);
                    select(n.id);
                  }
                  if (!(e.target as HTMLElement).closest('.checklist-body')) region.current?.focus();
                }}
                onEdgeClick={(_, e) => {
                  setSelectedEdge(e.id);
                  setPicked([]);
                  select('');
                  region.current?.focus();
                }}
                onNodeDoubleClick={(e, n) => {
                  if ((e.target as HTMLElement).closest('input,select,textarea,button,.react-flow__handle')) return;
                  select(n.id);
                  focusFlow(n.id);
                }}
                onPaneClick={() => {
                  if (boxEnded.current) return;
                  setPicked([]);
                  setSelectedEdge('');
                  select('');
                  region.current?.focus();
                }}
                onNodesChange={changes => {
                  // The selection is this panel's (`picked`/`selected`): React Flow's own select changes are dropped.
                  const kept = changes.filter(c => c.type !== 'select');
                  if (kept.length) setNodes(ns => applyNodeChanges(kept, ns));
                }}
                onNodeDragStart={(_, n, all) => {
                  dragging.current = true;
                  setSelectedEdge('');
                  cancelled.current = false;
                  if (all.length < 2) {
                    setPicked([]);
                    select(n.id);
                  }
                }}
                onNodeDragStop={(_, n, all) => {
                  dragging.current = false;
                  if (!cancelled.current)
                    focusAction
                      ? setFocusPositions(p => ({...p, ...Object.fromEntries(all.map(n => [n.id, n.position]))}))
                      : edit(w => moveNodes(w, {kind: 'root'}, Object.fromEntries(all.map(n => [n.id, n.position]))));
                }}
                onConnect={c =>
                  attempt(() => {
                    const toEvent = connectQteToEvent(w, c.source, c.sourceHandle ?? '', c.target);
                    if (toEvent) {
                      edit(() => toEvent);
                      status(tr('QTE 결과가 이 이벤트를 보내고, QTE의 동작이 이 이벤트를 기다리도록 이었습니다.'));
                      return;
                    }
                    edit(
                      w =>
                        executeGraphCommand(w, {
                          type: 'connect',
                          source: c.sourceHandle?.startsWith('embedded:')
                            ? decodeURIComponent(c.sourceHandle.split(':')[1])
                            : c.source,
                          target: c.target,
                          port: c.sourceHandle?.startsWith('embedded:')
                            ? c.sourceHandle.split(':').slice(2).join(':')
                            : (c.sourceHandle ?? undefined),
                        }).workspace
                    );
                  })
                }
                zoomOnDoubleClick={false}
                panOnDrag={[1, 2]}
                // React Flow selects nothing itself (its click selection rewrites its own copy of the nodes and the
                // chosen marks drift from `picked`); dragging still moves every node marked selected.
                elementsSelectable={false}
                multiSelectionKeyCode={null}
                selectionKeyCode={null}
                nodeDragThreshold={5}
                nodeClickDistance={5}
                paneClickDistance={5}
                deleteKeyCode={null}
                minZoom={MIN_ZOOM}
                maxZoom={2}
                fitView
                fitViewOptions={{padding: 0.15, maxZoom: 0.8}}
                colorMode="dark"
              >
                <ScreenGrid />
                <SelectionRing target={region} />
                <EdgeWidth target={region} />
                <CanvasControls />
                {minimapOpen && (
                  <MiniMap
                    style={{width: 180, height: 110}}
                    pannable
                    zoomable
                    nodeColor={n => (n.selected ? '#ffffff' : n.data.kind === 'hkxPlay' ? '#77aaa3' : '#9a9a9a')}
                    nodeStrokeColor="#b8b8b8"
                    nodeStrokeWidth={2}
                    maskColor="rgba(0,0,0,0.25)"
                    maskStrokeColor="#cccccc"
                    maskStrokeWidth={1}
                  />
                )}
                <button
                  type="button"
                  className={'minimap-toggle' + (minimapOpen ? ' on' : '')}
                  aria-pressed={minimapOpen}
                  aria-label={minimapOpen ? tr('미니맵 닫기') : tr('미니맵 열기')}
                  title={minimapOpen ? tr('미니맵 닫기') : tr('미니맵 열기')}
                  onClick={toggleMinimap}
                >
                  <Icon name="map" size={16} />
                </button>
              </ReactFlow>
              {bare && !focusAction && (
                // A project without an action: the three steps to a first one (gone once a card exists).
                <div className="canvas-guide" role="note">
                  <h3>{tr('첫 동작 만들기')}</h3>
                  <ol>
                    <li>
                      <button type="button" className="canvas-guide-add" onClick={addPlay}>
                        {tr('＋ HKX 재생')}
                      </button>
                      <span>
                        {tr(
                          '카드를 만들고 카드의 파일에서 HKX를 고르세요. HKX 파일을 캔버스에 끌어다 놓아도 카드가 생깁니다.'
                        )}
                      </span>
                    </li>
                    <li>{tr('카드를 오른쪽 클릭해 시작 키 입력이나 시작 이벤트를 추가하세요.')}</li>
                    <li>{tr('F7로 검사하고 Ctrl+S로 저장하세요. 저장한 파일이 게임이 읽는 XML입니다.')}</li>
                  </ol>
                  <p className="canvas-guide-more">
                    {tr('이벤트부터 등록하려면')}{' '}
                    <button type="button" onClick={() => setRegistryShown(w.id)}>
                      {tr('이벤트 등록 카드 보기')}
                    </button>
                  </p>
                </div>
              )}
              {marquee && (
                <div
                  className="p3-marquee"
                  style={{left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h}}
                />
              )}
              {menu}
            </div>
          </div>
        </CardView.Provider>
      </CardGate.Provider>
    </ChecklistContext.Provider>
  );
}
// Memoized: the app shell re-renders for state this panel does not use.
export const FlatGraph = memo(FlatGraphPanel);
