import {HelpNote} from '../ui/HelpTip.tsx';
import {REGISTRY_NODE} from './flat.ts';
import type {Workspace, Action} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import type {GraphRef} from './state.ts';
import {projectGraph, graphAction, editComment} from './projection.ts';
import {DetailPanel, DetailCategory, DetailRow, DetailFocus} from '../ui/details/DetailRow.tsx';
import {StateDetails} from '../ui/details/StateDetails.tsx';
import {assetLibrary} from '../assets.ts';
import {t} from '../i18n/index.ts';
import {switchPlaybackKind} from '../actionTypes.ts';
import {parseNodeId} from './nodeRef.ts';
import {tr} from '../i18n/korean.ts';
import {errorText} from '../errorText.ts';
export function GraphDetails({
  w,
  graph,
  node,
  edit,
  status,
  open,
  selectedAsset,
  onGlobalSettings,
}: {
  w: Workspace;
  graph: GraphRef;
  node: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  open: (g: GraphRef) => void;
  selectedAsset: string;
  onGlobalSettings: () => void;
}) {
  // Start, transition and condition cards (XML format 6) are edited on the card itself (unify ⑨).
  const ref = parseNodeId(node);
  if (ref.kind === 'startCard' || ref.kind === 'transition')
    return <p className="info-box">{tr('시작·전환 설정은 캔버스의 카드에서 편집합니다.')}</p>;
  // A condition card's conditions are edited on the card itself (AGENTS: AND/OR and NOT inside the card).
  if (ref.kind === 'conditionCard') return <p className="info-box">{tr('조건은 캔버스의 카드에서 편집합니다.')}</p>;
  const visual = projectGraph(w, graph).nodes.find(n => n.id === node);
  const a = graph.kind === 'root' ? w.actions.find(a => a.uid === node) : graphAction(w, graph);
  const kind = visual?.kind;
  const change = (next: Action) => edit(w => putAction(w, next));
  // The registry node edits in place on the graph; it has no details of its own.
  if (node === REGISTRY_NODE) return <p className="info-box">{t('graph.registryHint')}</p>;
  if (!visual) return <p className="info-box">{t('graph.selectNode')}</p>;
  if (kind === 'comment')
    return (
      <DetailPanel>
        <DetailCategory title={t('graph.comment')} initialOpen>
          <DetailRow id="name">
            <textarea
              maxLength={4096}
              value={visual.summary}
              onChange={e => edit(w => editComment(w, graph, node, e.target.value))}
            />
          </DetailRow>
        </DetailCategory>
      </DetailPanel>
    );
  if (kind === 'transition')
    return (
      <DetailPanel>
        <DetailCategory title={t('node.transition')} initialOpen>
          <p>{visual.summary}</p>
          <button onClick={() => visual.open && open(visual.open)}>{t('graph.openRule')}</button>
        </DetailCategory>
      </DetailPanel>
    );
  if (kind === 'entry') return <HelpNote label={t('node.entry')}>{t('graph.entryHint')}</HelpNote>;
  if (!a) return <p>{t('graph.selectNode')}</p>;
  if (graph.kind === 'anim' || graph.kind === 'root' || kind === 'stateCondition')
    return (
      <DetailFocus.Provider value={t('node.' + kind)}>
        <StateDetails
          action={a}
          w={w}
          change={change}
          edit={edit}
          switchKind={k => {
            try {
              const next = switchPlaybackKind(w, a.uid, k);
              edit(() => next);
            } catch (e) {
              status(errorText(e));
            }
          }}
          onGlobalSettings={onGlobalSettings}
          status={status}
          library={assetLibrary(w)}
          selectedAsset={assetLibrary(w).find(e => e.clip === selectedAsset)}
          stepId={visual.step ?? (graph.kind === 'anim' ? graph.step : undefined)}
        />
      </DetailFocus.Provider>
    );
  return <p>{t('graph.selectNode')}</p>;
}
