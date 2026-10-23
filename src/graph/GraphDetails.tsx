import {HelpNote} from '../ui/HelpTip.tsx';
import {REGISTRY_NODE} from './flat.ts';
import type {Workspace, Action} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import type {GraphRef} from './state.ts';
import {projectGraph, graphAction, editComment} from './projection.ts';
import {DetailPanel, DetailCategory, DetailRow, DetailFocus} from '../ui/details/DetailRow.tsx';
import {StateDetails} from '../ui/details/StateDetails.tsx';
import {TransitionDetails} from '../ui/details/TransitionDetails.tsx';
import {Property as Prop} from '../ui/details/Property.tsx';
import {WindowFields} from '../ui/details/ClipWindowFields.tsx';
import {EventPicker} from '../ui/details/EventPicker.tsx';
import {markerNames} from '../ui/details/markerCatalog.ts';
import {KeyField} from '../ui/details/KeyField.tsx';
import {assetLibrary} from '../assets.ts';
import {t} from '../i18n/index.ts';
import {updateSharedInput} from '../sharedSettings.ts';
import {switchPlaybackKind} from '../actionTypes.ts';
import {labelText} from '../labels.ts';
import {sharesSourceWindow} from './playback.ts';
import {sourceWindow} from './clipWindows.ts';
import {tr} from '../i18n/korean.ts';
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
              status(String(e));
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
  const p = a.config;
  const l = graph.kind === 'link' ? w.links.find(l => l.id === graph.link) : undefined;
  const rule = l;
  const patchRule = (patch: Record<string, unknown>) => {
    if (l)
      edit(w => {
        w.links = w.links.map(x => (x.id === l.id ? {...x, ...patch} : x));
        return w;
      });
    else change({...a, config: {...p, start: {...p.start, ...patch}}});
  };
  if (kind === 'result' && l)
    return (
      <DetailFocus.Provider value={t('node.result')}>
        <TransitionDetails
          w={w}
          l={l}
          change={next =>
            edit(w => {
              w.links = w.links.map(x => (x.id === l.id ? next : x));
              return w;
            })
          }
        />
      </DetailFocus.Provider>
    );
  const input = p.inputs.find(i => i.id === (rule?.input ?? p.start.input));
  const setInput = (key: string, gamepad: number) => {
    if (!input) return;
    const next = {...input, key, gamepad};
    if (w.sharedInputs.some(i => i.id === input.id)) edit(w => updateSharedInput(w, next));
    else change({...a, config: {...p, inputs: p.inputs.map(i => (i.id === input.id ? next : i))}});
  };
  return (
    <DetailPanel>
      <DetailCategory title={t('node.' + kind)} initialOpen>
        {kind === 'keyInput' && (
          <>
            <Prop
              id="input"
              value={input?.id ?? ''}
              change={input => patchRule({input})}
              options={[['', t('graph.chooseInput')], ...p.inputs.map(i => [i.id, i.label] as [string, string])]}
            />
            {input && (
              <DetailRow id="input">
                <KeyField
                  value={input.key}
                  gamepad={input.gamepad}
                  change={key => setInput(key, input.gamepad)}
                  changeGamepad={gamepad => setInput(input.key, gamepad)}
                />
              </DetailRow>
            )}
            {graph.kind === 'start' && (
              <>
                <Prop id="onRelease" value={p.start.onKeyUp} change={onKeyUp => patchRule({onKeyUp})} />
              </>
            )}
          </>
        )}
        {kind === 'markerReceive' && (
          <>
            <Prop id="marker" value={l?.event ?? p.start.event} change={event => patchRule({event})}>
              <EventPicker
                label={labelText('marker')}
                value={l?.event ?? p.start.event}
                events={markerNames(w)}
                change={event => patchRule({event})}
              />
            </Prop>
            {graph.kind === 'start' && (
              <Prop
                id="sender"
                value={p.start.actor}
                change={actor => patchRule({actor})}
                options={['player', 'npc', 'both'].map(v => [v, t('detail.' + v)])}
              />
            )}
          </>
        )}
        {/* Off: the whole clip (no <Window>, format 4). A key transition sharing its HKX's window has none of its own. */}
        {['keyInput', 'markerReceive', 'detectionWindow'].includes(kind!) &&
          l &&
          (l.mode === 'event' || !sharesSourceWindow(w, l) || l.ownWindow) && (
            <Prop
              id="enabled"
              label={tr('감지 구간 사용')}
              value={l.window}
              hint={tr('끄면 클립 전체에서 받습니다(XML에 Window를 쓰지 않음).')}
              change={window => patchRule({window})}
            >
              <label>
                <input type="checkbox" checked={l.window} onChange={e => patchRule({window: e.target.checked})} />
                {t('node.detectionWindow')}
              </label>
            </Prop>
          )}
        {l && ['keyInput', 'detectionWindow'].includes(kind!) && sharesSourceWindow(w, l) && (
          <Prop
            id="mode"
            label={tr('감지 구간')}
            hint={tr(
              '이 HKX 공통: 출발 HKX의 입력 감지를 이 HKX의 다른 키 전환과 함께 씁니다. 이 전환만: 이 전환의 열림·닫힘을 따로 둡니다.'
            )}
            value={l.ownWindow ? 'own' : 'shared'}
            options={[
              ['shared', tr('이 HKX 공통')],
              ['own', tr('이 전환만')],
            ]}
            change={v =>
              edit(w => {
                w.links = w.links.map(x => {
                  if (x.id !== l.id) return x;
                  const {ownWindow, ...rest} = x;
                  return v === 'own'
                    ? {
                        ...rest,
                        ownWindow: true,
                        window: true,
                        ...structuredClone(sourceWindow(a, a.config.entry).value),
                      }
                    : rest;
                });
                return w;
              })
            }
          />
        )}
        {['keyInput', 'markerReceive', 'detectionWindow'].includes(kind!) &&
          rule &&
          (l ? l.window && (!sharesSourceWindow(w, l) || l.ownWindow) : !a.nodeAuthored) && (
            // The window as the other clip-time items (docs/mockup-clip-bar): a transition between actions closes after
            // its start or at the end, an action's own key window after its start.
            <WindowFields
              w={w}
              action={l ? w.actions.find(x => x.uid === l.from) : a}
              value={{open: rule.open, close: rule.close, buffered: rule.buffered}}
              events={markerNames(w)}
              closeBasis={l ? 'either' : 'seconds'}
              change={next => patchRule(next)}
            />
          )}
        {kind === 'keyInput' && l && sharesSourceWindow(w, l) && !l.ownWindow && (
          <HelpNote label={tr('감지 구간')}>{tr('감지 구간과 선입력은 출발 HKX 재생 카드에서 설정하세요.')}</HelpNote>
        )}
        {/* A transition's attacker and victim destinations: the "연결" section above (graph/pinTargets.ts). */}
        {kind === 'result' && <HelpNote label={tr('전환 설정')}>{t('graph.resultHint')}</HelpNote>}
      </DetailCategory>
    </DetailPanel>
  );
}
