// Four complete UI tables. Unknown extension keys fall back to English, then to the key itself.
// Language is a user preference (not stored in the project file).
import {useSyncExternalStore} from 'react';
import {en} from './locales/en.ts';
import {ko} from './locales/ko.ts';
import {ja} from './locales/ja.ts';
import {zh} from './locales/zh.ts';

export const supportedLanguages = ['en', 'ko', 'ja', 'zh'] as const;
export type Language = (typeof supportedLanguages)[number];
export const languageNames: Record<Language, string> = {en: 'English', ko: '한국어', ja: '日本語', zh: '中文(简体)'};

const tables: Record<Language, Record<string, string>> = {en, ko, ja, zh};
const STORAGE_KEY = 'aieditor-language';
const listeners = new Set<() => void>();

function detect(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (supportedLanguages as readonly string[]).includes(saved)) return saved as Language;
  } catch {
    /* Preference storage is optional. */
  }
  const os = (globalThis.navigator?.language ?? 'en').toLowerCase();
  return os.startsWith('ko') ? 'ko' : os.startsWith('ja') ? 'ja' : os.startsWith('zh') ? 'zh' : 'en';
}

let current: Language = detect();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (!(supportedLanguages as readonly string[]).includes(language))
    throw new Error('Unsupported language: ' + language);
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* Preference storage is optional. */
  }
  for (const fn of listeners) fn();
}

/** Translate a key. `vars` replaces `{name}` placeholders. */
export function t(key: string, vars?: Record<string, string | number>, language: Language = current): string {
  const text = tables[language][key] ?? tables.en[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : text;
}

/** Keys defined in the reference (English) table. Used by tests and by the translation coverage report. */
export function localeKeys(): string[] {
  return Object.keys(en);
}

export function missingKeys(language: Language): string[] {
  return localeKeys().filter(k => !(k in tables[language]));
}

export function useLanguage(): Language {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current
  );
}
