// The timeline ruler's ticks (docs/mockup-layout-audit ②): a round step that keeps the labels apart at the lane's
// width, so a narrow panel shows 0 · 0.25 · 0.5 instead of eleven numbers on top of each other.
const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
/** A label this close to the lane's end is drawn leftward from its tick so it stays inside. */
const endRoom = 30;

export type RulerTick = {left: number; text: string; end: boolean};

export function rulerTicks(start: number, limit: number, width: number, minGap = 44) {
  const span = limit > 0 ? limit : 1,
    px = width > 0 ? width : 600;
  const step = steps.find(s => (s / span) * px >= minGap) ?? steps[steps.length - 1];
  const digits = step >= 1 ? 0 : Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2;
  const first = Math.ceil(start / step - 1e-9);
  const ticks: RulerTick[] = [];
  for (let i = first; ; i++) {
    const value = Math.round(i * step * 1e6) / 1e6,
      x = (value - start) / span;
    if (x > 1 + 1e-9) break;
    ticks.push({left: x * 100, text: value.toFixed(digits), end: (1 - x) * px < endRoom});
  }
  return {step: (step / span) * 100, ticks};
}
