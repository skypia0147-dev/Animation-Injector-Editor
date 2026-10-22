import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {tr} from '../i18n/korean.ts';

/** ①②③…: a fanned branch's place (graph/conditionFans.ts). */
export const fanNumber = (i: number) => (i < 20 ? String.fromCharCode(0x2460 + i) : `(${i + 1})`);

// A fanned branch's number on its card (docs/mockup-condition-fan): the order is changed here (or by Alt+↑/↓, or
// by dropping the card onto another branch), never by moving the card.
export function FanBadge({index, count, move}: {index: number; count: number; move: (to: number) => void}) {
  const [open, setOpen] = useState(false),
    [place, setPlace] = useState({left: 0, top: 0}),
    button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const b = button.current.getBoundingClientRect();
    setPlace({left: Math.max(8, Math.min(b.left, innerWidth - 168)), top: b.bottom + 4});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', away, true);
    return () => removeEventListener('mousedown', away, true);
  }, [open]);
  const last = count - 1,
    items: [string, number, boolean][] = [
      [tr('위로'), index - 1, index === 0],
      [tr('아래로'), index + 1, index === last],
      [tr('맨 위로'), 0, index === 0],
      [tr('맨 아래로'), last, index === last],
    ];
  return (
    <>
      <button
        ref={button}
        type="button"
        className="fan-badge nodrag nopan"
        title={tr('갈래 순서 바꾸기 (Alt+↑/↓)')}
        aria-label={`${index + 1}` + tr('번 갈래 순서 바꾸기')}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {index + 1}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="pin-menu fan-menu nodrag nopan"
            role="menu"
            style={place}
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            {items.map(([label, to, off]) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                disabled={off}
                onClick={() => {
                  setOpen(false);
                  move(to);
                }}
              >
                {label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
