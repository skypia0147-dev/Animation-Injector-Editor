import {HelpTip} from './HelpTip.tsx';
import {t} from '../i18n/index.ts';
import type {LibraryEntry} from '../assets.ts';
import type {SoundEntry} from '../package.ts';
import {memo, useContext, useMemo} from 'react';
import {previewable, toggleSound, useSoundPreview} from '../soundPreview.ts';
import {SoundSourceContext} from './details/SoundFile.tsx';
import {FolderTree, TreeFolder} from './FolderTree.tsx';
import {assetFolders} from './assetFolders.ts';
import type {AssetFolder} from './assetFolders.ts';
import {Icon} from '../EditorChrome.tsx';
import {tr} from '../i18n/korean.ts';

function HkxBrowserPanel({
  entries,
  sounds = [],
  onAddSound,
  onRemoveSound,
  onSelectUser,
  onAdd,
  onRemove,
  names,
  selected,
  onSelect,
}: {
  entries: LibraryEntry[];
  /** The sound files the functions play (package.ts soundLibrary), with the source each one has. */
  sounds?: SoundEntry[];
  onAddSound?: () => void;
  onRemoveSound?: (file: string) => void;
  onSelectUser: (uid: string) => void;
  onAdd: () => void;
  onRemove: (clip: string) => void;
  names: (uid: string) => string;
  selected?: string;
  onSelect?: (clip: string) => void;
}) {
  const folders = useMemo(() => assetFolders(entries), [entries]);
  const playing = useSoundPreview();
  const sounds$ = useContext(SoundSourceContext);
  const renderFile = (e: LibraryEntry) => (
    <div
      key={e.clip}
      className={'row asset' + (selected === e.clip ? ' on' : '')}
      title={e.clip + (e.localPath ? '\n' + e.localPath : '')}
    >
      <Icon name="file" size={14} />
      <button
        type="button"
        className="asset-name"
        draggable
        onDragStart={event =>
          event.dataTransfer.setData(
            'application/aie-resource',
            JSON.stringify({kind: 'hkx', clip: e.clip, path: e.localPath})
          )
        }
        onClick={() => onSelect?.(e.clip)}
        onDoubleClick={() => e.users[0] && onSelectUser(e.users[0])}
      >
        <span>{e.name}</span>
        <small>{e.users.length ? e.users.map(names).join(', ') : t('hkx.unused')}</small>
      </button>
      {/* The state as its mark only, the words as its help: the file's name keeps the row (docs/mockup-layout-audit ⑦). */}
      <span
        className={'st ' + (e.localPath ? 'ok' : 'warn')}
        role="img"
        aria-label={e.localPath ? t('hkx.sourceOk') : t('hkx.sourceMissing')}
        title={e.localPath ? t('hkx.sourceOk') : t('hkx.sourceMissing')}
      >
        {e.localPath ? '✓' : '⚠'}
      </span>
      {e.registered && !e.users.length && (
        <button
          type="button"
          className="asset-remove"
          aria-label={t('menu.edit.delete')}
          onClick={() => onRemove(e.clip)}
        >
          ✕
        </button>
      )}
    </div>
  );
  // A sound's row: its source (chosen, or found beside the opened XML) as the HKX's, and who plays it.
  const renderSound = (s: SoundEntry) => {
    const users = [...s.actions.map(names), ...s.events];
    const on = !!s.localPath && playing.path === s.localPath;
    const can = !!s.localPath && previewable(s.localPath);
    return (
      <div
        key={s.file}
        className={'row asset sound' + (on ? ' playing' : '')}
        title={s.file + (s.localPath ? '\n' + s.localPath : '')}
      >
        {/* ▶ plays the source for preview (.wav; the webview cannot decode .xwm). */}
        <button
          type="button"
          className={'sound-play' + (on ? ' on' : '') + (can ? '' : ' off')}
          aria-label={on ? tr('정지') : tr('재생')}
          title={can ? undefined : s.localPath ? tr('xwm은 미리듣기를 할 수 없습니다') : t('hkx.sourceMissing')}
          onClick={() => can && toggleSound(s.localPath).catch(e => sounds$?.status(String(e)))}
        >
          {on ? '■' : '▶'}
        </button>
        <button type="button" className="asset-name" onDoubleClick={() => s.actions[0] && onSelectUser(s.actions[0])}>
          <span>{s.name}</span>
          {on && playing.duration > 0 && (
            <span className="sound-progress" aria-hidden="true">
              <span style={{width: `${Math.min(100, (playing.time / playing.duration) * 100)}%`}} />
            </span>
          )}
          <small>{users.length ? users.join(', ') : t('hkx.unused')}</small>
        </button>
        <span
          className={'st ' + (s.localPath ? 'ok' : 'warn')}
          role="img"
          aria-label={s.localPath ? t('hkx.sourceOk') : t('hkx.sourceMissing')}
          title={s.localPath ? t('hkx.sourceOk') : t('hkx.sourceMissing')}
        >
          {s.localPath ? '✓' : '⚠'}
        </span>
        {s.registered && !users.length && onRemoveSound && (
          <button
            type="button"
            className="asset-remove"
            aria-label={t('menu.edit.delete')}
            onClick={() => onRemoveSound(s.file)}
          >
            ✕
          </button>
        )}
      </div>
    );
  };
  const renderFolder = (folder: AssetFolder) => (
    <TreeFolder key={folder.key} folderKey={'asset:' + folder.key} label={folder.name} count={folder.count} defaultOpen>
      {folder.folders.map(renderFolder)}
      {folder.files.map(renderFile)}
    </TreeFolder>
  );
  return (
    <div className="hkx-browser" data-testid="hkx-browser">
      <FolderTree>
        <TreeFolder
          folderKey="assets"
          label="HKX"
          count={entries.length}
          defaultOpen
          onAdd={onAdd}
          addLabel={t('hkx.add')}
        >
          {folders.folders.map(renderFolder)}
          {folders.files.map(renderFile)}
        </TreeFolder>
        <TreeFolder
          folderKey="sounds"
          label={tr('소리')}
          count={sounds.length}
          defaultOpen
          onAdd={onAddSound}
          addLabel={tr('소리 파일 추가')}
        >
          {sounds.map(renderSound)}
        </TreeFolder>
      </FolderTree>
      <HelpTip label={tr('HKX 등록')} help={t('drop.registerHint')} block className="drophint">
        {tr('HKX 드롭')}
      </HelpTip>
    </div>
  );
}
// Memoized: the app shell re-renders for state this panel does not use.
export const HkxBrowser = memo(HkxBrowserPanel);
