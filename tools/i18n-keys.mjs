// The tr() keys of src/ and the checks a translation row must pass (tools/i18n-merge.mjs, korean-coverage test).
import {readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import * as prettier from 'prettier';
import {sourceFiles} from './i18n-korean-scan.mjs';

const root = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const HANGUL = /[가-힣]/;

/** Map of Korean key -> {where, context} for every tr('...') in src/, plus `dynamic`: tr() calls whose key is
 * not a string literal (they cannot be checked). */
export async function trKeys() {
  const keys = new Map();
  keys.dynamic = [];
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (!/\btr(Pattern|Fragment)?\(/.test(text)) continue;
    const {ast} = await prettier.__debug.parse(text, {parser: 'typescript', filepath: file});
    const visit = node => {
      if (!node || typeof node.type !== 'string') return;
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        ['tr', 'trPattern', 'trFragment'].includes(node.callee.name)
      ) {
        const line = text.slice(0, node.range[0]).split('\n').length;
        const where = relative(root, file).replaceAll('\\', '/') + ':' + line;
        const first = node.arguments[0];
        if (first?.type === 'Literal' && typeof first.value === 'string') {
          if (!keys.has(first.value))
            keys.set(first.value, {where, context: text.split('\n')[line - 1].trim().slice(0, 140)});
        } else keys.dynamic.push(where);
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'parent' || k === 'loc' || k === 'range') continue;
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === 'object') visit(v);
      }
    };
    visit(ast);
  }
  return keys;
}

const placeholders = s => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const edge = s => [/^\s*/.exec(s)[0], /\s*$/.exec(s)[0]];

/** What is wrong with a [English, Japanese, Chinese] row for a Korean key (empty when it is fine).
 * Many keys are fragments joined to a value or to other text, so the edges matter:
 * - space the key has on an edge stays (Japanese and Chinese may end in a full-width colon or bracket instead);
 * - an edge without space gets none, except one leading space in English (a fragment that follows a value,
 *   like '개 항목' after a count, reads " items");
 * - a one- or two-letter Korean particle (like '로') may have no English or Chinese words at all. */
export function rowProblems(ko, row) {
  const problems = [];
  if (!Array.isArray(row) || row.length !== 3) return ['not three strings'];
  const particle = ko.trim().length <= 2;
  ['en', 'ja', 'zh'].forEach((language, i) => {
    const text = row[i];
    if (typeof text !== 'string') return problems.push(`${language} not text`);
    if (!text.trim() && ko.trim() && !(particle && language !== 'ja')) return problems.push(`${language} empty`);
    if (HANGUL.test(text)) problems.push(`${language} has Korean`);
    if (placeholders(text) !== placeholders(ko)) problems.push(`${language} placeholders`);
    if (!text.trim()) return;
    const [lead, trail] = edge(ko),
      [l, t] = edge(text);
    const leadOk = lead ? l === lead : !l || (language === 'en' && l === ' ');
    const trailOk = trail ? t === trail || (language !== 'en' && /[：）」】]$/.test(text)) : !t;
    if (!leadOk || !trailOk) problems.push(`${language} edge spaces`);
  });
  return problems;
}
