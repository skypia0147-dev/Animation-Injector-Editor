import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {PinRow} from './pinTargets.ts';
import {tr} from '../i18n/korean.ts';

// One output pin's destination list: a searchable list grouped by kind; a destination the connection rules
// refuse shows dimmed with the reason. `load` reads the pin when the list opens (the card draws without it).
// `openOn`: a menu elsewhere opens this list with openPinMenu(key) (the canvas menu's "…공유").
export const openPinMenu = (key: string) => dispatchEvent(new CustomEvent('pin-menu-open', {detail: key}));
export function PinMenu({
  load,
  pick,
  label,
  className,
  title,
  style,
  openOn,
}: {
  load: () => PinRow | undefined;
  pick: (target: string) => void;
  label: string;
  className: string;
  title?: string;
  style?: CSSProperties;
  openOn?: string;
}) {
  const [row, setRow] = useState<PinRow>(),
    [query, setQuery] = useState(''),
    [place, setPlace] = useState({left: 0, top: 0}),
    button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setRow(undefined);
    setQuery('');
  };
  useLayoutEffect(() => {
    if (!row || !button.current) return;
    const b = button.current.getBoundingClientRect(),
      h = panel.current?.offsetHeight ?? 300;
    setPlace({
      left: Math.max(8, Math.min(b.left, innerWidth - 268)),
      top: b.bottom + h + 8 > innerHeight ? Math.max(8, b.top - h - 4) : b.bottom + 4,
    });
  }, [row]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!openOn) return;
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail === openOn) setRow(loadRef.current());
    };
    addEventListener('pin-menu-open', open);
    return () => removeEventListener('pin-menu-open', open);
  }, [openOn]);
  useEffect(() => {
    if (!row) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close();
    };
    addEventListener('mousedown', away, true);
    return () => removeEventListener('mousedown', away, true);
  }, [row]);
  const q = query.trim().toLowerCase(),
    shown = row?.targets.filter(t => !q || t.label.toLowerCase().includes(q)) ?? [],
    groups = [...new Set(shown.map(t => t.group))];
  const choose = (target: string) => {
    close();
    pick(target);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className + ' nodrag nopan'}
        title={title}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={!!row}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          if (row) close();
          else setRow(load());
        }}
      >
        {label}
      </button>
      {row &&
        createPortal(
          <div
            ref={panel}
            className="pin-menu nodrag nopan nowheel"
            role="listbox"
            aria-label={row.label + tr(' 연결 대상')}
            style={place}
            onKeyDown={e => {
              if (e.key === 'Escape') close();
            }}
          >
            <input
              autoFocus
              placeholder={tr('동작 검색…')}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                const first = shown.find(t => !t.disabled);
                if (e.key === 'Enter' && first) choose(first.id);
              }}
            />
            {row.clearable && (
              <button type="button" role="option" aria-selected={!row.current} onClick={() => choose('')}>
                {tr('연결 안 함')}
              </button>
            )}
            {groups.map(g => (
              <div key={g} role="group" aria-label={g}>
                <div className="pin-menu-group">{g}</div>
                {shown
                  .filter(t => t.group === g)
                  .map(t => (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={t.id === row.current}
                      aria-disabled={!!t.disabled}
                      className={t.id === row.current ? 'current' : undefined}
                      title={t.disabled}
                      onClick={() => !t.disabled && choose(t.id)}
                    >
                      <span>{t.label}</span>
                      {t.disabled && <small>{t.disabled}</small>}
                    </button>
                  ))}
              </div>
            ))}
            {!shown.length && <div className="pin-menu-empty">{tr('맞는 동작이 없습니다')}</div>}
          </div>,
          document.body
        )}
    </>
  );
}
