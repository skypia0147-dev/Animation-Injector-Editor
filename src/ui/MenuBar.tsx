import {MenuList} from './MenuList.tsx';
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';

export type MenuEntry =
  | '-'
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      run?: () => void;
      submenu?: MenuEntry[];
    };
export type Menu = {id: string; label: string; items: MenuEntry[]};

/** Unreal-style HTML menu bar: click opens, hover switches between open menus, Esc / outside click closes. */
export function MenuBar({menus, after, right}: {menus: Menu[]; after?: ReactNode; right?: ReactNode}) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="menubar" ref={ref} role="menubar">
      {menus.map(m => (
        <div key={m.id} className={'menubar-item' + (open === m.id ? ' open' : '')}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open === m.id}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onMouseEnter={() => open && open !== m.id && setOpen(m.id)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(m.id);
              }
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next =
                  menus[(menus.indexOf(m) + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length];
                ref.current?.querySelector<HTMLButtonElement>('[data-menu-id=\"' + next.id + '\"]')?.focus();
                if (open) setOpen(next.id);
              }
            }}
            data-menu-id={m.id}
          >
            {m.label}
          </button>
          {open === m.id && (
            <div className="menu-popup">
              <MenuList
                items={m.items}
                close={() => {
                  setOpen(null);
                  ref.current?.querySelector<HTMLButtonElement>('.menubar-item.open > button')?.focus();
                }}
              />
            </div>
          )}
        </div>
      ))}
      {after}
      <div className="menubar-right">{right}</div>
    </div>
  );
}
