import type {QteNode, Outcome} from './qte.ts';
export type QtePreviewState = {
  elapsed: number;
  heldElapsed: number;
  holding: boolean;
  completed: number;
  outcome: Outcome | null;
};
export const qteTarget = 43 / 69;
export const previewInitial = (): QtePreviewState => ({
  elapsed: 0,
  heldElapsed: 0,
  holding: false,
  completed: 0,
  outcome: null,
});
export const previewProgress = (s: QtePreviewState, q: QteNode) => (s.elapsed * q.speed) / 2.4;
export function previewGauge(s: QtePreviewState, q: QteNode) {
  if (q.type === 'holdRelease') return (s.heldElapsed * q.speed) / 2.4;
  if (q.type === 'rapidPress') return s.completed / (q.pressCount ?? 10);
  if (q.type === 'keySequence') return s.completed / Math.max(1, q.sequence?.length ?? 0);
  return previewProgress(s, q);
}
export function previewAdvance(s: QtePreviewState, delta: number, q: QteNode): QtePreviewState {
  if (s.outcome || !Number.isFinite(delta) || delta < 0) return s;
  const n = {...s, elapsed: s.elapsed + delta, heldElapsed: s.heldElapsed + (s.holding ? delta : 0)};
  const p = previewProgress(n, q);
  // Converging lines have crossed once the success window is over (runtime QteClock::Advance).
  if (p >= 1 || ((q.type ?? 'splitArc') === 'splitArc' && q.design === 'converge' && p > qteTarget + q.successWindow))
    n.outcome = 'failure';
  return n;
}
export function previewInput(s: QtePreviewState, q: QteNode, up = false, expected = true): QtePreviewState {
  if (s.outcome) return s;
  const n = {...s},
    p = previewProgress(s, q);
  const judge = (progress: number): Outcome => {
    const e = Math.abs(progress - qteTarget);
    return progress >= 1 ? 'failure' : e < q.perfectWindow ? 'perfect' : e < q.successWindow ? 'success' : 'failure';
  };
  if (up) {
    if (q.type !== 'holdRelease' || !s.holding) return s;
    n.holding = false;
    n.outcome = p >= 1 ? 'failure' : judge(previewGauge(n, q));
    return n;
  }
  if (p >= 1) {
    n.outcome = 'failure';
    return n;
  }
  if (q.type === 'holdRelease') {
    n.holding = true;
    return n;
  }
  if (q.type === 'rapidPress' || q.type === 'keySequence') {
    if (!expected) {
      n.outcome = 'failure';
      return n;
    }
    if (++n.completed >= (q.type === 'rapidPress' ? (q.pressCount ?? 10) : (q.sequence?.length ?? 0)))
      n.outcome = (q.perfectBefore ?? 0.5) > 0 && p <= (q.perfectBefore ?? 0.5) ? 'perfect' : 'success';
  } else n.outcome = judge(p);
  return n;
}
