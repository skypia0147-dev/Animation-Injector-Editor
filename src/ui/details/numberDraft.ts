// Text typed into a number box reaches the document only when it is a finite number.
// An empty or partial entry ("", "-", "1e") stays local to the field and never becomes NaN,
// because JSON turns NaN into null and the recovery copy could no longer be parsed.
export function parseNumberDraft(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

// What the box shows: a drag preview first, then the text being typed, then the stored value.
export function shownNumber(value: number, draft: string | null, preview: number | null = null): string {
  if (preview !== null && Number.isFinite(preview)) return String(preview);
  if (draft !== null) return draft;
  return Number.isFinite(value) ? String(value) : '';
}

// One wheel notch on a focused number box: its step (×10 with Shift) up or down, rounded off the float noise and
// kept within its range (docs/mockup-layout-fixes ①).
export function wheelStep(
  value: number,
  direction: 1 | -1,
  step: number,
  shift: boolean,
  min?: number | string,
  max?: number | string
): number {
  const from = Number.isFinite(value) ? value : 0;
  let next = Math.round((from + direction * step * (shift ? 10 : 1)) * 1e6) / 1e6;
  if (min !== undefined && min !== '' && Number.isFinite(Number(min))) next = Math.max(Number(min), next);
  if (max !== undefined && max !== '' && Number.isFinite(Number(max))) next = Math.min(Number(max), next);
  return next;
}

// The same notch on any focused field that holds a number (ui/wheelGuard.ts): its text stepped, or undefined when it
// holds no number (「끝」), which the wheel then leaves alone.
export function wheelText(
  text: string,
  direction: 1 | -1,
  step: number,
  shift: boolean,
  min?: number | string,
  max?: number | string
): string | undefined {
  const value = text.trim() ? Number(text) : 0;
  if (!Number.isFinite(value)) return undefined;
  return String(wheelStep(value, direction, step, shift, min, max));
}
