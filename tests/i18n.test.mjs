import {test} from 'node:test';
import assert from 'node:assert/strict';
import {t, localeKeys, missingKeys, supportedLanguages} from '../src/i18n/index.ts';
import {en} from '../src/i18n/locales/en.ts';
import {ko} from '../src/i18n/locales/ko.ts';
import {ja} from '../src/i18n/locales/ja.ts';
import {zh} from '../src/i18n/locales/zh.ts';

test('korean table covers every reference key and has no extras', () => {
  assert.deepEqual(missingKeys('ko'), []);
  const extra = Object.keys(ko).filter(k => !(k in en));
  assert.deepEqual(extra, []);
});

test('all four languages cover every key and preserve placeholders', () => {
  const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [lang, table] of Object.entries({en, ko, ja, zh})) {
    assert.deepEqual(missingKeys(lang), [], lang);
    assert.deepEqual(
      Object.keys(table).filter(k => !(k in en)),
      [],
      lang + ' extras'
    );
    for (const key of localeKeys()) assert.deepEqual(placeholders(table[key]), placeholders(en[key]), lang + ' ' + key);
  }
  for (const lang of supportedLanguages) {
    for (const key of localeKeys()) {
      const text = t(key, undefined, lang);
      assert.ok(text.length > 0, lang + ' ' + key);
    }
  }
  assert.equal(t('menu.file.saveAs', undefined, 'ja'), '名前を付けて保存…');
  assert.equal(t('node.state', undefined, 'ja'), 'アクション');
  assert.equal(t('node.state', undefined, 'zh'), '动作');
});

test('placeholders are substituted and unknown keys return the key', () => {
  assert.equal(t('compile.passed', {errors: 0, warnings: 1}, 'ko'), '컴파일 통과 · 오류 0 · 경고 1');
  assert.equal(t('does.not.exist', undefined, 'ko'), 'does.not.exist');
});

// Keys built from a value (`t('actionKind.' + kind)`) are not seen by the static key scan: the action kind
// labels once disappeared with the start templates that shared them (2026-10-01).
test('every action kind has its label in every language', async () => {
  const {playbackKinds} = await import('../src/actionTypes.ts');
  for (const lang of supportedLanguages)
    for (const kind of playbackKinds)
      assert.notEqual(t('actionKind.' + kind, undefined, lang), 'actionKind.' + kind, lang);
});
