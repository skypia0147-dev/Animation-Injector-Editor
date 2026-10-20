/** View → 글자 크기 (10-20, docs/mockup-ux-polish ⑦): scales the four text sizes (--fs-*) of the panels, menus
 *  and popups. The canvas keeps its own zoom, so its cards are not scaled. Kept per PC. */
export const UI_SCALES = [0.9, 1, 1.15] as const;
const KEY = 'aieditor-ui-scale';

export function storedUiScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (UI_SCALES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}
export function applyUiScale(scale: number, remember = true) {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  if (!remember) return;
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {}
}
