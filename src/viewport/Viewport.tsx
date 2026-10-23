import {viewerHelp} from './cameraControls.ts';
import {HelpTip} from '../ui/HelpTip.tsx';
import {useEffect, useMemo, useState, useRef} from 'react';
import {Icon} from '../EditorChrome.tsx';
import {t, useLanguage} from '../i18n/index.ts';
import type {PreviewAssets} from '../workspace.ts';
import type {ViewerLoadState} from './adapter.ts';
import type {ActorView, ViewOptions, ViewPreset} from './ViewportScene.tsx';
import {CAMERA_BONE} from './ViewportScene.tsx';
import type {Person} from '../view.ts';
import {lazy, Suspense} from 'react';
import {tr} from '../i18n/korean.ts';
const ViewportScene = lazy(() => import('./ViewportScene.tsx').then(m => ({default: m.ViewportScene})));

const OPTIONS_KEY = 'aieditor-viewport-v1';
/** The view of a first-person preview is kept apart: it starts through the first-person camera. */
type StoredOptions = ViewOptions & {firstPreset: ViewPreset};
const defaults: StoredOptions = {
  skeleton: true,
  skin: true,
  rootMotion: true,
  trajectory: false,
  actor: 'both',
  preset: 'perspective',
  firstPreset: 'camera',
};
const loadOptions = (): StoredOptions => {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? {...defaults, ...saved} : defaults;
  } catch {
    return defaults;
  }
};
const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

export function Viewport({
  clip,
  path,
  person = 'third',
  choosePerson,
  pairExpected,
  resources,
  skinPaths,
  viewer,
  frame,
  time,
  playing,
  play,
  pause,
  stop,
  reload,
  pick,
  clear,
}: {
  clip: string;
  path: string;
  /** The person the preview shows (view.ts): a first-person action shows its _1stPerson copy. */
  person?: Person;
  /** A `both` action: switch the previewed person. */
  choosePerson?: (person: Person) => void;
  pairExpected: boolean;
  resources: PreviewAssets;
  skinPaths: string[];
  viewer: ViewerLoadState;
  frame: number;
  time: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  stop: () => void;
  reload: () => void;
  pick: (kind: 'skeletons' | 'skins', actor: number) => void;
  clear: (kind: 'skeletons' | 'skins', actor: number) => void;
}) {
  useLanguage();
  const optionsMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (optionsMenu.current && !optionsMenu.current.contains(e.target as Node)) optionsMenu.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const [options, setOptions] = useState(loadOptions),
    [cameraCommand, setCameraCommand] = useState<{serial: number; kind: 'fit' | 'home'}>(),
    [assetsOpen, setAssetsOpen] = useState(false),
    [sceneError, setSceneError] = useState(''),
    [skinStatus, setSkinStatus] = useState<string[]>([]);
  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      /* View settings are optional. */
    }
  }, [options]);
  useEffect(() => {
    setSceneError('');
    setSkinStatus([]);
  }, [viewer.key]);
  useEffect(() => {
    if (viewer.error) setAssetsOpen(true);
  }, [viewer.error]);
  const setToggle = (key: 'skeleton' | 'skin' | 'rootMotion' | 'trajectory') =>
    setOptions(value => ({...value, [key]: !value[key]}));
  const actorCount = pairExpected || viewer.data?.paired ? 2 : 1;
  // The first-person camera needs the first-person skeleton's camera bone; otherwise the orbit view.
  const hasCamera = !!viewer.data?.actors[0]?.bones.some(bone => bone.name === CAMERA_BONE),
    presetKey = person === 'first' ? 'firstPreset' : 'preset',
    stored = options[presetKey],
    preset: ViewPreset = stored === 'camera' && !hasCamera ? 'perspective' : stored;
  const visibleOptions = useMemo(
    (): ViewOptions => ({
      skeleton: options.skeleton,
      skin: options.skin,
      rootMotion: options.rootMotion,
      trajectory: options.trajectory,
      actor: viewer.data?.paired ? options.actor : ('both' as ActorView),
      preset,
    }),
    [options, viewer.data?.paired, preset]
  );
  const emptyMessage = !clip ? t('viewport.noClip') : !path ? t('viewport.noSource') : '';
  return (
    <div
      className="viewport"
      data-testid="viewport"
      data-state={viewer.loading ? 'loading' : viewer.error ? 'error' : viewer.data ? 'ready' : 'idle'}
    >
      <div className="viewport-toolbar" role="toolbar" aria-label={t('panel.viewport')}>
        <button
          aria-label={t('viewport.play')}
          title={t('viewport.play')}
          onClick={play}
          disabled={!viewer.data || playing}
        >
          <Icon name="play" size={16} />
        </button>
        <button aria-label={t('viewport.pause')} title={t('viewport.pause')} onClick={pause} disabled={!playing}>
          <Icon name="pause" size={16} />
        </button>
        <button
          aria-label={t('viewport.stop')}
          title={t('viewport.stop')}
          onClick={stop}
          disabled={!viewer.data && time === 0}
        >
          <Icon name="stop" size={16} />
        </button>
        {choosePerson ? (
          <select
            className="viewport-person"
            aria-label={t('viewport.person')}
            title={t('viewport.person')}
            value={person}
            onChange={event => choosePerson(event.target.value as Person)}
          >
            <option value="third">{t('view.third')}</option>
            <option value="first">{t('view.first')}</option>
          </select>
        ) : (
          person === 'first' && <span className="viewport-person">{t('view.first')}</span>
        )}
        <span className="viewport-frame" data-testid="viewport-frame">
          {t('viewport.frame', {frame: viewer.data ? frame + 1 : 0, total: viewer.data?.frameCount ?? 0})} ·{' '}
          {time.toFixed(3)} s
        </span>
        <details
          className="viewport-options"
          ref={optionsMenu}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              optionsMenu.current!.open = false;
              optionsMenu.current?.querySelector('summary')?.focus();
            }
          }}
        >
          <summary aria-label={tr('미리보기 표시 설정')} title={tr('미리보기 표시 설정')}>
            <Icon name="settings" size={18} />
          </summary>
          <div className="viewport-options-body" role="group" aria-label={tr('미리보기 표시 설정')}>
            <span className="viewport-options-title">{tr('표시 옵션')}</span>
            {(['skeleton', 'skin', 'rootMotion', 'trajectory'] as const).map(key => (
              <button
                key={key}
                className={'viewport-toggle' + (options[key] ? ' active' : '')}
                aria-pressed={options[key]}
                onClick={() => setToggle(key)}
              >
                {t('viewport.' + key)}
              </button>
            ))}
            <label>
              <span>{t('viewport.view')}</span>
              <select
                aria-label={t('viewport.view')}
                value={preset}
                onChange={event => setOptions(value => ({...value, [presetKey]: event.target.value as ViewPreset}))}
              >
                {(['perspective', 'front', 'back', 'left', 'right', 'top', 'camera'] as const)
                  .filter(value => value !== 'camera' || hasCamera)
                  .map(value => (
                    <option value={value} key={value}>
                      {t('viewport.' + value)}
                    </option>
                  ))}
              </select>
            </label>
            {viewer.data?.paired && (
              <select
                aria-label={t('role.both')}
                value={options.actor}
                onChange={event => setOptions(value => ({...value, actor: event.target.value as ActorView}))}
              >
                <option value="me">{t('role.me')}</option>
                <option value="partner">{t('role.partner')}</option>
                <option value="both">{t('role.both')}</option>
              </select>
            )}
            <button aria-label={t('viewport.reload')} title={t('viewport.reload')} onClick={reload} disabled={!path}>
              ↻
            </button>
            <button
              className={'viewport-assets-button' + (assetsOpen ? ' active' : '')}
              aria-expanded={assetsOpen}
              onClick={() => setAssetsOpen(value => !value)}
            >
              {t('viewport.assets')}
            </button>
          </div>
        </details>
      </div>
      {/* Scene above, the asset list under it when open, then one line with the controls help and the camera
          buttons (docs/mockup-layout-audit ④): a short panel scrolls the list instead of stacking them. */}
      <div className={'viewport-stage' + (assetsOpen ? ' assets-open' : '')}>
        <div className="viewport-main">
          {viewer.data && !sceneError ? (
            <Suspense
              fallback={
                <div className="viewport-message" role="status">
                  {tr('3D 뷰어 준비 중…')}
                </div>
              }
            >
              <ViewportScene
                cameraCommand={cameraCommand}
                data={viewer.data}
                frame={frame}
                options={visibleOptions}
                skinPaths={skinPaths}
                onSceneError={setSceneError}
                onSkinStatus={setSkinStatus}
              />
            </Suspense>
          ) : (
            <div className={'viewport-message' + (viewer.error || sceneError ? ' error' : '')} role="status">
              {viewer.loading ? t('viewport.loading') : sceneError || viewer.error || emptyMessage}
            </div>
          )}
          {skinStatus.length > 0 && (
            <div className="viewport-warning" role="status">
              {skinStatus.join('\n')}
            </div>
          )}
        </div>
        {assetsOpen && (
          <div className="viewport-assets" data-testid="viewport-assets">
            <b>{clip || t('viewport.noClip')}</b>
            {Array.from({length: actorCount}, (_, actor) => (
              <div className="viewport-asset-row" key={actor}>
                <strong>A{actor + 1}</strong>
                {(['skeletons', 'skins'] as const).map(kind => {
                  const explicit = resources[kind][actor] ?? '';
                  const value =
                    explicit ||
                    (kind === 'skeletons' ? viewer.data?.actors[actor]?.skeletonPath : skinPaths[actor]) ||
                    '';
                  return (
                    <div
                      className="viewport-resource-drop"
                      data-preview-kind={kind}
                      data-preview-actor={actor}
                      data-preview-clip={clip}
                      key={kind}
                      title={value}
                    >
                      <span>{kind === 'skeletons' ? 'HKX' : 'GLB'}</span>
                      {/* The row's HKX/GLB head says what it takes: short words keep a narrow row on one line. */}
                      <code title={value || t(kind === 'skeletons' ? 'viewport.dropSkeleton' : 'viewport.dropSkin')}>
                        {value ? baseName(value) : t('viewport.dropHere')}
                      </code>
                      <button
                        title={t(kind === 'skeletons' ? 'viewport.pickSkeleton' : 'viewport.pickSkin')}
                        aria-label={
                          t(kind === 'skeletons' ? 'viewport.pickSkeleton' : 'viewport.pickSkin') + ' A' + (actor + 1)
                        }
                        onClick={() => pick(kind, actor)}
                      >
                        {t('viewport.pick')}
                      </button>
                      {explicit && (
                        <button
                          aria-label={t('viewport.clear') + ' A' + (actor + 1)}
                          onClick={() => clear(kind, actor)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div className="viewport-foot">
          <HelpTip
            label={tr('뷰어 조작')}
            help={preset === 'camera' ? t('viewport.cameraHelp') : viewerHelp()}
            className="viewport-help"
          >
            <span className="help-tip-label">{tr('조작법')}</span>
          </HelpTip>
          <div className="viewport-camera-tools">
            <button
              title={tr('현재 포즈 화면 맞춤')}
              aria-label={tr('현재 포즈 화면 맞춤')}
              onClick={() => setCameraCommand(c => ({serial: (c?.serial ?? 0) + 1, kind: 'fit'}))}
            >
              <Icon name="fit" />
            </button>
            <button
              title={tr('기본 시점 복귀')}
              aria-label={tr('기본 시점 복귀')}
              onClick={() => setCameraCommand(c => ({serial: (c?.serial ?? 0) + 1, kind: 'home'}))}
            >
              <Icon name="rotate" />
            </button>
            {hasCamera && (
              <button
                className={preset === 'camera' ? 'active' : ''}
                title={t('viewport.camera')}
                aria-label={t('viewport.camera')}
                aria-pressed={preset === 'camera'}
                onClick={() =>
                  setOptions(value => ({...value, [presetKey]: preset === 'camera' ? 'perspective' : 'camera'}))
                }
              >
                <Icon name="camera" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
