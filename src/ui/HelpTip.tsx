import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import './help-tip.css';

const SHOW_DELAY = 400;

/** Help shown when the pointer rests on the item it explains (10-19: no "?" buttons). `children` is the item; the
 * popup opens beside it after a short rest, to its left when there is room (the details panel is on the right),
 * else below or above. Portals keep it outside scrollable panels. */
export function HelpTip({
  label,
  help,
  children,
  block = false,
  className = '',
}: {
  label: string;
  help: ReactNode;
  children: ReactNode;
  block?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false),
    [point, setPoint] = useState({left: 0, top: 0});
  const anchor = useRef<HTMLElement>(null),
    bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    id = useId();
  const show = (delay = SHOW_DELAY) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const a = anchor.current?.getBoundingClientRect(),
        tip = bubble.current?.getBoundingClientRect();
      if (!a || !tip) return;
      const top = Math.max(8, Math.min(a.top, window.innerHeight - tip.height - 8));
      if (a.left - tip.width - 10 >= 8) setPoint({left: a.left - tip.width - 10, top});
      else
        setPoint({
          left: Math.max(8, Math.min(a.left, window.innerWidth - tip.width - 8)),
          top: Math.max(8, a.bottom + tip.height + 8 < window.innerHeight ? a.bottom + 6 : a.top - tip.height - 6),
        });
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        e.stopPropagation();
      }
    };
    // Typing or clicking in the item puts the help away.
    const away = () => setOpen(false);
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [open]);
  const Tag = block ? 'div' : 'span';
  return (
    <Tag
      ref={anchor as never}
      className={'help-tip-target ' + className}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="help-tip-popup"
            style={point}
            onMouseEnter={() => show(0)}
            onMouseLeave={hide}
          >
            <strong>{label}</strong>
            <div>{help}</div>
          </div>,
          document.body
        )}
    </Tag>
  );
}
/** A heading line whose help shows when the pointer rests on it. */
export function HelpNote({label, children}: {label: string; children: ReactNode}) {
  return (
    <HelpTip label={label} help={children} block className="help-note">
      <span className="help-tip-label">{label}</span>
    </HelpTip>
  );
}
