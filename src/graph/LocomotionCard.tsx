import {useContext, useEffect, useState} from 'react';
import type {Workspace} from '../workspace.ts';
import {
  TREE_KINDS,
  isBlockSet,
  isTreeFile,
  ladderSets,
  missingFeet,
  motionSpeed,
  offeredSets,
  removeLocomotion,
  setApplies,
  setExcept,
  setLabel,
  setTreeUse,
  treeFiles,
  treeUse,
  treeWeaponOf,
  type LadderSet,
  type Locomotion,
  type TreeFile,
  type TreeUse,
  type TreeWeapon,
} from '../locomotion.ts';
import {ChecklistContext} from './ChecklistCard.tsx';
import {DetailRow} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
import {errorText} from '../errorText.ts';
import {assetKey, selectAsset} from '../package.ts';
import {clipDurations, clipKey, useClipAnnotations} from './annotations.ts';
import * as io from '../io.ts';
import './registry.css';

// The graph renders only on-screen nodes: a ladder card brought into view mounts after the request, so a request
// stays for two seconds (as the registry's).
let pending = {set: '', time: 0};
/** Brings the ladder card into view and selects it; with a set, also opens that set's rows. */
export const showLocomotion = (set = '') => {
  pending = {set, time: Date.now()};
  window.dispatchEvent(new CustomEvent('ai-locomotion-flash', {detail: set}));
};

type Filter = 'all' | 'move' | 'block';

/** The locomotion card (docs/mockup-locomotion-follow: the event registry card's form): how the two weapon kinds with
 *  a borrowed tree move, and one line per weapon state with its check (off = <Except set>). A weapon's own set opens
 *  to its dedicated files. */
export function LocomotionBody() {
  const {w, edit} = useContext(ChecklistContext)!;
  const l = w.locomotion;
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<Filter>('all'),
    [open, setOpen] = useState<Set<string>>(new Set()),
    [error, setError] = useState('');
  // Only the locomotion object changes; the rest of the workspace is shared.
  const change = (fn: (w: {locomotion?: Locomotion}) => void) => {
    try {
      edit((w: Workspace) => {
        const next = {...w, locomotion: w.locomotion && structuredClone(w.locomotion)};
        fn(next);
        if (!next.locomotion) delete next.locomotion;
        return next;
      });
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    const reveal = (set: string) => {
      if (!set) return;
      setFilter('all');
      setQuery('');
      setOpen(s => new Set(s).add(set));
    };
    const listener = (e: Event) => reveal((e as CustomEvent<string>).detail);
    if (Date.now() - pending.time < 2000) reveal(pending.set);
    window.addEventListener('ai-locomotion-flash', listener);
    return () => window.removeEventListener('ai-locomotion-flash', listener);
  }, []);
  const offered = offeredSets(l);
  const applied = ladderSets(l);
  const shown = offered.filter(
    s =>
      (filter === 'all' || (filter === 'block') === isBlockSet(s)) &&
      (!query || `${s} ${setLabel(s)}`.toLowerCase().includes(query.toLowerCase()))
  );
  const files = (['2HW', 'H2H'] as const).flatMap(weapon => treeFiles(w, weapon)).filter(f => f.localPath).length;
  const toggle = (s: string) =>
    setOpen(o => {
      const next = new Set(o);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  return (
    <>
      <div className="card-start nodrag via">
        <span>
          {tr('전역')} · {tr('연결 없음')} · {tr('적용')} <b className="fn">{applied.length}</b> / {offered.length} ·{' '}
          {tr('전용 파일')} <b>{files}</b>
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
            aria-label={tr('세트 검색')}
            placeholder={tr('세트 검색')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select aria-label={tr('세트 거르기')} value={filter} onChange={e => setFilter(e.target.value as Filter)}>
            <option value="all">{tr('전체')}</option>
            <option value="move">{tr('이동')}</option>
            <option value="block">{tr('막기')}</option>
          </select>
        </div>
        <section className="checklist-section">
          <div className="checklist-section-title">
            <span
              className="help-tip-target"
              title={tr(
                '게임은 이동 선언을 SKSE/Plugins/AnimationInjector/Locomotion/Locomotion.xml 한 파일에서만 읽습니다. 여러 모드가 이 파일을 넣으면 모드 관리자에서 우선순위가 높은 모드의 파일 하나가 통째로 쓰입니다. 재생 빠르기는 캐릭터의 실제 속도를 따라가고, 걷기와 달리기는 서로 바꿀 때와 멈출 때만 섞입니다. 적을 숫자는 없습니다.'
              )}
            >
              <span className="help-tip-label">{tr('설정')}</span>
            </span>
          </div>
          <div className="registry-rows">
            <DetailRow
              label={tr('2HW 이동')}
              hint={tr(
                '양손 도끼·망치의 이동입니다. 2HM과 같게: 대검 이동을 그대로 씁니다. 2HW 전용 트리: 2HW_*.hkx 파일로 만든 2HM 구조의 트리를 씁니다(막기 이동 포함).'
              )}
            >
              <select
                aria-label={tr('2HW 이동')}
                value={treeUse(l, '2HW') ?? ''}
                onChange={e => change(w => setTreeUse(w, '2HW', (e.target.value || undefined) as TreeUse | undefined))}
              >
                <option value="">{tr('바닐라')}</option>
                <option value="2HM">{tr('2HM과 같게')}</option>
                <option value="own">{tr('2HW 전용 트리')}</option>
              </select>
            </DetailRow>
            <DetailRow
              label={tr('맨손 이동')}
              hint={tr(
                '맨손의 이동입니다. 1HM과 같게: 바닐라처럼 한손 무기와 같은 이동을 씁니다. 맨손 전용 트리: 그 이동을 복사해 맨손만 따로 쓰게 하고, H2H_*.hkx 파일이 있으면 그 파일을 재생합니다(막기 이동 포함). 전용 트리에서는 움직이는 동안 팔도 이동 애니메이션을 따릅니다(바닐라는 팔이 고정 자세입니다). 파일이 없는 방향은 한손 무기 애니메이션이 팔까지 재생됩니다.'
              )}
            >
              <select
                aria-label={tr('맨손 이동')}
                value={treeUse(l, 'H2H') ?? ''}
                onChange={e => change(w => setTreeUse(w, 'H2H', (e.target.value || undefined) as TreeUse | undefined))}
              >
                <option value="">{tr('1HM과 같게')}</option>
                <option value="own">{tr('맨손 전용 트리')}</option>
              </select>
            </DetailRow>
          </div>
        </section>
        <section className="checklist-section">
          <div className="checklist-section-title">
            <span
              className="help-tip-target"
              title={tr(
                '체크한 무기 상태에 적용합니다. 체크를 끄면 그 상태는 바닐라 그대로 움직입니다. 2HW·H2H와 그 막기 세트는 그 무기가 전용 트리일 때만 있습니다.'
              )}
            >
              <span className="help-tip-label">{tr('적용할 무기 상태')}</span>
            </span>{' '}
            <span className="section-count">
              {applied.length} / {offered.length}
            </span>
          </div>
          <div className="registry-rows">
            {shown.map(s => (
              <SetRow key={s} set={s} l={l} open={open.has(s)} toggle={() => toggle(s)} change={change} />
            ))}
          </div>
          <div className="checklist-add-actions">
            <div className="checklist-add-menu">
              <button className="danger" onClick={() => change(removeLocomotion)}>
                {tr('이동 선언 지우기')}
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

const GROUPS = ['walk', 'run', 'strafe'] as const;
const groupLabel = (g: TreeFile['group']) =>
  ({walk: tr('걷기'), run: tr('달리기'), strafe: tr('옆 달리기(strafe)')})[g];
/** The mod folder a source lies in (the folder above meshes/actors), else the file's own folder. */
const sourceFolder = (path: string) => {
  const parts = path.split(/[/\\]/);
  const at = parts.findIndex((p, i) => p.toLowerCase() === 'meshes' && parts[i + 1]?.toLowerCase() === 'actors');
  return (at > 0 ? parts[at - 1] : parts.at(-2)) ?? '';
};
const BACKSLASH = String.fromCharCode(92);

/** The files of a weapon's own tree (<Tree use="own">, locomotion.ts treeFiles), inside that weapon's set: which the
 *  runtime will find, the source of each, and whether it carries both foot annotations. The sources are HKX library
 *  entries, so the mod package copies them and an XML opened from its mod folder finds them. */
function TreeFiles({weapon}: {weapon: TreeWeapon}) {
  const {w, edit} = useContext(ChecklistContext)!;
  const files = treeFiles(w, weapon);
  const notes = useClipAnnotations(w);
  const [open, setOpen] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  if (!files.length) return null;
  const from = TREE_KINDS[weapon].from;
  const lengths = clipDurations(w);
  const feet = (f: TreeFile) => {
    const list = f.localPath ? notes.get(clipKey(f.clip)) : undefined;
    return list ? missingFeet(list) : undefined; // undefined: no source, or its annotations are not read
  };
  // The distance a second the file's step was made for (its animmotion annotations), when it carries them.
  const speed = (f: TreeFile) => {
    const list = f.localPath ? notes.get(clipKey(f.clip)) : undefined;
    return list ? motionSpeed(list, lengths.get(clipKey(f.clip)) ?? 0) : undefined;
  };
  const register = (found: {clip: string; path: string}[]) =>
    edit((w: Workspace) => found.reduce((next, f) => selectAsset(next, f.clip, f.path), w));
  const run = async (work: () => Promise<{text: string; error: boolean} | null>) => {
    setBusy(true);
    try {
      setMessage(await work());
    } catch (e) {
      setMessage({text: errorText(e), error: true});
    } finally {
      setBusy(false);
    }
  };
  const fromFolder = () =>
    run(async () => {
      const folder = await io.pickAssetRoot();
      if (!folder) return null;
      const base = folder.replace(/[/\\]+$/, '');
      // The folder itself (an animations folder) or a mod folder that holds meshes/actors/character/animations.
      const candidates = files.flatMap(f => [
        {clip: f.clip, path: [base, f.name].join(BACKSLASH)},
        {clip: f.clip, path: [base, 'meshes', 'actors', 'character', f.clip].join(BACKSLASH)},
      ]);
      const resolved = await io.resolveHkx(candidates.map(c => c.path));
      const found = candidates.filter(c =>
        resolved.some(r => !r.error && assetKey(r.path) === assetKey(c.path) && assetKey(r.clip) === assetKey(c.clip))
      );
      if (!found.length)
        return {
          text: tr(
            '그 폴더에서 {weapon} 파일을 찾지 못했습니다. 모드 폴더나 meshes/actors/character/animations 폴더를 고르세요.',
            {weapon}
          ),
          error: true,
        };
      register(found);
      return {text: tr('{weapon} 파일 {n}개를 등록했습니다.', {weapon, n: found.length}), error: false};
    });
  const fromFile = () =>
    run(async () => {
      const picked = await io.pickHkx();
      if (!picked) return null;
      if (!isTreeFile(picked.clip) || !files.some(f => assetKey(f.clip) === assetKey(picked.clip)))
        return {
          text: tr('{weapon} 전용 트리가 쓰는 파일이 아닙니다: {clip}', {weapon, clip: picked.clip}),
          error: true,
        };
      register([picked]);
      return null;
    });
  const toggle = (g: string) =>
    setOpen(o => {
      const next = new Set(o);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  return (
    <div className="locomotion-tree-files" data-tree-files={weapon}>
      <div className="checklist-section-title">
        <span
          className="help-tip-target"
          title={tr(
            '이 무기의 전용 트리가 재생하는 파일입니다. 게임은 meshes/actors/character/animations의 이 이름들을 찾고, 없는 파일은 같은 자리의 {from} 파일을 재생합니다. 발 박자와 발소리는 파일 안의 FootLeft·FootRight 주석을 씁니다. 파일에 이동 거리 주석(animmotion)이 있으면 그 거리와 시각으로 게임 속도에 맞춰 재생하고(괄호 안은 이 파일의 걸음이 1초에 가는 거리), 없으면 {from} 파일과 같은 걸음으로 보고 재생합니다. 등록한 파일은 모드 폴더로 내보낼 때 함께 복사됩니다.',
            {from}
          )}
        >
          <span className="help-tip-label">{tr('전용 파일')}</span>
        </span>{' '}
        <span className="section-count">
          {files.filter(f => f.localPath).length} / {files.length}
        </span>
      </div>
      <div className="registry-rows">
        {GROUPS.map(g => {
          const group = files.filter(f => f.group === g);
          const there = group.filter(f => f.localPath).length;
          const unsure = group.filter(f => feet(f)?.length).length;
          const moving = group.filter(f => speed(f) !== undefined).length;
          const isOpen = open.has(g);
          return (
            <div className={'checklist-row registry-row' + (isOpen ? ' open' : '')} key={g} data-tree-group={g}>
              <div className="checklist-row-heading">
                <button className="checklist-row-toggle" aria-expanded={isOpen} onClick={() => toggle(g)}>
                  <span>{groupLabel(g)}</span>
                  <small className="time registry-what">
                    <span className={unsure ? 'fn' : there ? '' : 'locomotion-file-none'}>
                      {tr('{n}개 중 {m}개', {n: group.length, m: there})}
                      {unsure > 0 && tr(' · 주석 확인 {n}', {n: unsure})}
                      {g !== 'strafe' && there > 0 && tr(' · 이동 거리 주석 {n}', {n: moving})}
                      {g === 'strafe' && tr(' · 쓰이지 않음')}
                    </span>
                  </small>
                </button>
              </div>
              {isOpen && (
                <div className="checklist-fields registry-fields locomotion-files">
                  {group.map(f => {
                    const lacks = feet(f);
                    const perSecond = speed(f);
                    return (
                      <div className="detail-row" key={f.clip} title={f.localPath || f.clip}>
                        <div className="detail-label-help">
                          <span className="detail-name">{f.name}</span>
                        </div>
                        <div className="detail-value">
                          {!f.localPath ? (
                            <span className="locomotion-file-none">{tr('없음 · {from} 파일 재생', {from})}</span>
                          ) : (
                            <span className={lacks?.length ? 'locomotion-file-warn' : ''}>
                              {lacks?.length ? (
                                tr('{names} 주석 없음', {names: lacks.join('·')})
                              ) : !lacks ? (
                                sourceFolder(f.localPath)
                              ) : (
                                <>
                                  {tr('발 주석 ✓')} ·{' '}
                                  {perSecond !== undefined ? (
                                    tr('이동 거리 주석 ✓ (초당 {speed})', {speed: perSecond.toFixed(1)})
                                  ) : (
                                    <span className="fn">
                                      {tr('이동 거리 주석 없음 · {from} 걸음으로 재생', {from})}
                                    </span>
                                  )}
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="checklist-add-actions">
        <div className="checklist-add-menu">
          <button type="button" disabled={busy} onClick={() => void fromFolder()}>
            {tr('+ 폴더에서 찾기')}
          </button>
          <button type="button" disabled={busy} onClick={() => void fromFile()}>
            {tr('+ 파일 고르기')}
          </button>
        </div>
      </div>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'checklist-error' : 'registry-empty'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function SetRow({
  set,
  l,
  open,
  toggle,
  change,
}: {
  set: LadderSet;
  l: Locomotion | undefined;
  open: boolean;
  toggle: () => void;
  change: (fn: (w: {locomotion?: Locomotion}) => void) => void;
}) {
  const {w} = useContext(ChecklistContext)!;
  const applies = setApplies(l, set);
  // A weapon's own set opens to its files; its block set plays the same files; the other sets have nothing to open.
  const weapon = treeWeaponOf(set);
  const own = weapon && TREE_KINDS[weapon].set === set ? weapon : undefined;
  const files = own ? treeFiles(w, own) : [];
  const what = !applies
    ? tr('제외 · 바닐라 그대로')
    : setLabel(set) +
      (own ? ' · ' + tr('전용 파일 {m}/{n}', {m: files.filter(f => f.localPath).length, n: files.length}) : '') +
      (weapon && !own ? ' · ' + tr('{weapon} 파일', {weapon}) : '');
  return (
    <div
      className={'checklist-row registry-row' + (open && own ? ' open' : '') + (applies ? '' : ' is-except')}
      data-ladder-set={set}
    >
      <div className="checklist-row-heading">
        <label className="locomotion-apply">
          <input
            type="checkbox"
            aria-label={tr('{set} 적용', {set})}
            checked={applies}
            onChange={e => change(w => setExcept(w, set, !e.target.checked))}
          />
        </label>
        {own ? (
          <button className="checklist-row-toggle" aria-expanded={open} onClick={toggle}>
            <span>{set}</span>
            <small className="time registry-what">
              <span className={applies ? 'fn' : 'locomotion-file-none'}>{what}</span>
            </small>
          </button>
        ) : (
          <button className="checklist-row-toggle locomotion-plain" tabIndex={-1}>
            <span>{set}</span>
            <small className="time registry-what">
              <span className={applies ? 'fn' : 'locomotion-file-none'}>{what}</span>
            </small>
          </button>
        )}
      </div>
      {open && own && <TreeFiles weapon={own} />}
    </div>
  );
}
