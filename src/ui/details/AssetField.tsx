import {useEffect, useRef, useState} from 'react';
import type {LibraryEntry} from '../../assets.ts';
import {t} from '../../i18n/index.ts';
import * as io from '../../io.ts';
import {errorText} from '../../errorText.ts';
export function AssetField({
  clip,
  path,
  library = [],
  selected,
  change,
  status,
  scopeKey,
  fixedPath = false,
}: {
  clip: string;
  path: string;
  library?: LibraryEntry[];
  selected?: LibraryEntry;
  change: (clip: string, path: string) => void;
  status: (s: string) => void;
  scopeKey?: string;
  /** The relative path follows another field (a first-person copy of a `both` action): not typed here. */
  fixedPath?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    current = useRef({clip, path, change, scopeKey});
  current.current = {clip, path, change, scopeKey};
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const choose = async () => {
    const before = current.current;
    setBusy(true);
    try {
      const asset = await io.pickHkx();
      const now = current.current;
      if (
        !mounted.current ||
        now.clip !== before.clip ||
        now.path !== before.path ||
        (scopeKey ? now.scopeKey !== before.scopeKey : now.change !== before.change)
      )
        return;
      if (asset) now.change(asset.clip, asset.path);
    } catch (e) {
      status(errorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="asset-field">
      <div className="asset-main">
        <select
          aria-label={t('row.file')}
          value={clip}
          onChange={e => {
            const a = library.find(a => a.clip === e.target.value);
            if (a) change(a.clip, a.localPath);
          }}
        >
          {!library.some(a => a.clip === clip) && (
            <option value={clip}>{clip.split(/[\\/]/).at(-1) || t('detail.none')}</option>
          )}
          {library.map(a => (
            <option key={a.clip} value={a.clip}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          disabled={!selected}
          title={t('detail.useSelected')}
          aria-label={t('detail.useSelected')}
          onClick={() => {
            if (selected) change(selected.clip, selected.localPath);
          }}
        >
          ←
        </button>
        <button disabled={busy} title={t('hkx.add')} aria-label={t('hkx.add')} onClick={() => void choose()}>
          🗁
        </button>
      </div>
      <input
        aria-label={t('detail.path')}
        className="asset-relative"
        value={clip}
        title={clip}
        readOnly={fixedPath}
        onChange={e => change(e.target.value, '')}
      />
      {!path && <small>{t('hkx.sourceMissing')}</small>}
    </div>
  );
}
