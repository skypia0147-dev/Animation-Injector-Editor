import {HelpTip} from './HelpTip.tsx';
import {t} from '../i18n/index.ts';
import type {LibraryEntry} from '../assets.ts';
import {memo, useMemo} from 'react';
import {FolderTree, TreeFolder} from './FolderTree.tsx';
import {assetFolders} from './assetFolders.ts';
import type {AssetFolder} from './assetFolders.ts';
import {Icon} from '../EditorChrome.tsx';
import {tr} from '../i18n/korean.ts';

function HkxBrowserPanel({
  entries,
  onSelectUser,
  onAdd,
  onRemove,
  names,
  selected,
  onSelect,
}: {
  entries: LibraryEntry[];
  onSelectUser: (uid: string) => void;
  onAdd: () => void;
  onRemove: (clip: string) => void;
  names: (uid: string) => string;
  selected?: string;
  onSelect?: (clip: string) => void;
}) {
  const folders = useMemo(() => assetFolders(entries), [entries]);
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
      </FolderTree>
      <HelpTip label={tr('HKX 등록')} help={t('drop.registerHint')} block className="drophint">
        {tr('HKX 드롭')}
      </HelpTip>
    </div>
  );
}
// Memoized: the app shell re-renders for state this panel does not use.
export const HkxBrowser = memo(HkxBrowserPanel);
