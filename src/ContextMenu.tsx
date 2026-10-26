import {Fragment, useEffect, useRef, useState} from 'react';
import type {MouseEvent} from 'react';
import {tr} from './i18n/korean.ts';
// `divider`: a line before the item, between two groups of the menu.
export type MenuItem = {label: string; run: () => void; disabled?: boolean; divider?: boolean};
/** The groups of a menu as one list, a divider before each group's first item; empty groups drop out. */
export const menuGroups = (...groups: MenuItem[][]): MenuItem[] =>
  groups.filter(g => g.length).flatMap((g, i) => g.map((item, j) => (i && !j ? {...item, divider: true} : item)));
export function useEditorMenu(
  items: (target: HTMLElement, x: number, y: number) => MenuItem[],
  status: (s: string) => void
) {
  const [menu, setMenu] = useState<{x: number; y: number; items: MenuItem[]} | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    previousFocus = useRef<HTMLElement | null>(null);
  const dismiss = () => {
    setMenu(null);
    previousFocus.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const all = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
        ]?.focus();
      }
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  const context = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    previousFocus.current = document.activeElement as HTMLElement;
    const target = e.target as HTMLElement;
    const input = target.closest('input,textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    let list = items(target, e.clientX, e.clientY);
    if (input && ['text', 'search', 'textarea', ''].includes(input.type)) {
      const start = input.selectionStart ?? 0,
        end = input.selectionEnd ?? 0;
      const value = input.value;
      const replace = (text: string) => {
        input.focus();
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(
          input,
          value.slice(0, start) + text + value.slice(end)
        );
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.setSelectionRange(start + text.length, start + text.length);
      };
      list = [
        {
          label: tr('잘라내기'),
          disabled: input.readOnly || input.disabled || start === end,
          run: () => {
            void navigator.clipboard
              .writeText(value.slice(start, end))
              .then(() => replace(''))
              .catch(e => status(String(e)));
          },
        },
        {
          label: tr('복사'),
          disabled: start === end,
          run: () => {
            void navigator.clipboard.writeText(value.slice(start, end)).catch(e => status(String(e)));
          },
        },
        {
          label: tr('붙여넣기'),
          disabled: input.readOnly || input.disabled,
          run: () => {
            void navigator.clipboard
              .readText()
              .then(replace)
              .catch(() => status(tr('클립보드를 읽지 못했습니다. 입력칸에서 Ctrl+V를 사용하세요.')));
          },
        },
        {
          label: tr('전체 선택'),
          run: () => {
            input.focus();
            input.select();
          },
        },
      ];
    } else if (target.closest('pre')) {
      const text = window.getSelection()?.toString() || target.closest('pre')!.textContent || '';
      list = [
        {
          label: tr('XML 복사'),
          run: () => {
            void navigator.clipboard
              .writeText(text)
              .then(() => status(tr('XML을 복사했습니다.')))
              .catch(e => status(String(e)));
          },
        },
      ];
    }
    setMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 244)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - list.length * 28 - 16)),
      items: list,
    });
  };
  return {
    context,
    menu: menu && (
      <div
        className="editor-context-menu"
        ref={ref}
        role="menu"
        aria-label={tr('편집 메뉴')}
        style={{left: menu.x, top: menu.y}}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {menu.items.map(i => (
          <Fragment key={i.label}>
            {i.divider && <hr />}
            <button
              role="menuitem"
              disabled={i.disabled}
              onClick={() => {
                dismiss();
                i.run();
              }}
            >
              {i.label}
            </button>
          </Fragment>
        ))}
      </div>
    ),
  };
}
