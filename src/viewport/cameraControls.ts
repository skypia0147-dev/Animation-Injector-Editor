import {tr} from '../i18n/korean.ts';
// Matches HKX_Viewer BoneView + pyqtgraph GLViewWidget Euler controls.
export const viewerHelp = () => tr('가운데 버튼: 회전 · Shift+가운데 버튼: 이동 · 휠: 확대/축소 · Ctrl+휠: 시야각');
export const HOME_CAMERA = {yaw: (20 * Math.PI) / 180, pitch: (12 * Math.PI) / 180, distance: 320, fov: 60};
export const orbitDelta = (yaw: number, pitch: number, dx: number, dy: number) => ({
  yaw: yaw - (dx * Math.PI) / 180,
  pitch: Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch + (dy * Math.PI) / 180)),
});
export const panScale = (distance: number, horizontalFov: number, width: number) =>
  (distance * 2 * Math.tan((horizontalFov * Math.PI) / 360)) / Math.max(1, width);
export const wheelFactor = (delta: number, mode: number) =>
  Math.pow(0.999, -delta * (mode === 1 ? 40 : mode === 2 ? 800 : 1));
export const verticalFov = (horizontal: number, aspect: number) =>
  (2 * Math.atan(Math.tan((horizontal * Math.PI) / 360) / Math.max(0.01, aspect)) * 180) / Math.PI;
