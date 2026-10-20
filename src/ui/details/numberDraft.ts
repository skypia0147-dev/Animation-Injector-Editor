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
