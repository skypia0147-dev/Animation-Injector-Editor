export type LayoutSizes = {left: number; right: number; project: number; viewport: number; bottom: number};
export const defaultSizes: LayoutSizes = {left: 244, right: 336, project: 58, viewport: 400, bottom: 276};
export const SIZE_KEY = 'aieditor-panel-sizes-v2';
export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
export function readSizes(value: unknown): LayoutSizes {
  const saved = value && typeof value === 'object' ? (value as Partial<LayoutSizes>) : {};
  return Object.fromEntries(
    Object.entries(defaultSizes).map(([k, fallback]) => {
      const v = saved[k as keyof LayoutSizes];
      return [k, typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 2000) : fallback];
    })
  ) as LayoutSizes;
}
export function fitSizes(
  s: LayoutSizes,
  width: number,
  height: number,
  left: boolean,
  right: boolean,
  viewport: boolean,
  bottom: boolean
): LayoutSizes {
  const rightWidth = right ? clamp(s.right, 240, Math.min(600, width - (left ? 180 : 0) - 320)) : 0;
  const leftWidth = left ? clamp(s.left, 180, Math.min(500, width - rightWidth - 320)) : 0;
  const bottomHeight = bottom || viewport ? clamp(s.bottom, 150, height - 263) : 0;
  return {
    left: leftWidth,
    right: rightWidth,
    project: clamp(s.project, 20, 80),
    bottom: bottomHeight,
    viewport: viewport ? clamp(s.viewport, 240, Math.max(240, width - leftWidth - rightWidth - 260)) : 0,
  };
}
