import {wheelText} from './details/numberDraft.ts';

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

// A focused field that holds a number takes the wheel (docs/mockup-layout-fixes ①): any number box, a card's clip
// bar text (data-wheel-step) or a QTE field alike, so the canvas behind it never zooms. One listener for the app,
// in the capture phase: the canvas's own zoom listener sits on an ancestor of every card field.
export function installWheelGuard() {
  const wheel = (e: WheelEvent) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || document.activeElement !== el || !e.deltaY || el.readOnly) return;
    const step = el.type === 'number' ? Number(el.step) || 1 : Number(el.dataset.wheelStep);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const next = wheelText(el.value, e.deltaY < 0 ? 1 : -1, step, e.shiftKey, el.min, el.max);
    if (next === undefined || next === el.value) return;
    // The native setter and an input event, so React's onChange sees it as typed.
    setValue.call(el, next);
    el.dispatchEvent(new Event('input', {bubbles: true}));
  };
  window.addEventListener('wheel', wheel, {capture: true, passive: false});
  return () => window.removeEventListener('wheel', wheel, {capture: true});
}
