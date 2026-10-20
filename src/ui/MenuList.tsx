import {useEffect, useRef, useState} from 'react';
import type {MenuEntry} from './MenuBar.tsx';

export function MenuList({items, close, back}: {items: MenuEntry[]; close: () => void; back?: () => void}) {
  const ref = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(':scope > .menu-row > button:not(:disabled)')?.focus();
  }, []);
  return (
    <div
      className="menu-list"
      role="menu"
      ref={ref}
      onKeyDown={e => {
        if (e.target instanceof HTMLElement && e.target.closest('[role=menu]') !== ref.current) return;
        const buttons = [
          ...ref.current!.querySelectorAll<HTMLButtonElement>(':scope > .menu-row > button:not(:disabled)'),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          buttons[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          if (e.key === 'Escape') e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'ArrowLeft' && back) {
          e.preventDefault();
          e.stopPropagation();
          back();
        } else if (e.key === 'ArrowRight') {
          const button = document.activeElement as HTMLButtonElement;
          if (button?.getAttribute('aria-haspopup')) {
            e.preventDefault();
            button.click();
          }
        }
      }}
    >
      {items.map((item, i) =>
        item === '-' ? (
          <hr role="separator" key={i} />
        ) : (
          <div className="menu-row" key={i} onMouseEnter={() => setOpen(item.submenu ? i : null)}>
            <button
              type="button"
              className="menu-item"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              disabled={item.disabled}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? open === i : undefined}
              onClick={e => {
                e.stopPropagation();
                if (item.submenu) setOpen(open === i ? null : i);
                else {
                  close();
                  item.run?.();
                }
              }}
            >
              <span className="menu-check">{item.checked ? '✓' : ''}</span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {item.submenu && <span>›</span>}
            </button>
            {item.submenu && open === i && (
              <div className="menu-sub">
                <MenuList
                  items={item.submenu}
                  close={close}
                  back={() => {
                    setOpen(null);
                    ref.current?.children[i]?.querySelector('button')?.focus();
                  }}
                />
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
