import {useEffect, useRef, type RefObject} from 'react';

/** A popup menu that closes on a press anywhere outside `ref` (the canvas, another card, the rest of its own card)
 *  and on Escape. It listens in the capture phase: a press the canvas or a card handles may never bubble up (10-29:
 *  a card's 「＋ 설정」 and 「+ 기능」 menus stayed open when the canvas was clicked). */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current();
    };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', key, true);
    };
  }, [open, ref]);
}
