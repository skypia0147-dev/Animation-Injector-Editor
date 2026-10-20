// Workspace history contains plain serializable records. Reuse unchanged branches
// so a small edit does not retain another complete clone of a large project.
// It runs twice per edit over the whole project (the history, then the rendered document): arrays go by
// index and records by for-in, without the key lists (a third faster on Grapple).
export function shareUnchanged<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  const array = Array.isArray(next);
  if (array !== Array.isArray(previous)) return next;
  return (
    array
      ? shareArray(previous as unknown[], next as unknown[])
      : shareRecord(previous as Record<string, unknown>, next as Record<string, unknown>)
  ) as T;
}
function shareArray(a: unknown[], b: unknown[]): unknown[] {
  let same = a.length === b.length,
    result: unknown[] | undefined;
  for (let i = 0; i < b.length; i++) {
    const had = i < a.length,
      value = had ? shareUnchanged(a[i], b[i]) : b[i];
    if (!had || !Object.is(value, a[i])) same = false;
    if (!Object.is(value, b[i])) (result ??= b.slice())[i] = value;
  }
  return same ? a : (result ?? b);
}
function shareRecord(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  let same = true,
    count = 0,
    result: Record<string, unknown> | undefined;
  for (const key in b) {
    if (!Object.hasOwn(b, key)) continue;
    count++;
    const had = Object.hasOwn(a, key),
      value = had ? shareUnchanged(a[key], b[key]) : b[key];
    if (!had || !Object.is(value, a[key])) same = false;
    if (!Object.is(value, b[key])) {
      result ??= {...b};
      Object.defineProperty(result, key, {value, writable: true, enumerable: true, configurable: true});
    }
  }
  // Equal only without keys of its own that the next record lacks.
  if (same) for (const key in a) if (Object.hasOwn(a, key) && --count < 0) break;
  return same && count === 0 ? a : (result ?? b);
}
/** Freezes a plain record tree (development builds: the rendered document must never change in place). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
