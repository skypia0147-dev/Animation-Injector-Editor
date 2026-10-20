import {createContext, useContext, useId, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {Icon} from '../EditorChrome.tsx';

const TreeContext = createContext<{
  open: Record<string, boolean>;
  toggle: (key: string, value: boolean) => void;
} | null>(null);

export function FolderTree({children}: {children: ReactNode}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // One value per open state: a new object each render would redraw every folder, memoized rows included.
  const value = useMemo(
    () => ({open, toggle: (key: string, value: boolean) => setOpen(v => ({...v, [key]: value}))}),
    [open]
  );
  return (
    <TreeContext.Provider value={value}>
      <div className="folder-tree">{children}</div>
    </TreeContext.Provider>
  );
}

export function TreeFolder({
  folderKey,
  label,
  count,
  children,
  defaultOpen = false,
  forceOpen = false,
  item,
  onAdd,
  addLabel,
}: {
  folderKey: string;
  label: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  item?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const state = useContext(TreeContext)!;
  const id = useId(),
    open = forceOpen || (state.open[folderKey] ?? defaultOpen);
  const toggle = () => state.toggle(folderKey, !open);
  return (
    <div className={'tree-folder' + (item ? ' tree-folder-item' : '')}>
      <div className="tree-folder-head">
        <button
          type="button"
          className={'tree-disclosure' + (item ? ' icon-only' : '')}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              state.toggle(folderKey, e.key === 'ArrowRight');
            }
          }}
        >
          <span className="tree-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {!item && (
            <>
              <Icon name="folder" size={15} />
              <span className="tree-label">{label}</span>
              {count !== undefined && <small>{count}</small>}
            </>
          )}
        </button>
        {item}
        {onAdd && (
          <button
            type="button"
            className="tree-add"
            aria-label={addLabel}
            title={addLabel}
            onClick={() => {
              state.toggle(folderKey, true);
              onAdd();
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      <div id={id} className="tree-children" role="group" aria-label={label} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
