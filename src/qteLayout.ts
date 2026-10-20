// Keep in sync with runtime ui/QteLayout.h; the cross-language test checks both.
import type {QteFaceMode} from './qteFace.ts';
import type {QteType} from './qte.ts';
import {tr} from './i18n/korean.ts';
export const qteReferenceHeight = 1080,
  qtePaddingRatio = 0.0125;
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
export const qteAnchors = {
  get center() {
    return tr('중앙');
  },
  get topLeft() {
    return tr('왼쪽 위');
  },
  get topRight() {
    return tr('오른쪽 위');
  },
  get bottomLeft() {
    return tr('왼쪽 아래');
  },
  get bottomRight() {
    return tr('오른쪽 아래');
  },
} as const;
export type QteAnchor = keyof typeof qteAnchors | 'screen';
export type QteBounds = {left: number; top: number; right: number; bottom: number};
/** A key cap's width for its label (QtePreview KeyGlyph, runtime KeyCap); it is 30 high. */
export const qteKeyWidth = (label: string) => Math.max(30, label.length * 9 + 16);
/**
 * What a QTE draws, in drawing units about its middle (runtime 0.12.257 QteLayout::BoundsOf). The anchors and the
 * screen's edges hold this box: one sized for every type left an empty margin that grew with the scale, so a corner
 * QTE moved away from its corner as it grew. The key is a cap keyWidth wide and 30 high.
 */
export function qteBoundsOf(mode: QteFaceMode, type: QteType, sequenceCount: number, keyWidth: number): QteBounds {
  const half = Math.max(30, keyWidth) / 2 + 1;
  if (mode === 'circle') {
    // The shrinking circle starts at 92 and the result ring ends at 101 (3 wide).
    const r = Math.max(104, half);
    return {left: -r, top: -r, right: r, bottom: r};
  }
  if (mode === 'single') {
    // The key alone, 1.4 times larger, and its press springs up to 1.06.
    const k = 1.4 * 1.06,
      w = half,
      h = 16;
    return {left: -w * k, top: -h * k, right: w * k, bottom: h * k};
  }
  if (mode === 'converge') {
    // The lines cross the whole screen; what stays is the diamond, its result glow and the key's name (size 30).
    const w = Math.max(112, Math.max(30, keyWidth));
    return {left: -w, top: -112, right: w, bottom: 112};
  }
  // The widget, the key's name at 100 and the hint at 130 (24 high) below it.
  const w = Math.max(122, type === 'keySequence' ? sequenceCount * 22 + 2 : 0),
    top =
      type === 'rotatingNeedle' || type === 'holdRelease'
        ? -72
        : type === 'keySequence'
          ? -22
          : type === 'timingBar'
            ? -19
            : -11;
  return {left: -w, top, right: w, bottom: 156};
}
export function qteLayout(
  width: number,
  height: number,
  scale: number,
  x: number,
  y: number,
  anchor: QteAnchor,
  b: QteBounds
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !(b.right > b.left && b.bottom > b.top)
  )
    return {x: 0, y: 0, unit: 0, padding: 0, fitted: false};
  const screen = anchor === 'screen';
  scale = Number.isFinite(scale) ? clamp(scale, 0.25, 4) : 1;
  x = Number.isFinite(x) ? clamp(x, screen ? 0 : -1, 1) : screen ? 0.5 : 0;
  y = Number.isFinite(y) ? clamp(y, screen ? 0 : -1, 1) : screen ? 0.5 : 0;
  const padding = Math.min(width, height) * qtePaddingRatio,
    requested = (height / qteReferenceHeight) * scale;
  const unit = Math.min(
    requested,
    (width - 2 * padding) / (b.right - b.left),
    (height - 2 * padding) / (b.bottom - b.top)
  );
  let px = width * x,
    py = height * y;
  if (!screen) {
    // A corner holds the drawing's near edge, so a larger scale grows away from the corner.
    const center = anchor === 'center',
      east = anchor === 'topRight' || anchor === 'bottomRight',
      south = anchor === 'bottomLeft' || anchor === 'bottomRight';
    px =
      (center ? width / 2 : east ? width - padding - b.right * unit : padding - b.left * unit) +
      (east ? -x : x) * height;
    py =
      (center ? height / 2 : south ? height - padding - b.bottom * unit : padding - b.top * unit) +
      (south ? -y : y) * height;
  }
  return {
    x: clamp(px, padding - b.left * unit, width - padding - b.right * unit),
    y: clamp(py, padding - b.top * unit, height - padding - b.bottom * unit),
    unit,
    padding,
    fitted: unit < requested,
  };
}
export const qteResolutions = [
  {label: '1920 × 1080 · 16:9', width: 1920, height: 1080},
  {label: '1280 × 720 · 16:9', width: 1280, height: 720},
  {label: '2560 × 1440 · 16:9', width: 2560, height: 1440},
  {label: '3840 × 2160 · 4K', width: 3840, height: 2160},
  {label: '1920 × 1200 · 16:10', width: 1920, height: 1200},
  {label: '1600 × 1200 · 4:3', width: 1600, height: 1200},
  {
    get label() {
      return tr('3440 × 1440 · 울트라와이드');
    },
    width: 3440,
    height: 1440,
  },
  {label: '5120 × 1440 · 32:9', width: 5120, height: 1440},
  {
    get label() {
      return tr('1080 × 1920 · 세로');
    },
    width: 1080,
    height: 1920,
  },
] as const;
