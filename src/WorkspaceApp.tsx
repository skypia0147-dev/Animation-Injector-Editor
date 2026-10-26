import {UI_SCALES, applyUiScale, storedUiScale} from './ui/uiScale.ts';
import {localProject, shareableProject} from './localPaths.ts';
import {executeGraphCommand} from './graph/commands.ts';
import {facingChanges, pairSources, withFacings} from './graph/pairFacing.ts';
import {functionSummary} from './eventRegistry.ts';
import {freePlayPosition} from './graph/placement.ts';
import {connectXmlAssets} from './importAssets.ts';
import {draftBody, isDraftBody, readEditorBlock, savedProject, withEditorBlock} from './editorBlock.ts';
import {captureGraph, lowerGraph, authorReducer, type AuthorGraph} from './graph/document.ts';
import {StateDetails} from './ui/details/StateDetails.tsx';
import {HkxCardInfo} from './ui/details/HkxCardInfo.tsx';
import {actionNode, playbackNode} from './ui/details/inspectorModel.ts';
import {TransitionDetails} from './ui/details/TransitionDetails.tsx';
import {PinConnections} from './ui/details/PinConnections.tsx';
import {ProjectDetails} from './ui/details/ProjectDetails.tsx';
import {InputDetails, ParameterDetails} from './ui/details/ResourceDetails.tsx';
import {MarkerDetails} from './ui/details/MarkerDetails.tsx';
import {EffectDetails} from './ui/details/EffectDetails.tsx';
import {DetailPanel, DetailCategory} from './ui/details/DetailRow.tsx';
import {addMarker as addCatalogMarker, markerNames, removeMarker} from './ui/details/markerCatalog.ts';
import {deleteSharedInput, inputReferences} from './sharedSettings.ts';
import {uid, putAction} from './workspace.ts';
import {parameterDefault} from './authoring.ts';
import {switchPlaybackKind} from './actionTypes';
import {updateSharedInput} from './sharedSettings';
import {useEditorMenu} from './ContextMenu';
import {FlatGraph, type LinePick} from './graph/FlatGraph.tsx';
import {flatGraph, flatNode, flatId, addFlat} from './graph/flat.ts';
import {GraphDetails} from './graph/GraphDetails.tsx';
import {BlendDetails} from './graph/BlendDetails.tsx';
import {QteDetails} from './graph/QteDetails.tsx';
import {qteCardOf} from './graph/qteGraph.ts';
import {initialUI, uiReducer} from './graph/state.ts';
import type {GraphRef} from './graph/state.ts';
import {graphAction, graphTitle, projectGraph, duplicateGraphNode, moveNodes} from './graph/projection.ts';
import {Timeline} from './timeline/Timeline.tsx';
import {NotifyDetails} from './timeline/Details.tsx';
import {synchronizeRules, ruleNode, ruleOwner} from './graph/sharing.ts';
import {rows as notifyRows, remove as removeNotify} from './timeline/model.ts';
import type {Meta} from './timeline/model.ts';
import './timeline/timeline.css';
import {ExportSheet} from './ui/ExportSheet.tsx';
import {PanelResize} from './ui/PanelResize.tsx';
import {defaultSizes, readSizes, fitSizes, SIZE_KEY} from './ui/layout.ts';
import type {LayoutSizes} from './ui/layout.ts';
import {exportTemplate, parseTemplate} from './templates';
import {useCallback, useEffect, useMemo, useRef, useState, useReducer} from 'react';
import {ReactFlowProvider, useReactFlow} from '@xyflow/react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {clone, editableCopy} from './model';
import type {Issue} from './model';
import {
  addAction,
  compileWorkspace,
  emptyWorkspace,
  parseWorkspace,
  removeAction,
  validateWorkspace,
} from './workspace';
import type {Workspace, Action} from './workspace';
import {importWorkspaceXml} from './importXml';
import * as io from './io';
import {runtimeSummary, selectSound, soundLibrary, unregisterSound, xmlSavePath} from './package';
import {SoundSourceContext} from './ui/details/SoundFile.tsx';
import {t, useLanguage, languageNames, supportedLanguages, setLanguage} from './i18n/index.ts';
import {MenuBar} from './ui/MenuBar.tsx';
import type {Menu} from './ui/MenuBar.tsx';
import {ToolBar} from './ui/ToolBar.tsx';
import {Icon} from './EditorChrome.tsx';
import type {CompileState} from './ui/ToolBar.tsx';
import {Toasts, makeNotice} from './ui/Toast.tsx';
import type {Notice, NoticeLevel} from './ui/Toast.tsx';
import {CompileResults} from './ui/CompileResults.tsx';
import {MyProject} from './ui/MyProject.tsx';
import {HkxBrowser} from './ui/HkxBrowser.tsx';
import {StartScreen} from './ui/StartScreen.tsx';
import {Preferences} from './ui/Preferences.tsx';
import {useFileDrop} from './ui/useFileDrop.ts';
import type {DropPayload} from './ui/useFileDrop.ts';
import {assignClip, registerAssets, unregisterAsset} from './assets.ts';
import {actionView, placeStepFile, previewPerson, stepSource} from './view.ts';
import type {Person} from './view.ts';
import {useStableCallbacks} from './ui/stableCallbacks.ts';
import {renderedFlatGraph, renderedLibrary} from './graph/renderCache.ts';
import {shareUnchanged, deepFreeze} from './graph/historySharing.ts';
import {addRecent, getRecent, removeRecent} from './recent.ts';
import type {RecentFile} from './recent.ts';
import {lazy, Suspense} from 'react';
const Viewport = lazy(() => import('./viewport/Viewport.tsx').then(m => ({default: m.Viewport})));
import {pickViewerAsset, useViewerData} from './viewport/adapter.ts';
import {usePlayback} from './viewport/playback.ts';
import {frameAtTime, viewerMeta} from './viewport/types.ts';
import {previewAssets, setPreviewAsset, skeletonCandidates, skinPathForActor} from './viewport/resources.ts';
import {SELECTION_COMMAND} from './graph/marquee.ts';
import {tr} from './i18n/korean.ts';
import {errorText} from './errorText.ts';

export const EDITOR_VERSION = '1.0.0';
const RECOVERY_KEY = 'aieditor-recovery-v6';
const LAYOUT_KEY = 'aieditor-layout-v1';

type Panels = {myProject: boolean; hkx: boolean; viewport: boolean; bottom: boolean; details: boolean};
const defaultPanels = (): Panels => ({myProject: true, hkx: true, viewport: true, bottom: true, details: true});
function loadPanels(): Panels {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    if (!localStorage.getItem('aieditor-builtin-preview-v1')) {
      localStorage.setItem('aieditor-builtin-preview-v1', '1');
      return {...defaultPanels(), ...saved, viewport: true};
    }
    return saved && typeof saved === 'object' ? {...defaultPanels(), ...saved} : defaultPanels();
  } catch {
    return defaultPanels();
  }
}
type Modal = 'discard' | 'close' | 'changed' | 'help' | 'shortcuts' | 'package' | 'about' | null;
// A document is its runtime XML (the project rides in its editor block, editorBlock.ts) or a template. The .aiproj
// file is gone since 10-03: nothing opens, saves or lists one.
type DocumentKind = 'template' | 'xml';
const documentKind = (name: string, contents: string): DocumentKind =>
  /\.aitemplate$/i.test(name) && !contents.trimStart().startsWith('<') ? 'template' : 'xml';
const isDocumentPath = (p: string) => /\.(aitemplate|xml)$/i.test(p);
const isHkxPath = (p: string) => /\.hkx$/i.test(p);
const baseName = (p: string) => p.split(/[\\/]/).at(-1) ?? p;

function Editor() {
  const language = useLanguage();
  // Panels are memoized; their callbacks keep one identity (see useStableCallbacks).
  const stable = useStableCallbacks();
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const workRef = useRef<HTMLDivElement>(null);
  const [workSize, setWorkSize] = useState({width: window.innerWidth, height: window.innerHeight - 72});
  const [sizes, setSizes] = useState(() => {
    try {
      return readSizes(JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null'));
    } catch {
      return {...defaultSizes};
    }
  });
  const resize = (key: keyof LayoutSizes, value: number) => setSizes(s => ({...s, [key]: value}));
  const [exportMode, setExportMode] = useState<'xml' | 'mod'>('xml');
  const {fitView, screenToFlowPosition} = useReactFlow();
  // ---- document state ----
  const [started, setStarted] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [selectedInput, setSelectedInput] = useState('');
  const [selectedParameter, setSelectedParameter] = useState('');
  const [selectedMarker, setSelectedMarker] = useState('');
  const [selectedEffect, setSelectedEffect] = useState({action: '', id: ''});
  const [documentState, dispatchDocument] = useReducer(authorReducer, {
    present: captureGraph(emptyWorkspace()),
    past: [],
    future: [],
  });
  const {past, future} = documentState;
  // Unchanged parts keep the previous render's objects, so memoized cards and tree rows see only what an
  // edit changed. The rendered document never changes in place (edit() changes a clone); development
  // builds freeze it, so a change in place fails where it is made instead of leaving a card stale. The
  // document shares its records with the history's graph (graph/document.ts), which is frozen as well.
  const previousDocument = useRef<{graph: AuthorGraph; w: Workspace} | null>(null);
  const w = useMemo(() => {
    const graph = documentState.present,
      lowered = lowerGraph(graph),
      previous = previousDocument.current;
    let shared = lowered;
    if (previous) {
      // Project settings lower to copies of the graph's (lowerGraph): those the history kept as the same
      // objects are the previous document's, without comparing them again (Grapple's QTEs are 60% of it).
      const seeded: Record<string, unknown> = {...lowered};
      for (const [key, value] of Object.entries(graph.meta))
        if (value === (previous.graph.meta as Record<string, unknown>)[key] && Object.hasOwn(previous.w, key))
          seeded[key] = (previous.w as Record<string, unknown>)[key];
      shared = shareUnchanged(previous.w, seeded as Workspace);
    }
    if (import.meta.env.DEV) {
      deepFreeze(graph);
      deepFreeze(shared);
    }
    previousDocument.current = {graph, w: shared};
    return shared;
  }, [documentState.present]);
  const [saved, setSaved] = useState(() => JSON.stringify(captureGraph(emptyWorkspace())));
  const [xmlExportPath, setXmlExportPath] = useState('');
  // The stamp (SHA-256) of the XML at xmlExportPath as last read or written: Save refuses to write over a file that
  // changed on disk since then (another editor window, a text editor, a sync tool) and asks instead.
  const xmlStamp = useRef('');
  const [ui, dispatchUI] = useReducer(uiReducer, initialUI);
  const [timelineMetadata, setTimelineMetadata] = useState<{action: string; meta?: Meta; clip: string; error?: string}>(
    {action: '', clip: ''}
  );
  const activeGraph: GraphRef = {kind: 'root'} as GraphRef;
  const selectionGraph = useMemo(() => renderedFlatGraph(w), [w, language]);
  const selectedFlatId = ui.selection.kind === 'node' ? ui.selection.node : '';
  const flatSelection = selectionGraph.nodes.find(n => n.id === selectedFlatId);
  const selection =
    ui.selection.kind === 'resource'
      ? ui.selection.id
      : ui.selection.kind === 'state'
        ? ui.selection.action
        : ui.selection.kind === 'link'
          ? ui.selection.link
          : (flatSelection?.action ?? '');
  const setSelection = (id: string) =>
    dispatchUI({
      type: 'select',
      selection: current.current.actions.some(a => a.uid === id)
        ? {
            kind: 'node',
            graph: {kind: 'root'},
            node:
              actionNode(
                current.current,
                selectionGraph.nodes,
                current.current.actions.find(a => a.uid === id)!
              ) ?? id,
          }
        : current.current.links.some(l => l.id === id)
          ? {kind: 'link', link: id}
          : {
              kind: 'resource',
              id: (['inputs', 'markers', 'parameters', 'effects', 'preferences'].includes(id)
                ? id
                : 'project') as import('./graph/state.ts').ResourceKind,
            },
    });
  // An action chosen in a side panel (the project tree, the HKX browser) is brought into view on the graph.
  const [reveal, setReveal] = useState<{action: string; seq: number}>();
  // Cards chosen together on the canvas (two or more): the details panel lists them instead of one card.
  const [picked, setPicked] = useState<{id: string; title: string}[]>([]);
  // A line chosen by itself on the canvas: the details panel sums it up (where from, where to).
  const [line, setLine] = useState<LinePick>();
  const graphCommand = (command: string) => window.dispatchEvent(new CustomEvent(SELECTION_COMMAND, {detail: command}));
  const selectAndReveal = (id: string) => {
    setSelection(id);
    if (current.current.actions.some(a => a.uid === id)) setReveal(r => ({action: id, seq: (r?.seq ?? 0) + 1}));
  };
  const openGraph = (graph: GraphRef) => {
    const target = graph.kind === 'root' ? '' : graph.kind === 'link' ? flatId(graph, 'result') : graph.action;
    dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node: target}});
    setView('graph');
  };
  const effectAction = w.actions.find(a => a.uid === selectedEffect.action);
  const effect = effectAction?.pair?.effects.find(e => e.id === selectedEffect.id);
  // ---- ui state ----
  const [search, setSearch] = useState(''),
    [pending, setPending] = useState(false),
    [view, setView] = useState<'graph' | 'xml'>('graph'),
    [bottomTab, setBottomTab] = useState<'timeline' | 'results' | 'viewer'>('timeline'),
    [panels, setPanels] = useState<Panels>(loadPanels),
    [focusMode, setFocusMode] = useState(false),
    [uiScale, setUiScale] = useState(storedUiScale),
    [modal, setModal] = useState<Modal>(null),
    [pendingAction, setPendingAction] = useState<(() => void) | null>(null),
    [notices, setNotices] = useState<Notice[]>([]),
    [log, setLog] = useState<Notice[]>([]),
    [compiled, setCompiled] = useState<{at: number; serialized: string} | null>(null),
    [recent, setRecent] = useState<RecentFile[]>(getRecent),
    [previewSelection, setPreviewSelection] = useState({action: '', step: ''}),
    // The person a `both` action previews (view.ts): the viewport's choice.
    [previewChoice, setPreviewChoice] = useState<Person>('third'),
    [viewerRevision, setViewerRevision] = useState(0);
  const [recoverable, setRecoverable] = useState(() => {
    try {
      return !!localStorage.getItem(RECOVERY_KEY);
    } catch {
      return false;
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        ) ?? []
      ).filter(e => e.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal]);
  const serialized = useMemo(() => JSON.stringify(documentState.present), [documentState.present]),
    dirty = serialized !== saved;
  const current = useRef(w);
  current.current = w;
  // A pair's facing follows its HKX (graph/pairFacing.ts): set when a pair's file is found or changes, outside the
  // undo history, as an imported XML's arrangement is.
  const pairFiles = pairSources(w)
    .map(s => s.action + '=' + s.path)
    .join('|');
  useEffect(() => {
    if (!pairFiles) return;
    let cancelled = false;
    void facingChanges(current.current).then(changes => {
      if (cancelled || !changes.size) return;
      const next = withFacings(current.current, changes);
      current.current = next;
      dispatchDocument({type: 'replace', next});
    });
    return () => {
      cancelled = true;
    };
  }, [pairFiles]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const busyRef = useRef(pending);
  busyRef.current = pending;
  // Whole-document validation depends on the document only; selecting a clip changes the
  // timeline metadata, which adds its own warnings below without revalidating everything.
  // It runs once typing pauses (Grapple: ~10 ms, every keystroke otherwise; 150 ms still landed between
  // keystrokes of steady typing); what acts on the result (compile, export) validates at once while it is
  // behind (currentErrors).
  const [checked, setChecked] = useState<{w: Workspace; language: string; issues: Issue[]}>();
  const checkedNow = checked?.w === w && checked.language === language;
  useEffect(() => {
    if (checkedNow) return;
    const timer = setTimeout(() => setChecked({w, language, issues: validateWorkspace(w)}), 300);
    return () => clearTimeout(timer);
  }, [w, language, checkedNow]);
  const documentIssues = checked?.issues ?? [];
  const currentErrors = () => (checkedNow ? documentIssues : validateWorkspace(w)).filter(i => i.level === 'error');
  const issues = useMemo(() => {
      const base = [...documentIssues],
        a = w.actions.find(a => a.uid === timelineMetadata.action),
        meta = timelineMetadata.meta;
      if (a && meta) {
        const missing = new Set(
          notifyRows(w, a, timelineMetadata.clip)
            .flatMap(r => [r.from, r.until])
            .filter(m => m?.basis === 'event' && !meta.annotations.some(n => n.text === m.event))
            .map(m => m!.event)
        );
        for (const name of missing)
          base.push({level: 'warning', node: a.uid, message: t('timeline.missingWarning', {name})});
      }
      return base;
    }, [documentIssues, w, timelineMetadata, language]),
    errors = issues.filter(i => i.level === 'error');
  // Compiling the whole XML is the most expensive render step (Grapple: ~66 ms). Only the XML
  // view and the export sheet show it, and it changes only with the document.
  const showXml = view === 'xml' || modal === 'package';
  const xml = useMemo(() => {
    if (!showXml) return '';
    try {
      return compileWorkspace(w);
    } catch (e) {
      return errorText(e);
    }
  }, [w, showXml]);
  const action = w.actions.find(a => a.uid === selection),
    link = w.links.find(l => l.id === selection);
  const library = renderedLibrary(w);
  const soundEntries = useMemo(() => soundLibrary(w), [w]);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(panels));
    } catch {
      /* Layout persistence is optional. */
    }
  }, [panels]);

  // ---- notifications ----
  /** `quiet` entries go to the compile-results log only (routine edits); everything else also shows a toast. */
  const notify = useCallback((text: string, level: NoticeLevel = 'info', quiet = false) => {
    const n = makeNotice(level, text);
    if (!quiet) setNotices(list => [...list, n]);
    setLog(list => [...list.slice(-50), n]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices(list => list.filter(n => n.id !== id)), []);
  /** Legacy components report plain strings; failures are recognised by their wording. */
  const setStatus = useCallback(
    (text: string) => notify(text, /실패|없습니다|오류|error|failed/i.test(text) ? 'error' : 'info'),
    [notify]
  );

  // Document history is shared by every graph and Details edit.
  const edit = useCallback(
    (fn: (w: Workspace) => Workspace) => {
      try {
        // Fields the edit never reads stay the document's (editableCopy): they are neither copied nor compared.
        // The rules run on the copy before its untouched fields become the shared originals.
        const {copy, finish} = editableCopy(current.current);
        const next = finish(synchronizeRules(current.current, fn(copy)));
        // The round trip proves the edit is representable; the reducer reuses the capture.
        const graph = captureGraph(next);
        lowerGraph(graph);
        current.current = next;
        dispatchDocument({type: 'edit', next, graph});
      } catch (e) {
        notify(errorText(e), 'error');
      }
    },
    [notify]
  );
  // A sound file chosen in a function's field: its source is what the mod package copies (package.ts sounds).
  const soundSource = useMemo(
    () => ({
      sounds: soundEntries,
      remember: (file: string, path: string) => edit(w => selectSound(w, file, path)),
      status: setStatus,
    }),
    [edit, setStatus, soundEntries]
  );
  // An imported XML opens arranged by region; the graph applies it once the nodes are drawn,
  // as part of the import rather than as an edit to undo. The request is used up there (a graph
  // shown again later must not rearrange), and any other document opened first cancels it.
  const [arrangeRequest, setArrangeRequest] = useState(0);
  const settle = useCallback((fn: (w: Workspace) => Workspace) => {
    const next = fn(clone(current.current));
    current.current = next;
    dispatchDocument({type: 'replace', next});
    setArrangeRequest(0);
  }, []);
  const undo = useCallback(() => dispatchDocument({type: 'undo'}), []);
  const redo = useCallback(() => dispatchDocument({type: 'redo'}), []);
  const changeAction = (a: Action) => {
    const parameter = w.parameters.find(
      p => p.action === a.uid && p.field === 'inputKey' && !a.config.inputs.some(i => i.id === p.input)
    );
    if (parameter) {
      notify(parameter.label + ': ' + t('shell.inputReferenced'), 'error');
      return false;
    }
    const missing = w.links.find(l => l.from === a.uid && l.input && !a.config.inputs.some(i => i.id === l.input));
    if (missing) {
      notify(missing.id + ': ' + t('shell.inputReferenced'), 'error');
      return false;
    }
    edit(w => {
      let next = putAction(w, a);
      for (const i of a.config.inputs) if (w.sharedInputs.some(x => x.id === i.id)) next = updateSharedInput(next, i);
      return next;
    });
    return true;
  };
  const createAction = () => {
    const r = addFlat(w, '', 'playNode', freePlayPosition(screenToFlowPosition));
    edit(() => r.workspace);
    dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node: r.id}});
    notify(tr('HKX 재생 카드를 추가했습니다.'), 'info', true);
    return r.workspace.actions.at(-1)!;
  };
  const duplicateAction = (a: Action) => {
    const copy = addAction(w, a.pair ? 'pair' : a.config.kind);
    copy.nodeAuthored = a.nodeAuthored;
    copy.config = {
      ...clone(a.config),
      actionId: copy.config.actionId,
      name: a.config.name + ' ' + t('shell.copySuffix'),
    };
    copy.pair = clone(a.pair);
    copy.variants = clone(a.variants);
    if (a.view) copy.view = a.view;
    if (a.firstPerson) copy.firstPerson = a.firstPerson;
    copy.position = {x: a.position.x + 45, y: a.position.y + 55};
    edit(w => {
      w.actions = [...w.actions, copy];
      return w;
    });
    setSelection(copy.uid);
    notify(t('shell.duplicated'), 'ok', true);
  };
  const deleteSelection = () => {
    if (ui.selection.kind === 'notify') {
      edit(w =>
        removeNotify(
          w,
          ui.selection.kind === 'notify' ? ui.selection.action : '',
          ui.selection.kind === 'notify' ? ui.selection.id : ''
        )
      );
      return;
    }
    if (ui.selection.kind === 'node') {
      edit(
        w =>
          executeGraphCommand(w, {type: 'delete', id: ui.selection.kind === 'node' ? ui.selection.node : ''}).workspace
      );
      return;
    }
    if (selection === 'effects' && effectAction?.pair) {
      changeAction({
        ...effectAction,
        pair: {...effectAction.pair, effects: effectAction.pair.effects.filter(e => e.id !== selectedEffect.id)},
      });
      setSelection(effectAction.uid);
      return;
    }
    if (selection === 'markers') {
      try {
        const next = removeMarker(w, selectedMarker);
        edit(() => next);
        setSelection('project');
      } catch (e) {
        notify(errorText(e), 'error');
      }
      return;
    }
    if (selection === 'inputs') {
      try {
        const [scope, id] = (selectedInput || 'shared:' + w.sharedInputs[0]?.id).split(':');
        if (scope === 'shared') {
          const next = deleteSharedInput(w, id);
          edit(() => next);
        } else {
          const a = w.actions.find(a => a.uid === scope);
          if (a) {
            if (inputReferences(w, scope, id).length) throw new Error(t('shell.inputReferenced'));
            changeAction({...a, config: {...a.config, inputs: a.config.inputs.filter(i => i.id !== id)}});
          }
        }
        setSelection('project');
      } catch (e) {
        notify(errorText(e), 'error');
      }
      return;
    }
    if (selection === 'parameters') {
      edit(w => {
        w.parameters = w.parameters.filter(p => p.id !== (selectedParameter || w.parameters[0]?.id));
        return w;
      });
      setSelection('project');
      return;
    }
    if (action) {
      try {
        const next = removeAction(w, action.uid);
        edit(() => next);
        setSelection('project');
        notify(t('shell.deleted'), 'ok', true);
      } catch (e) {
        notify(errorText(e), 'error');
      }
    } else if (link) {
      edit(w => {
        w.links = w.links.filter(x => x.id !== link.id);
        return w;
      });
      setSelection('project');
      notify(t('shell.deleted'), 'ok', true);
    }
  };

  // ---- compile ----
  const compile = useCallback(() => {
    const errorCount = currentErrors().length;
    setCompiled({at: Date.now(), serialized});
    setBottomTab('results');
    setPanels(p => (p.bottom ? p : {...p, bottom: true}));
    if (!w.actions.length) notify(tr('아직 동작이 없습니다. ＋ HKX 재생으로 첫 카드를 만드세요.'), 'info');
    else
      notify(
        t('compile.passed', {errors: errorCount, warnings: issues.length - errors.length}),
        errorCount ? 'error' : 'ok'
      );
    return errorCount === 0;
  }, [serialized, errors, issues, notify, checkedNow, w]);
  const compileState: CompileState = !w.actions.length
    ? 'empty'
    : errors.length
      ? 'error'
      : compiled && compiled.serialized === serialized
        ? 'ok'
        : 'stale';

  // ---- documents ----
  const adopt = (next: Workspace, opts: {name?: string; fresh?: boolean; xmlPath?: string; stamp?: string}) => {
    current.current = next;
    dispatchDocument({type: 'adopt', next});
    setArrangeRequest(0);
    setSaved(opts.fresh ? '' : JSON.stringify(captureGraph(next)));
    dispatchUI({type: 'reset'});
    setSelection(next.actions[0]?.uid ?? 'project');
    setXmlExportPath(opts.xmlPath ?? '');
    xmlStamp.current = opts.xmlPath ? (opts.stamp ?? '') : '';
    setCompiled(null);
    setPreviewSelection({action: '', step: ''});
    setViewerRevision(value => value + 1);
    setStarted(true);
    if (opts.xmlPath && opts.name) setRecent(addRecent(opts.xmlPath, opts.name));
    requestAnimationFrame(() => fitView({padding: 0.15, duration: 200}));
  };
  const loadDocument = async (doc: io.OpenedDocument) => {
    const kind = documentKind(doc.name, doc.contents);
    // An XML saved by the editor carries the whole project (editorBlock.ts): restored as saved while its runtime
    // body is untouched; a body edited elsewhere opens from the XML itself.
    const saved = kind === 'xml' ? savedProject(doc.contents) : null;
    const restored = !!saved?.project;
    let next = saved?.project
      ? parseWorkspace(localProject(saved.project))
      : kind === 'xml'
        ? importWorkspaceXml(saved!.body)
        : parseTemplate(doc.contents);
    // A restored block has no local paths when it was saved on another computer (localPaths.ts): HKX beside the
    // XML are found from its mod folder, as for an XML without a block. A remembered path whose file is gone (the
    // mod folder renamed) is found there again; one still there is left alone.
    const sources =
      kind === 'xml' && isTauri()
        ? await connectXmlAssets(next, doc.path, io.resolveHkx, io.filesExist, io.modSounds)
        : null;
    if (sources) next = sources.workspace;
    adopt(next, {name: doc.name, fresh: !restored, xmlPath: kind === 'xml' ? doc.path : '', stamp: doc.stamp});
    if (kind === 'xml' && !restored) setArrangeRequest(value => value + 1);
    // Sound files the functions play, found beside the XML (importAssets.ts connectXmlSounds).
    const soundNote = sources?.sounds.connected
      ? ' ' + tr('소리 파일 {n}개를 모드 폴더에서 찾았습니다.', {n: sources.sounds.connected})
      : '';
    notify(
      (kind === 'template'
        ? t('shell.templateOpened')
        : restored
          ? t('shell.opened', {name: doc.name}) +
            (sources?.stale
              ? ' ' +
                tr('기억한 HKX 경로 {stale}개가 없어져 모드 폴더에서 다시 찾았습니다(찾음 {connected}개).', {
                  stale: sources.stale,
                  connected: sources.connected,
                })
              : '')
          : t('shell.imported') +
            (saved?.stale ? ' ' + t('shell.editorBlockStale') : '') +
            (sources && sources.connected + sources.missing > 0
              ? ' ' + t('shell.xmlSources', {connected: sources.connected, missing: sources.missing})
              : '')) + soundNote,
      saved?.stale ? 'warn' : 'ok'
    );
  };
  const guarded = (fn: () => void) => {
    if (dirtyRef.current && started) {
      setPendingAction(() => fn);
      setModal('discard');
    } else fn();
  };
  const withBusy = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  };
  const openDialog = () =>
    guarded(
      () =>
        void withBusy(async () => {
          try {
            const doc = await io.open();
            if (doc) await loadDocument(doc);
          } catch (e) {
            notify(t('shell.openFailed', {error: errorText(e)}), 'error');
          }
        })
    );
  const openRecent = (r: RecentFile) =>
    guarded(
      () =>
        void withBusy(async () => {
          try {
            await loadDocument(await io.openPath(r.path));
          } catch (e) {
            setRecent(removeRecent(r.path));
            notify(t('shell.openFailed', {error: errorText(e)}), 'error');
          }
        })
    );
  const newProject = () =>
    guarded(() => {
      adopt(emptyWorkspace(), {});
      notify(t('shell.newProject'), 'ok');
    });
  const recover = () => {
    try {
      const text = localStorage.getItem(RECOVERY_KEY);
      if (!text) return;
      adopt(parseWorkspace(text), {fresh: true});
      setRecoverable(false);
      notify(t('shell.recovered'), 'ok');
    } catch (e) {
      notify(errorText(e), 'error');
    }
  };
  const addInput = () => {
    const id = uid(
      'sharedInput',
      w.sharedInputs.map(i => i.id).concat(w.actions.flatMap(a => a.config.inputs.map(i => i.id)))
    );
    edit(w => {
      w.sharedInputs = [...w.sharedInputs, {id, label: t('row.input'), key: 'G', gamepad: 0}];
      return w;
    });
    setSelectedInput('shared:' + id);
    setSelection('inputs');
  };
  const addParameter = () => {
    const id = uid(
      'setting',
      w.parameters.map(p => p.id)
    );
    edit(w => ({
      ...w,
      parameters: [...w.parameters, {...parameterDefault(), id, label: t('myProject.sharedSettings')}],
    }));
    setSelectedParameter(id);
    setSelection('parameters');
  };
  const addMarker = () => {
    const name = uid('Event', markerNames(w));
    edit(w => addCatalogMarker(w, name));
    setSelectedMarker(name);
    setSelection('markers');
  };
  // The recovery copy holds the last unsaved state. It goes once the document is saved or its changes are
  // discarded, so a later start never offers a document older than the saved one (code review E-13).
  const clearRecovery = useCallback(() => {
    pendingRecovery.current = null;
    try {
      localStorage.removeItem(RECOVERY_KEY);
    } catch {
      /* Optional storage. */
    }
    setRecoverable(false);
  }, []);
  const save = useCallback(
    async (mode: 'save' | 'saveAs' | 'xml' | 'template', overwrite = false) => {
      if (busyRef.current) return false;
      setPending(true);
      try {
        const blocking = currentErrors().length;
        if (mode === 'template') {
          if (blocking) {
            compile();
            notify(t('shell.exportBlocked', {n: blocking}), 'error');
            return false;
          }
          const saved = await io.save('template', exportTemplate(w));
          if (saved) notify(t('shell.saved', {path: saved.path}), 'ok');
          return !!saved;
        }
        // The document is its runtime XML with the editor's block (editorBlock.ts): Save
        // writes where it was opened or last saved, Save As and Export XML ask where. Export XML needs a project
        // without errors. Save keeps one with errors as work in progress: the runtime body stays the file's last
        // valid one, so the game keeps playing it and no XML the plugin would reject is ever written.
        if (mode === 'xml' && blocking) {
          compile();
          notify(t('shell.exportBlocked', {n: blocking}), 'error');
          return false;
        }
        const project = JSON.stringify(documentState.present);
        parseWorkspace(project);
        const target = mode === 'save' && isTauri() ? xmlExportPath : '';
        let body: string;
        let verdict: Awaited<ReturnType<typeof io.checkRuntimeXml>> | null = null;
        if (!blocking) {
          body = compileWorkspace(w);
          // The plugin skips a file it rejects entirely; check with its own parser first.
          verdict = isTauri() ? await io.checkRuntimeXml(body) : null;
          if (verdict?.available && !verdict.valid) {
            notify(t('export.runtimeRejected', {error: runtimeSummary(verdict)}), 'error');
            return false;
          }
        } else {
          // Work in progress: the file keeps its last valid body, so the game keeps playing it. A file saved for the
          // first time (or under another name) gets a draft's empty body instead: the game skips it until the
          // errors are fixed, and the work is not lost.
          body = draftBody(w.id);
          if (target)
            try {
              body = readEditorBlock((await io.openPath(target)).contents).body;
            } catch {
              /* gone or unreadable: a draft */
            }
        }
        const draft = !!blocking && isDraftBody(body);
        // The block is shipped with the mod: no local paths in it (localPaths.ts).
        const text = withEditorBlock(body, shareableProject(project));
        const suggested =
          mode === 'xml'
            ? xmlSavePath(w.packaging.folder, xmlExportPath)
            : xmlExportPath || xmlSavePath(w.packaging.folder);
        let written: io.SavedDocument | null;
        try {
          written = target
            ? await io.saveToPath(target, text, overwrite ? '' : xmlStamp.current, draft)
            : await io.save('xml', text, suggested, draft);
        } catch (e) {
          if (!io.changedOnDisk(e)) throw e;
          // Changed elsewhere since it was opened or last saved: ask before writing over it.
          setModal('changed');
          return false;
        }
        const path = written?.path;
        if (written && path) {
          setSaved(serialized);
          clearRecovery();
          if (isTauri()) {
            setXmlExportPath(path);
            xmlStamp.current = written.stamp;
            setRecent(addRecent(path, baseName(path)));
          }
          for (const warning of verdict?.warnings ?? []) notify(t('export.runtimeWarning', {text: warning}), 'warn');
          if (draft)
            notify(
              tr(
                '오류 {n}개가 있어 게임용 내용은 비워 두고 편집 정보만 저장했습니다: {path}. 게임은 오류를 고쳐 다시 저장할 때까지 이 파일을 건너뜁니다.',
                {n: blocking, path}
              ),
              'warn'
            );
          else if (blocking) notify(t('shell.savedDraft', {path, n: blocking}), 'warn');
          else if (verdict && !verdict.available)
            notify(
              t('shell.savedUnchecked', {path}) + ' ' + t('export.runtimeUnavailable', {problem: verdict.problem}),
              'warn'
            );
          else notify(t('shell.saved', {path}), 'ok');
        }
        return !!path;
      } catch (e) {
        notify(t('shell.saveFailed', {error: errorText(e)}), 'error');
        return false;
      } finally {
        setPending(false);
      }
    },
    [w, errors, serialized, xmlExportPath, notify, compile, checkedNow, clearRecovery]
  );
  const openExport = (mode: 'xml' | 'mod') => {
    const blocking = currentErrors().length;
    if (blocking) {
      compile();
      notify(t('shell.exportBlocked', {n: blocking}), 'error');
      return;
    }
    setExportMode(mode);
    setNotices([]);
    setModal('package');
  };
  const exportMod = () => openExport('mod');

  // ---- drag & drop ----
  const onDrop = async (payload: DropPayload) => {
    if (busyRef.current || modal) return;
    if (
      (payload.files.length || payload.paths.some(isDocumentPath)) &&
      payload.files.length + payload.paths.length > 1
    ) {
      notify(t('drop.mixed'), 'warn');
      return;
    }
    const dropDocument = current.current;
    const element = document.elementFromPoint(payload.x, payload.y) as HTMLElement | null,
      previewTarget = element?.closest<HTMLElement>('[data-preview-kind][data-preview-actor][data-preview-clip]'),
      previewKind = previewTarget?.dataset.previewKind as 'skeletons' | 'skins' | undefined,
      previewActor = Number(previewTarget?.dataset.previewActor),
      previewClip = previewTarget?.dataset.previewClip ?? '',
      previewIndex = previewKind
        ? payload.paths.findIndex(path => (previewKind === 'skeletons' ? /\.hkx$/i : /\.glb$/i).test(path))
        : -1,
      previewPath = previewIndex >= 0 ? payload.paths[previewIndex] : '',
      remaining = payload.paths.filter((_, index) => index !== previewIndex),
      docs = remaining.filter(isDocumentPath),
      hkx = remaining.filter(isHkxPath),
      others = remaining.filter(p => !isDocumentPath(p) && !isHkxPath(p));
    if (previewPath && previewKind && previewClip) {
      edit(w => setPreviewAsset(w, previewClip, previewKind, previewActor, previewPath));
      setViewerRevision(value => value + 1);
      notify(
        t('shell.previewAssigned', {
          actor: previewActor + 1,
          kind: t(previewKind === 'skeletons' ? 'viewport.skeleton' : 'viewport.skin'),
          name: baseName(previewPath),
        }),
        'ok'
      );
    }
    if (payload.files.length) {
      const f = payload.files[0];
      guarded(
        () =>
          void withBusy(async () => {
            try {
              await loadDocument({name: f.name, path: '', contents: f.contents, stamp: ''});
            } catch (e) {
              notify(t('shell.openFailed', {error: errorText(e)}), 'error');
            }
          })
      );
    } else if (docs.length) {
      const path = docs[0];
      guarded(
        () =>
          void withBusy(async () => {
            try {
              await loadDocument(await io.openPath(path));
            } catch (e) {
              notify(t('shell.openFailed', {error: errorText(e)}), 'error');
            }
          })
      );
    }
    if (hkx.length) {
      if (!isTauri()) {
        notify(t('drop.hkxNeedsDesktop'), 'warn');
      } else {
        try {
          const resolved = await io.resolveHkx(hkx);
          if (current.current !== dropDocument) throw new Error(t('export.changed'));
          const good = resolved.filter(r => !r.error);
          for (const r of resolved.filter(r => r.error)) notify(baseName(r.path) + ': ' + r.error, 'error');
          if (good.length) {
            const items = good.map(r => ({clip: r.clip, path: r.path}));
            const el = document.elementFromPoint(payload.x, payload.y) as HTMLElement | null;
            const node = el?.closest('.react-flow__node')?.getAttribute('data-id');
            const flatTarget = node ? flatNode(current.current, node) : undefined;
            const targetState = node && current.current.actions.find(a => a.uid === (flatTarget?.action ?? node));
            const onCanvas = !!el?.closest('.react-flow') && view === 'graph' && started;
            if (targetState && good.length === 1) {
              edit(w => {
                const a = w.actions.find(a => a.uid === targetState.uid)!,
                  step =
                    flatTarget?.step ?? (a.config.steps.find(s => s.id === a.config.entry) ?? a.config.steps[0])?.id;
                if (!step) return assignClip(w, targetState.uid, items[0].clip, items[0].path);
                // The file's folder decides third or first person (view.ts).
                return placeStepFile(w, targetState.uid, step, items[0].clip, items[0].path);
              });
              notify(t('hkx.assigned', {name: baseName(items[0].path), state: targetState.config.name}), 'ok');
            } else if (onCanvas && activeGraph.kind === 'anim' && good.length === 1) {
              edit(w => {
                const a = graphAction(w, activeGraph)!;
                const step = projectGraph(w, activeGraph).nodes.find(n => n.id === node)?.step ?? activeGraph.step;
                const s = a.config.steps.find(s => s.id === step) ?? a.config.steps[0];
                return placeStepFile(registerAssets(w, items), a.uid, s.id, items[0].clip, items[0].path);
              });
            } else if (onCanvas && activeGraph.kind === 'root') {
              const pos = screenToFlowPosition({x: payload.x, y: payload.y});
              edit(w => {
                let next = registerAssets(w, items);
                items.forEach((item, i) => {
                  const r = addFlat(next, '', 'playNode', {x: pos.x + i * 40, y: pos.y + i * 60});
                  next = r.workspace;
                  const a = next.actions.at(-1)!;
                  a.config.name = baseName(item.path).replace(/\.hkx$/i, '');
                  a.position = {x: pos.x + i * 40, y: pos.y + i * 60};
                  next = placeStepFile(next, a.uid, a.config.steps[0].id, item.clip, item.path);
                });
                return next;
              });
              notify(t('hkx.stateCreated', {name: baseName(items[0].path)}), 'ok');
            } else {
              edit(w => registerAssets(w, items));
              notify(t('hkx.registered', {n: good.length}), 'ok');
            }
            if (!started) setStarted(true);
          }
        } catch (e) {
          notify(errorText(e), 'error');
        }
      }
    }
    if (others.length && isTauri()) {
      try {
        const beforeRoots = current.current;
        const result = await io.resolveSearchRoots(others);
        if (current.current !== beforeRoots) throw new Error(t('export.changed'));
        if (result.roots.length) {
          const added = result.roots.filter(
            root =>
              !current.current.packaging.roots.some(
                p => p.replaceAll('\\', '/').toLowerCase() === root.replaceAll('\\', '/').toLowerCase()
              )
          );
          const available = Math.max(0, 12 - current.current.packaging.roots.length);
          if (added.length > available) notify(t('drop.rootLimit'), 'warn');
          edit(w => {
            w.packaging = {...w.packaging, roots: [...w.packaging.roots, ...added.slice(0, available)]};
            return w;
          });
          notify(t('drop.rootAdded', {n: Math.min(added.length, available)}), 'ok');
          setStarted(true);
        }
        for (const o of result.rejected) notify(t('drop.unsupported') + ': ' + baseName(o), 'warn');
      } catch (e) {
        notify(errorText(e), 'error');
      }
    } else for (const o of others) notify(t('drop.unsupported') + ': ' + baseName(o), 'warn');
  };
  const dropping = useFileDrop(onDrop);

  useEffect(() => {
    if (!started || !workRef.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWorkSize({width: entry.contentRect.width, height: entry.contentRect.height})
    );
    observer.observe(workRef.current);
    return () => observer.disconnect();
  }, [started]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
      } catch {
        /* Optional preference storage. */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [sizes]);

  // ---- persistence / shortcuts ----
  // The recovery copy is written after edits settle and only when it can be loaded again,
  // so a transient invalid state never replaces the last recoverable document.
  const pendingRecovery = useRef<string | null>(null);
  const writeRecovery = useCallback(() => {
    const text = pendingRecovery.current;
    pendingRecovery.current = null;
    if (text === null) return;
    try {
      parseWorkspace(text);
    } catch {
      return;
    }
    try {
      localStorage.setItem(RECOVERY_KEY, text);
    } catch {
      /* Editing stays available without local storage. */
    }
  }, []);
  useEffect(() => {
    if (!dirty || !started) {
      pendingRecovery.current = null;
      return;
    }
    pendingRecovery.current = serialized;
    const timer = setTimeout(writeRecovery, 400);
    return () => clearTimeout(timer);
  }, [serialized, dirty, started, writeRecovery]);
  useEffect(() => {
    window.addEventListener('pagehide', writeRecovery);
    return () => window.removeEventListener('pagehide', writeRecovery);
  }, [writeRecovery]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (busyRef.current || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('[role="menu"]'))) return;
      if (modal) {
        if (
          e.key === 'Escape' &&
          (modal === 'package' || modal === 'help' || modal === 'shortcuts' || modal === 'about')
        ) {
          e.preventDefault();
          setModal(null);
        }
        return;
      }
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      const key = e.key.toLowerCase(),
        ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && key === 's') {
        e.preventDefault();
        void save(e.shiftKey ? 'saveAs' : 'save');
      } else if (ctrl && key === 'n') {
        e.preventDefault();
        newProject();
      } else if (ctrl && key === 'o') {
        e.preventDefault();
        openDialog();
      } else if (ctrl && key === 'e') {
        e.preventDefault();
        if (e.shiftKey) exportMod();
        else openExport('xml');
      } else if (e.key === 'F7') {
        e.preventDefault();
        compile();
      } else if (inField) {
        return;
      } else if (ctrl && key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (ctrl && key === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && key === 'w' && started) {
        e.preventDefault();
        if (ui.selection.kind === 'node')
          edit(w => duplicateGraphNode(w, activeGraph, ui.selection.kind === 'node' ? ui.selection.node : ''));
        else if (action) duplicateAction(action);
      } else if (e.key === 'F2' && started) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.details-body .detail-row input:not([type="checkbox"])')?.focus();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && started && !modal) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Home' && started) {
        e.preventDefault();
        fitView({padding: 0.12, maxZoom: 1, duration: 200});
      } else if (ctrl && e.key === '`' && started) {
        e.preventDefault();
        setView(v => (v === 'graph' ? 'xml' : 'graph'));
      }
    };
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  });
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    globalThis.addEventListener('beforeunload', listener);
    return () => globalThis.removeEventListener('beforeunload', listener);
  }, [dirty]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false,
      off: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(e => {
        if (busyRef.current) {
          e.preventDefault();
          notify(t('shell.waitFile'), 'warn');
          return;
        }
        if (dirtyRef.current) {
          e.preventDefault();
          setModal('close');
        }
      })
      .then(f => {
        if (disposed) f();
        else off = f;
      })
      .catch(e => notify(errorText(e), 'error'));
    return () => {
      disposed = true;
      off?.();
    };
  }, [notify]);

  // ---- graph data ----

  const timelineAction =
    w.actions.find(a => a.uid === flatSelection?.action) ??
    (ui.selection.kind === 'notify'
      ? w.actions.find(a => a.uid === (ui.selection.kind === 'notify' ? ui.selection.action : ''))
      : undefined) ??
    action ??
    w.actions.find(a => a.uid === link?.from) ??
    graphAction(w, activeGraph) ??
    (ui.selection.kind === 'node' && activeGraph.kind === 'root'
      ? w.actions.find(a => a.uid === (ui.selection.kind === 'node' ? ui.selection.node : ''))
      : undefined);
  const graphStep = flatSelection?.step ?? '',
    previewStep =
      timelineAction?.config.steps.find(
        step =>
          step.id ===
          (previewSelection.action === timelineAction.uid
            ? previewSelection.step
            : graphStep || timelineAction.config.entry || timelineAction.config.steps[0]?.id)
      ) ?? timelineAction?.config.steps[0];
  useEffect(() => {
    if (!timelineAction || !previewStep) {
      if (previewSelection.action || previewSelection.step) setPreviewSelection({action: '', step: ''});
      return;
    }
    if (previewSelection.action !== timelineAction.uid || (graphStep && previewSelection.step !== graphStep))
      setPreviewSelection({action: timelineAction.uid, step: graphStep || previewStep.id});
  }, [timelineAction?.uid, graphStep]);
  // A first-person action previews its _1stPerson copy; a `both` action the person chosen in the viewport.
  const previewShown: Person = timelineAction ? previewPerson(w, timelineAction, previewChoice) : 'third',
    previewSource =
      timelineAction && previewStep
        ? stepSource(w, timelineAction, previewStep, previewShown)
        : {clip: previewStep?.clip ?? '', path: ''},
    previewClip = previewSource.clip;
  const previewPath =
      previewSource.path ||
      library.find(asset => asset.clip.toLowerCase() === previewClip.toLowerCase())?.localPath ||
      '',
    previewResource = previewAssets(w, previewClip, timelineAction?.pair?.targetRig),
    viewerRequest = useMemo(
      () =>
        panels.viewport && previewPath
          ? {
              path: previewPath,
              skeletons: previewResource.skeletons,
              candidates: skeletonCandidates(w, previewResource.skeletons),
            }
          : null,
      [panels.viewport, previewPath, JSON.stringify(previewResource.skeletons), JSON.stringify(w.assets)]
    ),
    viewer = useViewerData(viewerRequest, viewerRevision),
    previewMeta = useMemo(() => viewerMeta(viewer.data), [viewer.data]),
    playback = usePlayback(
      viewer.data?.duration ?? 0,
      `${timelineAction?.uid ?? ''}:${previewStep?.id ?? ''}:${previewPath}:${viewerRevision}`
    ),
    previewFrame = frameAtTime(playback.time, viewer.data),
    previewSkinPaths =
      viewer.data?.actors.map((actor, index) =>
        skinPathForActor(w, previewClip, index, actor.skeleton, actor.skeletonPath)
      ) ?? [];
  const changePreviewAsset = (kind: 'skeletons' | 'skins', actor: number, path: string) => {
    if (!previewClip) return;
    edit(w => setPreviewAsset(w, previewClip, kind, actor, path));
    setViewerRevision(value => value + 1);
  };
  const pickPreviewAsset = (kind: 'skeletons' | 'skins', actor: number) =>
    void withBusy(async () => {
      try {
        const path = await pickViewerAsset(kind === 'skeletons' ? 'skeleton' : 'skin');
        if (path) changePreviewAsset(kind, actor, path);
      } catch (error) {
        notify(errorText(error), 'error');
      }
    });
  const nameOf = (uid: string) => w.actions.find(a => a.uid === uid)?.config.name ?? uid;
  const where = (node: string) => {
    const l = w.links.find(l => l.id === node);
    if (l) return `${nameOf(l.from)} → ${nameOf(l.to)}`;
    if (w.actions.some(a => a.uid === node)) return nameOf(node);
    const labels: Record<string, string> = {
      project: t('details.project'),
      inputs: t('myProject.inputs'),
      globals: t('shell.projectSettings'),
      parameters: t('myProject.sharedSettings'),
    };
    return labels[node] ?? node;
  };
  const {context, menu: contextMenu} = useEditorMenu(target => {
    const id = target.closest('.react-flow__node')?.getAttribute('data-id');
    if (id) setSelection(id);
    const a = w.actions.find(a => a.uid === id),
      l = w.links.find(l => l.id === id);
    return [
      ...(a
        ? [
            {label: t('menu.edit.duplicate'), run: () => duplicateAction(a)},
            {
              label: t('menu.edit.delete'),
              run: () => {
                try {
                  edit(w => removeAction(w, a.uid));
                  setSelection('project');
                } catch (e) {
                  notify(errorText(e), 'error');
                }
              },
            },
          ]
        : []),
      ...(l
        ? [
            {
              label: t('menu.edit.delete'),
              run: () => {
                edit(w => {
                  w.links = w.links.filter(n => n.id !== l.id);
                  return w;
                });
                setSelection('project');
              },
            },
          ]
        : []),
      {label: t('node.hkxPlay') + tr(' 추가'), run: () => createAction()},
      {label: t('menu.edit.undo'), disabled: !past.length, run: undo},
      {label: t('menu.edit.redo'), disabled: !future.length, run: redo},
      {label: t('menu.view.fit'), run: () => fitView({padding: 0.12, maxZoom: 1, duration: 200})},
    ];
  }, setStatus);

  if (!started)
    return (
      <div className={'shell-start' + (dropping ? ' dropping' : '')}>
        <StartScreen
          recent={recent}
          onNew={newProject}
          onOpen={openDialog}
          onOpenRecent={openRecent}
          onRemoveRecent={p => setRecent(removeRecent(p))}
          onRecover={recoverable ? recover : undefined}
        />
        <Toasts notices={notices} dismiss={dismiss} />
      </div>
    );

  const toggle = (key: keyof Panels) => {
    setPanels(p => ({...p, [key]: !p[key]}));
    if (key === 'viewport')
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({padding: 0.12, maxZoom: 1, duration: 200})));
  };
  const resetLayout = () => {
    setPanels(defaultPanels());
    setSizes({...defaultSizes});
    setFocusMode(false);
  };
  const menus: Menu[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        {label: t('menu.file.new'), shortcut: 'Ctrl+N', run: newProject},
        {label: t('menu.file.open'), shortcut: 'Ctrl+O', run: openDialog},
        {
          label: t('menu.file.recent'),
          disabled: !recent.length,
          submenu: recent.map(r => ({label: r.name, run: () => openRecent(r)})),
        },
        '-',
        {label: t('menu.file.save'), shortcut: 'Ctrl+S', run: () => void save('save')},
        {label: t('menu.file.saveAs'), shortcut: 'Ctrl+Shift+S', run: () => void save('saveAs')},
        '-',
        {label: t('menu.file.saveTemplate'), run: () => void save('template')},
        '-',
        {
          label: t('menu.file.export'),
          submenu: [
            {label: t('menu.file.exportXml'), shortcut: 'Ctrl+E', run: () => openExport('xml')},
            {label: t('menu.file.exportMod'), shortcut: 'Ctrl+Shift+E', run: exportMod},
          ],
        },
        '-',
        {label: t('menu.file.exit'), disabled: !isTauri(), run: () => void getCurrentWindow().close()},
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        {label: t('menu.edit.undo'), shortcut: 'Ctrl+Z', disabled: !past.length, run: undo},
        {label: t('menu.edit.redo'), shortcut: 'Ctrl+Y', disabled: !future.length, run: redo},
        '-',
        {
          label: t('menu.edit.duplicate'),
          shortcut: 'Ctrl+W',
          disabled: !action && ui.selection.kind !== 'node',
          run: () => {
            if (ui.selection.kind === 'node') {
              try {
                const next = duplicateGraphNode(w, activeGraph, ui.selection.node);
                edit(() => next);
              } catch (e) {
                setStatus(errorText(e));
              }
            } else if (action) duplicateAction(action);
          },
        },
        {
          label: t('menu.edit.delete'),
          shortcut: 'Del',
          disabled:
            ui.selection.kind !== 'node' &&
            ui.selection.kind !== 'notify' &&
            !action &&
            !link &&
            !['inputs', 'parameters', 'markers', 'effects'].includes(selection),
          run: deleteSelection,
        },
        '-',
        {
          label: t('menu.edit.align'),
          run: () => {
            edit(w =>
              moveNodes(
                w,
                activeGraph,
                Object.fromEntries(
                  flatGraph(w).nodes.map((n, i) => [n.id, {x: (i % 4) * 270, y: Math.floor(i / 4) * 210}])
                )
              )
            );
            requestAnimationFrame(() => fitView({padding: 0.13, duration: 200}));
          },
        },
        '-',
        {label: t('menu.edit.preferences'), run: () => setSelection('preferences')},
      ],
    },
    {
      id: 'project',
      label: t('menu.project'),
      items: [
        {label: t('menu.project.settings'), run: () => setSelection('project')},
        {label: t('menu.project.compile'), shortcut: 'F7', run: compile},
        '-',
        {label: t('node.hkxPlay') + tr(' 추가'), run: () => createAction()},
        {label: t('menu.project.addInput'), run: () => addInput()},
        {label: t('menu.project.addMarker'), run: () => addMarker()},
        {
          label: t('detail.addNotify'),
          disabled: !action?.pair,
          run: () => {
            if (!action?.pair) return;
            const id = uid(
              'effect',
              action.pair.effects.map(e => e.id)
            );
            changeAction({
              ...action,
              pair: {
                ...action.pair,
                effects: [...action.pair.effects, {id, values: {op: 'hide', at: '0.2'}}],
              },
            });
            setSelectedEffect({action: action.uid, id});
            setSelection('effects');
          },
        },
        {label: t('myProject.sharedSettings'), run: () => setSelection('parameters')},
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        {label: t('menu.view.graph'), checked: view === 'graph', run: () => setView('graph')},
        {label: t('menu.view.xml'), shortcut: 'Ctrl+`', checked: view === 'xml', run: () => setView('xml')},
        '-',
        {label: t('menu.view.fit'), shortcut: 'Home', run: () => fitView({padding: 0.12, maxZoom: 1, duration: 200})},
        {
          label: t('menu.view.focus'),
          checked: focusMode,
          run: () => {
            setFocusMode(v => !v);
            setTimeout(() => fitView({padding: 0.12, maxZoom: 1, duration: 200}), 40);
          },
        },
        '-',
        ...UI_SCALES.map(scale => ({
          label: tr('글자 크기 {n}%', {n: Math.round(scale * 100)}),
          checked: uiScale === scale,
          run: () => {
            applyUiScale(scale);
            setUiScale(scale);
          },
        })),
      ],
    },
    {
      id: 'window',
      label: t('menu.window'),
      items: [
        {label: t('panel.myProject'), checked: panels.myProject, run: () => toggle('myProject')},
        {label: t('panel.hkxBrowser'), checked: panels.hkx, run: () => toggle('hkx')},
        {label: t('panel.viewport'), checked: panels.viewport, run: () => toggle('viewport')},
        {
          label: t('panel.timeline') + ' · ' + t('panel.compileResults'),
          checked: panels.bottom,
          run: () => toggle('bottom'),
        },
        {label: t('panel.details'), checked: panels.details, run: () => toggle('details')},
        '-',
        {label: t('menu.window.resetLayout'), run: resetLayout},
      ],
    },
    {
      id: 'language',
      label: t('prefs.language'),
      items: supportedLanguages.map(value => ({
        label: languageNames[value],
        checked: language === value,
        run: () => setLanguage(value),
      })),
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        {label: t('menu.help.guide'), run: () => setModal('help')},
        {label: t('menu.help.shortcuts'), run: () => setModal('shortcuts')},
        '-',
        {label: t('menu.help.about'), run: () => setModal('about')},
      ],
    },
  ];
  const showLeft = !focusMode && (panels.myProject || panels.hkx),
    showRight = !focusMode && panels.details;
  const fitted = fitSizes(sizes, workSize.width, workSize.height, showLeft, showRight, panels.viewport, panels.bottom);
  const compactDock = workSize.width - fitted.left - fitted.right < 600;
  const columns = `${fitted.left}px minmax(0, 1fr) ${fitted.right}px`;
  const detailsKind = link
    ? 'transition'
    : action
      ? action.pair
        ? 'pair'
        : 'state'
      : selection === 'effects'
        ? 'effects'
        : selection === 'markers'
          ? 'markers'
          : selection === 'inputs'
            ? 'inputs'
            : selection === 'parameters'
              ? 'parameters'
              : selection === 'preferences'
                ? 'preferences'
                : 'project';
  const detailsTitle = link
    ? `${nameOf(link.from)} → ${nameOf(link.to)}`
    : (action?.config.name ??
      (selection === 'effects'
        ? effect
          ? functionSummary(effect.values) + ' · ' + (effect.values.at ?? '') + tr('초')
          : t('detail.notify')
        : selection === 'markers'
          ? selectedMarker
          : selection === 'inputs'
            ? t('myProject.inputs')
            : selection === 'parameters'
              ? t('myProject.sharedSettings')
              : selection === 'preferences'
                ? t('menu.edit.preferences')
                : w.name));
  const closeButton = (key: keyof Panels) => (
    <button
      type="button"
      className="close"
      aria-label={t('shell.close')}
      title={t('shell.close')}
      onClick={() => toggle(key)}
    >
      ×
    </button>
  );

  return (
    <SoundSourceContext.Provider value={soundSource}>
      <div
        className={'shell' + (dropping ? ' dropping' : '')}
        data-drop={t('drop.registerHint')}
        onContextMenu={context}
      >
        {contextMenu}
        <header className="application-header">
          <div className="application-title">
            Animation Injector <span>Editor</span>
          </div>
          <MenuBar
            menus={menus}
            right={
              <>
                <b>{w.name}</b>
                {dirty ? ' •' : ''}
                {xmlExportPath ? ' · ' + baseName(xmlExportPath) : ''}
              </>
            }
          />
          <ToolBar
            compile={compileState}
            errors={errors.length}
            warnings={issues.length - errors.length}
            onCompile={compile}
            onSave={() => void save('save')}
            dirty={dirty}
            pending={pending}
            onFind={() => {
              setPanels(p => (p.myProject ? p : {...p, myProject: true}));
              setTimeout(() => searchRef.current?.focus(), 30);
            }}
            onExportXml={() => openExport('xml')}
            onExportMod={exportMod}
            exportDisabled={pending}
          />
        </header>
        <div className="work" ref={workRef} style={{gridTemplateColumns: columns}}>
          {showLeft && (
            <PanelResize
              label="layout.left"
              axis="x"
              value={fitted.left}
              min={180}
              max={Math.min(500, workSize.width - fitted.right - 320)}
              change={v => resize('left', v)}
              reset={() => resize('left', defaultSizes.left)}
              style={{left: fitted.left - 3}}
            />
          )}
          {showRight && (
            <PanelResize
              label="layout.right"
              axis="x"
              value={fitted.right}
              min={240}
              max={Math.min(600, workSize.width - fitted.left - 320)}
              scale={-1}
              change={v => resize('right', v)}
              reset={() => resize('right', defaultSizes.right)}
              style={{right: fitted.right - 3}}
            />
          )}
          {showLeft && (
            <aside
              className={'dock left' + (panels.myProject && panels.hkx ? '' : ' single')}
              style={
                panels.myProject && panels.hkx
                  ? {gridTemplateRows: `minmax(0, ${fitted.project}fr) minmax(0, ${100 - fitted.project}fr)`}
                  : undefined
              }
            >
              {panels.myProject && panels.hkx && (
                <PanelResize
                  label="layout.project"
                  axis="y"
                  value={fitted.project}
                  min={20}
                  max={80}
                  scale={100 / Math.max(1, workSize.height)}
                  change={v => resize('project', v)}
                  reset={() => resize('project', defaultSizes.project)}
                  style={{top: `calc(${fitted.project}% - 3px)`}}
                />
              )}
              {panels.myProject && (
                <section className="panel" data-testid="panel-my-project">
                  <div className="ptab">
                    <span>{t('panel.myProject')}</span>
                    {closeButton('myProject')}
                  </div>
                  <div className="pbody">
                    <MyProject
                      issues={issues}
                      onOpenGraph={stable('tree.openGraph', (action: string) => openGraph({kind: 'anim', action}))}
                      selectedResource={
                        selection === 'inputs'
                          ? selectedInput
                          : selection === 'parameters'
                            ? selectedParameter
                            : selectedMarker
                      }
                      w={w}
                      selection={selection}
                      search={search}
                      setSearch={setSearch}
                      select={stable('tree.select', selectAndReveal)}
                      selectedClip={flatSelection?.step}
                      selectClip={stable('tree.selectClip', (action: string, step: string) => {
                        const a = w.actions.find(a => a.uid === action);
                        const n = a && playbackNode(selectionGraph.nodes, a, step);
                        if (!n) return;
                        dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node: n.id}});
                        setReveal(r => ({action, seq: (r?.seq ?? 0) + 1}));
                      })}
                      onAddState={stable('tree.addState', () => createAction())}
                      onOpenInputs={stable('tree.inputs', (id?: string) => {
                        if (id) {
                          setSelectedInput(id);
                          setSelection('inputs');
                        } else addInput();
                      })}
                      onOpenMarker={stable('tree.marker', (name?: string) => {
                        if (name) {
                          setSelectedMarker(name);
                          setSelection('markers');
                        } else addMarker();
                      })}
                      onOpenEffect={stable('tree.effect', (action: string, id: string) => {
                        setSelectedEffect({action, id});
                        setSelection('effects');
                      })}
                      onOpenParameters={stable('tree.parameters', (id?: string) => {
                        if (id) {
                          setSelectedParameter(id);
                          setSelection('parameters');
                        } else addParameter();
                      })}
                      onOpenProject={stable('tree.project', () => setSelection('project'))}
                      searchRef={searchRef}
                    />
                  </div>
                </section>
              )}
              {panels.hkx && (
                <section className="panel" data-testid="panel-hkx">
                  <div className="ptab">
                    <span>{t('panel.hkxBrowser')}</span>
                    {closeButton('hkx')}
                  </div>
                  <div className="pbody">
                    <HkxBrowser
                      entries={library}
                      sounds={soundEntries}
                      onRemoveSound={stable('sound.remove', (file: string) => edit(w => unregisterSound(w, file)))}
                      onAddSound={stable(
                        'sound.add',
                        () =>
                          void withBusy(async () => {
                            try {
                              const picked = await io.pickSound();
                              if (picked) edit(w => selectSound(w, picked.file, picked.path));
                            } catch (e) {
                              notify(errorText(e), 'error');
                            }
                          })
                      )}
                      selected={selectedAsset}
                      onSelect={setSelectedAsset}
                      names={stable('hkx.names', nameOf)}
                      onSelectUser={stable('hkx.selectUser', selectAndReveal)}
                      onRemove={stable('hkx.remove', (clip: string) => edit(w => unregisterAsset(w, clip)))}
                      onAdd={stable(
                        'hkx.add',
                        () =>
                          void withBusy(async () => {
                            try {
                              const picked = await io.pickHkx();
                              if (picked) {
                                edit(w => registerAssets(w, [picked]));
                                notify(t('hkx.registered', {n: 1}), 'ok');
                              }
                            } catch (e) {
                              notify(errorText(e), 'error');
                            }
                          })
                      )}
                    />
                  </div>
                </section>
              )}
            </aside>
          )}
          <main
            className={
              'dock center graphite-dock' +
              (panels.viewport ? ' has-viewer' : '') +
              (panels.bottom ? ' has-bottom' : '') +
              (compactDock ? ' compact-dock' : '')
            }
            style={{
              gridTemplateRows: `minmax(260px, 1fr) ${fitted.bottom}px`,
              gridTemplateColumns:
                panels.viewport && panels.bottom && !compactDock
                  ? `minmax(260px,1fr) ${fitted.viewport}px`
                  : 'minmax(0,1fr)',
            }}
          >
            {(panels.bottom || panels.viewport) && (
              <PanelResize
                label="layout.bottom"
                axis="y"
                value={fitted.bottom}
                min={150}
                max={workSize.height - 260}
                scale={-1}
                change={v => resize('bottom', v)}
                reset={() => resize('bottom', defaultSizes.bottom)}
                style={{bottom: fitted.bottom - 3}}
              />
            )}
            {panels.bottom && panels.viewport && !compactDock && (
              <PanelResize
                label="layout.viewport"
                axis="x"
                value={fitted.viewport}
                min={240}
                max={Math.max(240, workSize.width - fitted.left - fitted.right - 260)}
                scale={-1}
                change={v => resize('viewport', v)}
                reset={() => resize('viewport', defaultSizes.viewport)}
                style={{right: fitted.viewport - 3, top: 'auto', bottom: 0, height: fitted.bottom}}
              />
            )}
            {panels.viewport ? (
              <section
                className="panel viewport-panel"
                data-testid="panel-viewport"
                style={{display: compactDock && panels.bottom && bottomTab !== 'viewer' ? 'none' : undefined}}
              >
                <div className="ptab">
                  {compactDock && panels.bottom && (
                    <button className="tab off" onClick={() => setBottomTab('timeline')}>
                      {tr('타임라인')}
                    </button>
                  )}
                  <span>{t('panel.viewport')}</span>
                  <span
                    className="who"
                    title={
                      (timelineAction?.config.name ?? t('timeline.selectState')) +
                      (previewStep ? ' · ' + previewStep.label : '')
                    }
                  >
                    {timelineAction?.config.name ?? t('timeline.selectState')}
                    {previewStep ? ' · ' + previewStep.label : ''}
                  </span>
                  {closeButton('viewport')}
                </div>
                <Suspense
                  fallback={
                    <div className="viewport-message" role="status">
                      {tr('뷰어 준비 중…')}
                    </div>
                  }
                >
                  <Viewport
                    clip={previewClip}
                    path={previewPath}
                    person={previewShown}
                    choosePerson={
                      timelineAction && actionView(w, timelineAction) === 'both' ? setPreviewChoice : undefined
                    }
                    pairExpected={!!timelineAction?.pair}
                    resources={previewResource}
                    skinPaths={previewSkinPaths}
                    viewer={viewer}
                    frame={previewFrame}
                    time={playback.time}
                    playing={playback.playing}
                    play={playback.play}
                    pause={playback.pause}
                    stop={playback.stop}
                    reload={() => setViewerRevision(value => value + 1)}
                    pick={pickPreviewAsset}
                    clear={(kind, actor) => changePreviewAsset(kind, actor, '')}
                  />
                </Suspense>
              </section>
            ) : null}
            <section className="panel graph-area" data-testid="panel-graph">
              <div className="ptab">
                <button
                  type="button"
                  className={'tab' + (view === 'graph' ? '' : ' off')}
                  onClick={() => setView('graph')}
                >
                  {t('menu.view.graph')}
                </button>
                <button type="button" className={'tab' + (view === 'xml' ? '' : ' off')} onClick={() => setView('xml')}>
                  XML
                </button>
                <span className="who">{t('graph.stateMachine')}</span>
              </div>
              {view === 'xml' ? (
                <div className="xml-document">
                  <pre>{xml}</pre>
                </div>
              ) : (
                <FlatGraph
                  w={w}
                  globalSettings={stable('flat.globalSettings', () => setSelection('project'))}
                  selected={
                    ui.selection.kind === 'notify'
                      ? ui.selection.id.startsWith('runtime:')
                        ? `anim:${ui.selection.action}:|${ui.selection.id.slice(8)}`
                        : `notify:${ui.selection.action}|${ui.selection.id}`
                      : ui.selection.kind === 'node'
                        ? ui.selection.node
                        : selection
                  }
                  edit={edit}
                  arrangeRequest={arrangeRequest}
                  settle={settle}
                  select={stable('flat.select', (node: string) =>
                    dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node}})
                  )}
                  reveal={reveal}
                  status={setStatus}
                  onPick={stable('flat.pick', setPicked)}
                  onLine={stable('flat.line', setLine)}
                />
              )}
            </section>
            {panels.bottom ? (
              <section
                className="panel bottom-dock"
                data-testid="panel-bottom"
                style={{display: compactDock && panels.viewport && bottomTab === 'viewer' ? 'none' : undefined}}
              >
                <div className="ptab">
                  <button
                    type="button"
                    className={'tab' + (bottomTab === 'timeline' ? '' : ' off')}
                    onClick={() => setBottomTab('timeline')}
                  >
                    {t('panel.timeline')}
                  </button>
                  <button
                    type="button"
                    className={'tab' + (bottomTab === 'results' ? '' : ' off')}
                    onClick={() => setBottomTab('results')}
                  >
                    {t('panel.compileResults')}
                    {errors.length ? <small>{errors.length}</small> : null}
                  </button>
                  {compactDock && panels.viewport && (
                    <button className="tab off" onClick={() => setBottomTab('viewer')}>
                      {tr('HKX 뷰어')}
                    </button>
                  )}
                  <span className="who" title={timelineAction?.config.name ?? t('timeline.selectState')}>
                    {timelineAction?.config.name ?? t('timeline.selectState')}
                  </span>
                  {closeButton('bottom')}
                </div>
                {bottomTab !== 'results' ? (
                  <Timeline
                    w={w}
                    action={timelineAction}
                    step={activeGraph.kind === 'anim' ? activeGraph.step : undefined}
                    selected={ui.selection.kind === 'notify' ? ui.selection.id : (flatSelection?.notify ?? '')}
                    edit={edit}
                    status={setStatus}
                    onMetadata={setTimelineMetadata}
                    selectedStep={previewStep?.id}
                    person={previewChoice}
                    onStepChange={step => timelineAction && setPreviewSelection({action: timelineAction.uid, step})}
                    playhead={playback.time}
                    onScrub={playback.seek}
                    externalMeta={previewMeta}
                    key={timelineAction?.uid ?? 'empty'}
                    onSelect={id => {
                      if (id.startsWith('playNotify:')) {
                        const [action, notifyId] = id.slice(11).split('|');
                        dispatchUI({type: 'select', selection: {kind: 'notify', action, id: notifyId}});
                      } else if (id.startsWith('link:')) openGraph({kind: 'link', link: id.slice(5)});
                      else if (id.startsWith('clipWindow:') && timelineAction)
                        dispatchUI({
                          type: 'select',
                          selection: {
                            kind: 'node',
                            graph: {kind: 'root'},
                            node: `anim:${timelineAction.uid}:|clip_${id.slice(11)}`,
                          },
                        });
                      else if (timelineAction)
                        dispatchUI({type: 'select', selection: {kind: 'notify', action: timelineAction.uid, id}});
                    }}
                  />
                ) : (
                  <CompileResults
                    issues={issues}
                    log={log}
                    compiledAt={compiled?.serialized === serialized ? compiled.at : null}
                    onSelect={node => setSelection(node)}
                    where={where}
                  />
                )}
              </section>
            ) : (
              <div />
            )}
          </main>
          {showRight && (
            <aside className="dock right">
              <section className="panel" data-testid="panel-details">
                <div className="ptab">
                  <span>{t('panel.details')}</span>
                  {closeButton('details')}
                </div>
                {view === 'graph' && picked.length > 1 ? (
                  <div className="details-body multi-pick" data-testid="multi-pick">
                    <div className="multi-pick-head">
                      <b>
                        {tr('카드')} {picked.length}
                        {tr('개 선택')}
                      </b>
                      <button onClick={() => graphCommand('clear')}>{tr('선택 해제')}</button>
                    </div>
                    <ul>
                      {picked.map(p => (
                        <li key={p.id}>{p.title}</li>
                      ))}
                    </ul>
                    <div className="multi-pick-actions">
                      <button onClick={() => graphCommand('copy')}>{tr('복사')}</button>
                      <button onClick={() => graphCommand('alignLeft')}>{tr('왼쪽 맞춤')}</button>
                      <button className="danger" onClick={() => graphCommand('delete')}>
                        {tr('삭제')}
                      </button>
                    </div>
                    <p className="hint">
                      {tr(
                        'Shift+클릭·끌기로 더하고, Ctrl+클릭·끌기로 넣고 뺍니다. 머리줄을 끌면 함께 옮겨지고, Esc로 선택을 풉니다.'
                      )}
                    </p>
                  </div>
                ) : view === 'graph' && line ? (
                  <div className="details-body line-pick" data-testid="line-pick">
                    <div className="multi-pick-head">
                      <b>
                        {tr('연결선')}
                        {line.route ? ` · ${line.route}` : ''}
                      </b>
                    </div>
                    <div className="line-pick-end">
                      <em className="from">{tr('출발')}</em>
                      <span>{line.from.title}</span>
                      <button onClick={() => graphCommand('go:' + line.from.id)}>{tr('이 카드로 이동')}</button>
                    </div>
                    <div className="line-pick-arrow">↓{line.route ? ` ${line.route}` : ''}</div>
                    <div className="line-pick-end">
                      <em className="to">{tr('도착')}</em>
                      <span>{line.to.title}</span>
                      <button onClick={() => graphCommand('go:' + line.to.id)}>{tr('이 카드로 이동')}</button>
                    </div>
                    <div className="multi-pick-actions">
                      <button className="danger" onClick={() => graphCommand('cutLine')}>
                        {tr('연결선 삭제')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="details-head">
                      <div className={'details-symbol ' + (flatSelection?.kind ?? '')}>
                        <Icon
                          name={
                            flatSelection?.kind === 'hkxPlay'
                              ? 'play'
                              : flatSelection?.kind?.startsWith('condition')
                                ? 'branch'
                                : flatSelection?.kind === 'blend'
                                  ? 'blend'
                                  : 'settings'
                          }
                          size={23}
                        />
                      </div>
                      <span className="kind">
                        <b className={detailsKind}>
                          {ui.selection.kind === 'notify' ? t('timeline.track') : t('details.' + detailsKind)}
                        </b>
                        {flatSelection?.kind === 'hkxPlay'
                          ? timelineAction?.config.name
                          : (link?.id ?? action?.config.actionId ?? (detailsKind === 'project' ? w.id : ''))}
                      </span>
                      <h2>
                        {ui.selection.kind === 'notify' && timelineAction
                          ? notifyRows(w, timelineAction).find(
                              r => r.id === (ui.selection.kind === 'notify' ? ui.selection.id : '')
                            )?.label
                          : ui.selection.kind === 'node'
                            ? (flatSelection?.title ??
                              projectGraph(w, activeGraph).nodes.find(
                                n => n.id === (ui.selection.kind === 'node' ? ui.selection.node : '')
                              )?.title ??
                              graphTitle(w, activeGraph))
                            : detailsTitle}
                      </h2>
                    </div>
                    <div className="details-body">
                      {flatSelection && (
                        <PinConnections
                          w={w}
                          id={flatSelection.id}
                          edit={edit}
                          status={setStatus}
                          select={node =>
                            dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node}})
                          }
                        />
                      )}
                      {flatSelection &&
                        w.sharedRules
                          ?.filter(g => g.members.some(m => ruleNode(g.kind, m, w) === flatSelection.id))
                          .map((g, i) => (
                            <details key={i} open>
                              <summary>
                                {tr('공유 규칙 ·')} {g.members.length}
                                {tr('개 동작에 적용')}
                              </summary>
                              {g.members.map(m => (
                                <div key={m}>
                                  {w.actions.find(a => a.uid === ruleOwner(w, g.kind, m))?.config.name ?? m}{' '}
                                  <button
                                    onClick={() =>
                                      edit(next => {
                                        next.sharedRules = next.sharedRules
                                          ?.map(x =>
                                            x.kind === g.kind && x.members.includes(m)
                                              ? {...x, members: x.members.filter(v => v !== m)}
                                              : x
                                          )
                                          .filter(x => x.members.length > 1);
                                        return next;
                                      })
                                    }
                                  >
                                    {tr('개별 편집으로 분리')}
                                  </button>
                                </div>
                              ))}
                            </details>
                          ))}
                      {ui.selection.kind === 'notify' && timelineAction ? (
                        <NotifyDetails
                          w={w}
                          action={timelineAction}
                          id={ui.selection.id}
                          edit={edit}
                          meta={timelineMetadata.action === timelineAction.uid ? timelineMetadata.meta : undefined}
                        />
                      ) : flatSelection?.notify && timelineAction ? (
                        <NotifyDetails
                          w={w}
                          action={timelineAction}
                          id={flatSelection.notify}
                          edit={edit}
                          meta={timelineMetadata.action === timelineAction.uid ? timelineMetadata.meta : undefined}
                        />
                      ) : flatSelection?.kind === 'qte' ? (
                        <QteDetails w={w} id={flatSelection.id} edit={edit} />
                      ) : flatSelection && qteCardOf(flatSelection.id) ? (
                        <QteDetails w={w} id={qteCardOf(flatSelection.id)} edit={edit} />
                      ) : flatSelection?.kind === 'blend' ? (
                        <BlendDetails w={w} id={flatSelection.id} edit={edit} status={setStatus} />
                      ) : flatSelection?.kind === 'hkxPlay' && timelineAction ? (
                        <HkxCardInfo
                          key={timelineAction.uid}
                          w={w}
                          action={timelineAction}
                          stepId={flatSelection.step}
                          node={flatSelection.id}
                          issues={issues}
                          edit={edit}
                          status={setStatus}
                          select={stable('inspector.select', (node: string) =>
                            dispatchUI({type: 'select', selection: {kind: 'node', graph: {kind: 'root'}, node}})
                          )}
                          reveal={stable('inspector.reveal', () =>
                            setReveal(r => ({action: timelineAction.uid, seq: (r?.seq ?? 0) + 1}))
                          )}
                        />
                      ) : ui.selection.kind === 'node' ? (
                        <GraphDetails
                          w={w}
                          graph={flatSelection?.scope ?? activeGraph}
                          node={flatSelection?.original ?? ui.selection.node}
                          edit={edit}
                          status={setStatus}
                          open={openGraph}
                          selectedAsset={selectedAsset}
                          onGlobalSettings={() => setSelection('project')}
                        />
                      ) : detailsKind === 'preferences' ? (
                        <Preferences onResetLayout={resetLayout} />
                      ) : detailsKind === 'effects' && effect && effectAction?.pair ? (
                        <DetailPanel>
                          <DetailCategory title={t('detail.notify')} initialOpen>
                            <EffectDetails
                              effect={effect}
                              pair
                              change={next =>
                                changeAction({
                                  ...effectAction,
                                  pair: {
                                    ...effectAction.pair!,
                                    effects: effectAction.pair!.effects.map(e => (e.id === next.id ? next : e)),
                                  },
                                })
                              }
                            />
                          </DetailCategory>
                        </DetailPanel>
                      ) : detailsKind === 'markers' ? (
                        <MarkerDetails
                          w={w}
                          name={selectedMarker}
                          select={setSelectedMarker}
                          edit={edit}
                          status={setStatus}
                        />
                      ) : detailsKind === 'parameters' ? (
                        <ParameterDetails w={w} selected={selectedParameter} edit={edit} status={setStatus} />
                      ) : detailsKind === 'inputs' ? (
                        <InputDetails
                          w={w}
                          selected={selectedInput}
                          edit={edit}
                          changeAction={changeAction}
                          status={setStatus}
                        />
                      ) : link ? (
                        <TransitionDetails
                          w={w}
                          l={link}
                          change={l =>
                            edit(w => {
                              w.links = w.links.map(x => (x.id === l.id ? l : x));
                              return w;
                            })
                          }
                        />
                      ) : action ? (
                        <StateDetails
                          key={action.uid + ':' + (action.pair ? 'pair' : action.config.kind)}
                          w={w}
                          library={library}
                          selectedAsset={library.find(e => e.clip === selectedAsset)}
                          action={action}
                          change={changeAction}
                          edit={edit}
                          switchKind={kind => {
                            try {
                              const next = switchPlaybackKind(w, action.uid, kind);
                              edit(() => next);
                              notify(t('shell.kindChanged'), 'ok');
                            } catch (e) {
                              notify(errorText(e), 'error');
                            }
                          }}
                          status={setStatus}
                          onGlobalSettings={() => setSelection('project')}
                        />
                      ) : (
                        <ProjectDetails w={w} edit={edit} />
                      )}
                    </div>
                  </>
                )}
              </section>
            </aside>
          )}
        </div>
        {!modal && <Toasts notices={notices} dismiss={dismiss} />}
        {modal && (
          <div className="modal-shade">
            <section
              className={'modal ' + (modal === 'package' ? 'xml-modal package-modal' : '')}
              role="dialog"
              aria-modal="true"
              aria-label={
                modal === 'help'
                  ? t('help.title')
                  : modal === 'shortcuts'
                    ? t('help.shortcutsTitle')
                    : modal === 'package'
                      ? t('export.title')
                      : modal === 'about'
                        ? t('menu.help.about')
                        : modal === 'changed'
                          ? t('shell.changedTitle')
                          : t('shell.discardTitle')
              }
            >
              <div className="modal-head">
                <h2>
                  {modal === 'help'
                    ? t('help.title')
                    : modal === 'shortcuts'
                      ? t('help.shortcutsTitle')
                      : modal === 'package'
                        ? t('export.title')
                        : modal === 'about'
                          ? t('menu.help.about')
                          : modal === 'changed'
                            ? t('shell.changedTitle')
                            : t('shell.discardTitle')}
                </h2>
                <button disabled={pending} onClick={() => setModal(null)}>
                  {t('shell.close')}
                </button>
              </div>
              {modal === 'package' ? (
                <ExportSheet
                  mode={exportMode}
                  setMode={setExportMode}
                  w={w}
                  xml={xml}
                  edit={edit}
                  status={setStatus}
                  busy={pending}
                  setBusy={setPending}
                  saveXml={() => void save('xml')}
                  message={notices.at(-1)?.text ?? ''}
                />
              ) : modal === 'about' ? (
                <p>{t('help.about', {version: EDITOR_VERSION})}</p>
              ) : modal === 'shortcuts' ? (
                <table className="shortcuts">
                  <tbody>
                    {[
                      [
                        'Ctrl+N / O / S',
                        t('menu.file.new') + ' / ' + t('menu.file.open') + ' / ' + t('menu.file.save'),
                      ],
                      ['Ctrl+Shift+S', t('menu.file.saveAs')],
                      ['Ctrl+E / Ctrl+Shift+E', t('menu.file.exportXml') + ' / ' + t('menu.file.exportMod')],
                      ['F7', t('menu.project.compile')],
                      ['Ctrl+Z / Ctrl+Y', t('menu.edit.undo') + ' / ' + t('menu.edit.redo')],
                      ['Ctrl+W / Del', t('menu.edit.duplicate') + ' / ' + t('menu.edit.delete')],
                      ['Home', t('menu.view.fit')],
                      ['Ctrl+`', t('menu.view.xml')],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td>
                          <kbd>{k}</kbd>
                        </td>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : modal === 'help' ? (
                <>
                  <ol>
                    {[1, 2, 3, 4].map(n => (
                      <li key={n}>{t('help.step' + n)}</li>
                    ))}
                  </ol>
                  <p>{t('help.drop')}</p>
                </>
              ) : modal === 'changed' ? (
                <>
                  <p>{t('shell.changedBody', {path: xmlExportPath})}</p>
                  <div className="top-actions">
                    <button onClick={() => setModal(null)}>{t('shell.cancel')}</button>
                    <button
                      onClick={() => {
                        setModal(null);
                        void save('saveAs');
                      }}
                    >
                      {t('menu.file.saveAs')}
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setModal(null);
                        void save('save', true);
                      }}
                    >
                      {t('shell.overwrite')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>{t('shell.discardBody')}</p>
                  <div className="top-actions">
                    <button
                      onClick={() => {
                        setModal(null);
                        setPendingAction(null);
                      }}
                    >
                      {modal === 'close' ? t('shell.continueEditing') : t('shell.cancel')}
                    </button>
                    <button
                      onClick={() => {
                        const closing = modal === 'close';
                        setModal(null);
                        void save('save').then(ok => {
                          if (ok) {
                            if (closing) void getCurrentWindow().destroy();
                            else pendingAction?.();
                          }
                          setPendingAction(null);
                        });
                      }}
                    >
                      {t('shell.saveFirst')}
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        const closing = modal === 'close';
                        setModal(null);
                        clearRecovery();
                        if (closing) void getCurrentWindow().destroy();
                        else {
                          const fn = pendingAction;
                          setPendingAction(null);
                          dirtyRef.current = false;
                          fn?.();
                        }
                      }}
                    >
                      {modal === 'close' ? t('shell.quitWithoutSave') : t('shell.discard')}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </SoundSourceContext.Provider>
  );
}
export default function WorkspaceApp() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
