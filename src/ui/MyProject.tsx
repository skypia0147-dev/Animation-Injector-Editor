import {t, useLanguage} from '../i18n/index.ts';
import {functionSummary} from '../eventRegistry.ts';
const effectTitle = (e: {id: string; values: Record<string, string>}) =>
  functionSummary(e.values) + (e.values.at !== undefined ? ' · ' + e.values.at + tr('초') : '');
import {inputLabel, type Issue} from '../model.ts';
import type {Workspace} from '../workspace.ts';
import {clipEffects} from '../clipEffects.ts';
import {gamepadXml, gameControlLabel} from '../keys.ts';
import {memo, useMemo, useRef, useState} from 'react';
import {markerUseCounts} from './details/markerCatalog.ts';
import {FolderTree, TreeFolder} from './FolderTree.tsx';
import {Icon} from '../EditorChrome.tsx';
import {shareUnchanged} from '../graph/historySharing.ts';
import {tr} from '../i18n/korean.ts';

// The tree redraws per row and per folder: an edit redraws the rows it changed (the rendered document keeps
// unchanged actions as the same objects, WorkspaceApp), and the selection redraws the rows it enters or leaves.
type Action = Workspace['actions'][number];
type Link = Workspace['links'][number];
const matcher = (q: string) => (s: string) => !q || s.toLowerCase().includes(q);
/** `value`, keeping the parts equal to the previous render's value as those objects. */
function useShared<T>(value: T): T {
  const previous = useRef<T | undefined>(undefined);
  const shared = previous.current === undefined ? value : shareUnchanged(previous.current, value);
  previous.current = shared;
  return shared;
}

const NO_NAMES = new Map<string, string>();
/** What a row shows about its action (10-20, docs/mockup-ux-polish ⑩): its kind by icon, how it starts, and
 *  whether the check found a problem in it. */
type Kind = 'pair' | 'single' | 'selecting';
const kindOf = (a: Action): Kind => (a.pair ? 'pair' : 'single');
const kindIcon = {pair: 'pair', single: 'play', selecting: 'branch'} as const;
const kindLabel = (k: Kind) => (k === 'pair' ? tr('페어') : k === 'selecting' ? tr('고르기 전용') : tr('일반 동작'));
type Problem = 'error' | 'warning' | undefined;
/** How an action starts by itself, as text the memoized row can compare: 'key:G', 'event:Name', or ''. */
function startOf(w: Workspace, a: Action): string {
  const start = w.starts.find(s => s.to && 'action' in s.to && s.to.action === a.uid);
  if (!start) return '';
  if (start.mode === 'input') {
    const key = start.control
      ? gameControlLabel(start.control)
      : start.key || (start.gamepad ? gamepadXml(start.gamepad) : '');
    return key ? 'key:' + key : '';
  }
  return 'event:' + start.event;
}
function StartBadge({start}: {start: string}) {
  const value = start.slice(start.indexOf(':') + 1);
  if (start.startsWith('key:')) return <kbd title={tr('키 {key}', {key: value})}>{value}</kbd>;
  if (start.startsWith('event:'))
    return (
      <span className="tree-start-event" title={tr('이벤트 {v0}', {v0: value || tr('미지정')})}>
        <Icon name="event" size={12} />
      </span>
    );
  return null;
}
const ActionRow = memo(function ActionRow({
  a,
  links: allLinks,
  names,
  q,
  selection,
  selectedClip,
  select,
  selectClip,
  onOpenEffect,
  onOpenGraph,
  start,
  problem,
}: {
  start: string;
  problem: Problem;
  a: Action;
  links: Link[];
  /** The names of the actions this action's links go to, by uid (the link labels). */
  names: Map<string, string>;
  q: string;
  /** The selection when it is this action or one of its links, else ''. */
  selection: string;
  selectedClip?: string;
  select: (id: string) => void;
  selectClip?: (action: string, step: string) => void;
  onOpenEffect: (action: string, effect: string) => void;
  onOpenGraph: (action: string) => void;
}) {
  useLanguage();
  const match = matcher(q);
  const linkLabel = (l: Link) => {
    const via =
      l.mode === 'end'
        ? tr('끝나면')
        : l.mode === 'move'
          ? tr('이동키를 누르면')
          : l.mode === 'release'
            ? tr('키를 떼면')
            : l.mode === 'event'
              ? l.event || t('row.marker')
              : inputLabel(a.config, l.input) || t('row.input');
    return `→ ${names.get(l.to) ?? l.to} · ${via}`;
  };
  const actionMatch = match(a.config.name + ' ' + a.config.actionId);
  const effects = clipEffects(a).filter(e => actionMatch || match(effectTitle(e)));
  const links = allLinks.filter(l => l.from === a.uid && (actionMatch || match(linkLabel(l))));
  if (!actionMatch && !effects.length && !links.length) return null;
  const kind = kindOf(a);
  const item = (
    <button
      type="button"
      className={'tree-entry tree-action' + (selection === a.uid ? ' on' : '') + (problem ? ' has-' + problem : '')}
      onClick={() => select(a.uid)}
      onDoubleClick={() => onOpenGraph(a.uid)}
      data-testid={'tree-state-' + a.uid}
      title={a.config.name}
    >
      <i className="tree-kind" title={kindLabel(kind)}>
        <Icon name={kindIcon[kind]} size={14} />
      </i>
      <span className="tree-name">{a.config.name}</span>
      {problem && (
        <i className={'tree-problem ' + problem} aria-label={problem === 'error' ? tr('오류 있음') : tr('경고 있음')} />
      )}
      <StartBadge start={start} />
    </button>
  );
  if (!effects.length && !links.length && a.config.steps.length <= 1) return <div className="tree-leaf">{item}</div>;
  return (
    <TreeFolder folderKey={'action:' + a.uid} label={a.config.name} item={item} forceOpen={!!q}>
      {a.config.steps.length > 1 && (
        <TreeFolder
          folderKey={'clips:' + a.uid}
          label={tr('HKX 재생')}
          count={a.config.steps.length}
          defaultOpen
          forceOpen={!!q}
        >
          {a.config.steps.map(s => (
            <button
              key={s.id}
              type="button"
              className={'tree-entry' + (selection === a.uid && selectedClip === s.id ? ' on' : '')}
              onClick={() => selectClip?.(a.uid, s.id)}
              title={s.clip || s.label}
            >
              <Icon name="play" size={14} />
              <span>{s.clip.split(/[\\/]/).at(-1) || s.label}</span>
            </button>
          ))}
        </TreeFolder>
      )}
      {!!effects.length && (
        <TreeFolder
          folderKey={'effects:' + a.uid}
          label={tr('이벤트 기능')}
          count={effects.length}
          defaultOpen
          forceOpen={!!q}
        >
          {effects.map(e => (
            <button
              type="button"
              key={e.id}
              className="tree-entry"
              onClick={() => onOpenEffect(a.uid, e.id)}
              title={effectTitle(e)}
            >
              <Icon name="event" size={14} />
              <span>{effectTitle(e)}</span>
            </button>
          ))}
        </TreeFolder>
      )}
      {!!links.length && (
        <TreeFolder
          folderKey={'links:' + a.uid}
          label={tr('연결 동작')}
          count={links.length}
          defaultOpen
          forceOpen={!!q}
        >
          {links.map(l => (
            <button
              type="button"
              key={l.id}
              className={'tree-entry' + (selection === l.id ? ' on' : '')}
              onClick={() => select(l.id)}
              title={linkLabel(l)}
            >
              <Icon name="branch" size={14} />
              <span>{linkLabel(l)}</span>
            </button>
          ))}
        </TreeFolder>
      )}
    </TreeFolder>
  );
});

type InputEntry = {input: Workspace['sharedInputs'][number]; owner: string; ownerName: string; ref: string};
const InputFolder = memo(function InputFolder({
  inputs,
  q,
  selected,
  onOpenInputs,
}: {
  inputs: InputEntry[];
  q: string;
  selected: string;
  onOpenInputs: (id?: string) => void;
}) {
  useLanguage();
  const match = matcher(q);
  return (
    <TreeFolder
      folderKey="inputs"
      label={t('myProject.inputs')}
      count={inputs.length}
      forceOpen={!!q}
      onAdd={() => onOpenInputs()}
      addLabel={t('menu.project.addInput')}
    >
      {inputs
        .filter(({input: i, ownerName}) => match(i.label + ' ' + i.key + ' ' + ownerName))
        .map(({input: i, owner, ref}) => (
          <button
            type="button"
            key={ref}
            className={'tree-entry' + (selected === ref ? ' on' : '')}
            onClick={() => onOpenInputs(ref)}
            title={i.label + ' · ' + i.key}
            draggable
            onDragStart={e =>
              e.dataTransfer.setData(
                'application/aie-resource',
                JSON.stringify({kind: 'input', id: i.id, ...(owner ? {action: owner} : {})})
              )
            }
          >
            <Icon name="entry" size={14} />
            <span>{i.label}</span>
            <kbd>{i.control ? gameControlLabel(i.control) : i.key || (i.gamepad ? 'pad ' + i.gamepad : '')}</kbd>
          </button>
        ))}
    </TreeFolder>
  );
});

const MarkerFolder = memo(function MarkerFolder({
  markers,
  q,
  selected,
  onOpenMarker,
}: {
  /** Event names and use counts, sorted by name. */
  markers: [string, number][];
  q: string;
  selected: string;
  onOpenMarker: (name?: string) => void;
}) {
  useLanguage();
  const match = matcher(q);
  return (
    <TreeFolder
      folderKey="events"
      label={t('myProject.markers')}
      count={markers.length}
      forceOpen={!!q}
      onAdd={() => onOpenMarker()}
      addLabel={t('menu.project.addMarker')}
    >
      {markers
        .filter(([n]) => match(n))
        .map(([n, count]) => (
          <button
            type="button"
            key={n}
            className={'tree-entry' + (selected === n ? ' on' : '')}
            onClick={() => onOpenMarker(n)}
            title={n}
            draggable
            onDragStart={e =>
              e.dataTransfer.setData('application/aie-resource', JSON.stringify({kind: 'marker', name: n}))
            }
          >
            <Icon name="event" size={14} />
            <span>{n}</span>
            <small>{count}</small>
          </button>
        ))}
    </TreeFolder>
  );
});

const ParameterFolder = memo(function ParameterFolder({
  parameters,
  q,
  selected,
  onOpenParameters,
}: {
  parameters: Workspace['parameters'];
  q: string;
  selected: string;
  onOpenParameters: (id?: string) => void;
}) {
  useLanguage();
  const match = matcher(q);
  return (
    <TreeFolder
      folderKey="parameters"
      label={t('myProject.sharedSettings')}
      count={parameters.length}
      forceOpen={!!q}
      onAdd={() => onOpenParameters()}
      addLabel={t('myProject.sharedSettings')}
    >
      {parameters
        .filter(p => match(p.label))
        .map(p => (
          <button
            type="button"
            key={p.id}
            className={'tree-entry' + (selected === p.id ? ' on' : '')}
            onClick={() => onOpenParameters(p.id)}
            title={p.label}
          >
            <Icon name="settings" size={14} />
            <span>{p.label}</span>
          </button>
        ))}
    </TreeFolder>
  );
});

function MyProjectPanel({
  w,
  selection,
  selectedResource,
  search,
  setSearch,
  select,
  selectClip,
  selectedClip,
  onAddState,
  onOpenInputs,
  onOpenParameters,
  onOpenProject,
  onOpenMarker,
  onOpenEffect,
  onOpenGraph,
  searchRef,
  issues,
}: {
  w: Workspace;
  selection: string;
  selectedResource: string;
  search: string;
  setSearch: (s: string) => void;
  select: (id: string) => void;
  selectClip?: (action: string, step: string) => void;
  selectedClip?: string;
  onAddState: () => void;
  onOpenInputs: (id?: string) => void;
  onOpenParameters: (id?: string) => void;
  onOpenProject: () => void;
  onOpenMarker: (name?: string) => void;
  onOpenEffect: (action: string, effect: string) => void;
  onOpenGraph: (action: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  issues: Issue[];
}) {
  useLanguage();
  const q = search.trim().toLowerCase();
  // The worst problem per action, the same map while it is the same (the rows are memoized).
  const problems = useShared(
    useMemo(() => {
      const m: Record<string, 'error' | 'warning'> = {};
      for (const i of issues) if (m[i.node] !== 'error') m[i.node] = i.level;
      return m;
    }, [issues])
  );
  const [only, setOnly] = useState<'all' | 'problem' | 'pair'>('all');
  const problemCount = w.actions.filter(a => problems[a.uid]).length,
    pairCount = w.actions.filter(a => kindOf(a) === 'pair').length;
  const shown = only === 'all' || (only === 'problem' && !problemCount) ? 'all' : only;
  // Rebuilt per document, kept as the same objects while equal so the folders skip their render.
  const markers = useShared(useMemo(() => [...markerUseCounts(w)], [w]));
  const inputs = useShared(
    useMemo(
      (): InputEntry[] => [
        ...w.sharedInputs.map(i => ({input: i, owner: '', ownerName: '', ref: 'shared:' + i.id})),
        ...w.actions.flatMap(a =>
          a.config.inputs
            .filter(i => !w.sharedInputs.some(s => s.id === i.id))
            .map(i => ({input: i, owner: a.uid, ownerName: a.config.name, ref: a.uid + ':' + i.id}))
        ),
      ],
      [w.sharedInputs, w.actions]
    )
  );
  // Keyed by the names alone: an edit inside an action keeps the map, and the other rows with it.
  const namesKey = w.actions.map(a => a.uid + '\u0000' + a.config.name).join('\u0001');
  const names = useMemo(() => new Map(w.actions.map(a => [a.uid, a.config.name])), [namesKey]);
  const linkOwner = useMemo(() => new Map(w.links.map(l => [l.id, l.from])), [w.links]);
  // Each row gets only the names its own links show, the same map while they are the same: typing a name
  // redraws that action's row and the rows linking to it, not every row.
  const rowNames = useRef(new Map<string, {key: string; value: Map<string, string>}>());
  const namesFor = (uid: string) => {
    const targets = w.links.filter(l => l.from === uid && names.has(l.to)).map(l => l.to);
    if (!targets.length) return NO_NAMES;
    const key = targets.map(to => to + '\u0000' + names.get(to)).join('\u0001'),
      known = rowNames.current.get(uid);
    if (known?.key === key) return known.value;
    const value = new Map(targets.map(to => [to, names.get(to)!]));
    rowNames.current.set(uid, {key, value});
    return value;
  };
  return (
    <div className="myproject" data-testid="my-project">
      <input
        ref={searchRef}
        className="dock-search"
        aria-label={t('toolbar.find')}
        placeholder={t('myProject.searchPlaceholder')}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {w.actions.length > 0 && (
        <div className="tree-filters" role="group" aria-label={tr('동작 거르기')}>
          <button type="button" aria-pressed={shown === 'all'} onClick={() => setOnly('all')}>
            {tr('전체 {n}', {n: w.actions.length})}
          </button>
          {problemCount > 0 && (
            <button
              type="button"
              className="problem"
              aria-pressed={shown === 'problem'}
              onClick={() => setOnly(shown === 'problem' ? 'all' : 'problem')}
            >
              <i className="tree-problem error" /> {tr('문제 {n}', {n: problemCount})}
            </button>
          )}
          {pairCount > 0 && (
            <button
              type="button"
              aria-pressed={shown === 'pair'}
              onClick={() => setOnly(shown === 'pair' ? 'all' : 'pair')}
            >
              {tr('페어 {n}', {n: pairCount})}
            </button>
          )}
        </div>
      )}
      <FolderTree key={w.id}>
        <TreeFolder
          folderKey="project"
          label={w.name}
          defaultOpen
          forceOpen={!!q}
          item={
            <button
              type="button"
              className={'tree-entry tree-project' + (selection === 'project' ? ' on' : '')}
              onClick={onOpenProject}
              data-testid="tree-root"
              title={t('myProject.rootGraph')}
            >
              <Icon name="folder" size={16} />
              <span>{w.name}</span>
            </button>
          }
        >
          <TreeFolder
            folderKey="actions"
            label={tr('동작')}
            count={w.actions.length}
            defaultOpen
            forceOpen={!!q}
            onAdd={onAddState}
            addLabel={t('node.hkxPlay') + tr(' 추가')}
          >
            {w.actions.map(a => {
              if (shown === 'problem' && !problems[a.uid]) return null;
              if (shown === 'pair' && kindOf(a) !== 'pair') return null;
              const own = selection === a.uid || linkOwner.get(selection) === a.uid;
              return (
                <ActionRow
                  key={a.uid}
                  start={startOf(w, a)}
                  problem={problems[a.uid]}
                  a={a}
                  links={w.links}
                  names={namesFor(a.uid)}
                  q={q}
                  selection={own ? selection : ''}
                  selectedClip={selection === a.uid ? selectedClip : undefined}
                  select={select}
                  selectClip={selectClip}
                  onOpenEffect={onOpenEffect}
                  onOpenGraph={onOpenGraph}
                />
              );
            })}
          </TreeFolder>
          <InputFolder
            inputs={inputs}
            q={q}
            selected={selection === 'inputs' ? selectedResource : ''}
            onOpenInputs={onOpenInputs}
          />
          <MarkerFolder
            markers={markers}
            q={q}
            selected={selection === 'markers' ? selectedResource : ''}
            onOpenMarker={onOpenMarker}
          />
          <ParameterFolder
            parameters={w.parameters}
            q={q}
            selected={selection === 'parameters' ? selectedResource : ''}
            onOpenParameters={onOpenParameters}
          />
        </TreeFolder>
      </FolderTree>
    </div>
  );
}
// Memoized: the app shell re-renders for state this panel does not use.
export const MyProject = memo(MyProjectPanel);
