// Canvas selection the way design and node tools do it (10-18, docs/mockup-drag-select):
// a box picks every card it touches, Shift adds to the selection, Ctrl toggles, a modifier click toggles one card.
export type Rect = {x: number; y: number; w: number; h: number};
export type BoxMode = 'replace' | 'add' | 'toggle';

/** The rectangle two corners span, in any drag direction. */
export function spanned(a: {x: number; y: number}, b: {x: number; y: number}): Rect {
  return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y)};
}
/** A card is picked when the box touches it at all (a large card needs not fit inside). */
export function touches(box: Rect, card: Rect): boolean {
  return card.x < box.x + box.w && card.x + card.w > box.x && card.y < box.y + box.h && card.y + card.h > box.y;
}
export const boxMode = (e: {shiftKey: boolean; ctrlKey: boolean; metaKey: boolean}): BoxMode =>
  e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace';
/** The selection while a box is dragged: what was picked before it (for add/toggle) combined with what it touches. */
export function boxSelection(base: readonly string[], inBox: readonly string[], mode: BoxMode): string[] {
  if (mode === 'replace') return [...inBox];
  const out = new Set(base);
  for (const id of inBox) {
    if (mode === 'toggle' && base.includes(id)) out.delete(id);
    else out.add(id);
  }
  return [...out];
}
/** A Shift/Ctrl click: the card goes in or out of the selection. */
export function toggled(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter(x => x !== id) : [...current, id];
}
/** The window event the details panel sends to the canvas: 'copy' | 'delete' | 'alignLeft' | 'clear'. */
export const SELECTION_COMMAND = 'ai-graph-selection';
