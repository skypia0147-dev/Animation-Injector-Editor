import {useState} from 'react';
import type React from 'react';
import {createPortal} from 'react-dom';
import {tr} from '../i18n/korean.ts';

/** Dragging something of an HKX card (a feature row, a setting chip) onto another HKX card: it moves there, or is
 *  copied with Ctrl held (unify ⑪, as a condition between condition cards). Pointer events, as the condition cards'
 *  (graph/ConditionCardFace.tsx says why); 5 px before it is a drag. `drop` gets the card's node id (data-card). */
export function useDragToCard(owner: string, drop: (card: string, copy: boolean) => void) {
  const [ghost, setGhost] = useState<{x: number; y: number; copy: boolean} | null>(null);
  const begin = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX,
      y0 = e.clientY;
    let moving = false,
      target: HTMLElement | null = null;
    const mark = (card: HTMLElement | null) => {
      if (card === target) return;
      target?.classList.remove('item-drop');
      target = card;
      target?.classList.add('item-drop');
    };
    const move = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moving = true;
      const card = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '.p3-node.hkxPlay[data-card]'
      );
      mark(card && card.dataset.card !== owner ? card : null);
      setGhost({x: ev.clientX, y: ev.clientY, copy: ev.ctrlKey});
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!moving) return;
      const card = target?.dataset.card;
      mark(null);
      setGhost(null);
      // The click after the release would open the row or the chip.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => removeEventListener('click', swallow, {capture: true}), 0);
      if (card && ev.type === 'pointerup') drop(card, ev.ctrlKey);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  /** What follows the pointer: the dragged thing's name, 「복사」 with Ctrl. */
  const ghostView = (title: string) =>
    ghost &&
    createPortal(
      <div className={'cond-drag-ghost' + (ghost.copy ? ' copy' : '')} style={{left: ghost.x + 12, top: ghost.y + 10}}>
        {ghost.copy && <b>{tr('복사')}</b>}
        {title}
      </div>,
      document.body
    );
  return {begin, ghostView};
}
