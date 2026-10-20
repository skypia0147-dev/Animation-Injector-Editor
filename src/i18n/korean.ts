// Korean-keyed UI text (2026-10-19). Much of the editor's text is written in Korean where it is used; tr() shows
// it as written in Korean and looks up English, Japanese and Chinese in fromKorean.ts (keyed by the Korean text, as
// gettext keys by its source language). `{name}` placeholders are filled from `vars`.
// tests/korean-coverage.test.mjs fails when Korean text in src/ is not wrapped in tr() or has no translation row.
import {getLanguage} from './index.ts';
import {fromKorean} from './fromKorean.ts';

const column = {en: 0, ja: 1, zh: 2} as const;

export function tr(ko: string, vars?: Record<string, unknown>): string {
  const language = getLanguage();
  const row = language === 'ko' ? undefined : fromKorean[ko];
  const text = row ? row[column[language as keyof typeof column]] || row[0] || ko : ko;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
}

/** A message pattern matched against text from elsewhere (backendText.ts): the Korean pattern, and how to show it
 * in the UI language. Checked like tr(): the pattern is a key of the table. */
export function trPattern(ko: string): {pattern: string; show: (vars: Record<string, unknown>) => string} {
  return {pattern: ko, show: vars => tr(ko, vars)};
}

/** A piece of a message made elsewhere by joining Korean pieces and values (runtimeText.ts): the Korean piece, and
 * how to show it in the UI language. Checked like tr(): the piece is a key of the table. */
export function trFragment(ko: string): {ko: string; show: () => string} {
  return {ko, show: () => tr(ko)};
}
