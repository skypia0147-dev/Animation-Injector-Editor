// Merges translations of tr() keys into src/i18n/fromKorean.ts after checking them.
//   node tools/i18n-merge.mjs <translations.json>... [--english <overrides.json>]
// A translations file maps Korean text to [English, Japanese, Chinese]; an overrides file maps Korean text to the
// English to use instead (text written by hand in the code before). Rows already in the table are replaced.
// `node tools/i18n-merge.mjs --missing <out.json>` writes the tr() keys that have no row yet, for translating.
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as prettier from 'prettier';
import {trKeys, rowProblems} from './i18n-keys.mjs';

const root = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const tablePath = join(root, 'src', 'i18n', 'fromKorean.ts');
const {fromKorean} = await import(pathToFileURL(tablePath).href + '?' + Date.now());
const table = {...fromKorean};
const keys = await trKeys();
const args = process.argv.slice(2);

const missingAt = args.indexOf('--missing');
if (missingAt >= 0) {
  const missing = Object.fromEntries([...keys].filter(([k]) => !table[k]));
  writeFileSync(args[missingAt + 1], JSON.stringify(missing, null, 1));
  console.log('missing', Object.keys(missing).length);
  process.exit(0);
}

const englishAt = args.indexOf('--english');
const english = englishAt >= 0 ? JSON.parse(readFileSync(args[englishAt + 1], 'utf8')) : {};
const files = args.filter((a, i) => !a.startsWith('--') && (englishAt < 0 || i !== englishAt + 1));
let added = 0;
const problems = [];
for (const file of files) {
  for (const [ko, row] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
    if (!keys.has(ko)) continue; // no longer in the code
    const next = [english[ko] ?? row[0], row[1], row[2]];
    const wrong = rowProblems(ko, next);
    if (wrong.length) problems.push(`${JSON.stringify(ko)}: ${wrong.join(', ')}`);
    else {
      table[ko] = next;
      added++;
    }
  }
}
for (const [ko, en] of Object.entries(english))
  if (table[ko] && keys.has(ko) && !rowProblems(ko, [en, table[ko][1], table[ko][2]]).length)
    table[ko] = [en, table[ko][1], table[ko][2]];

const sorted = Object.keys(table)
  .filter(k => keys.has(k))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const body = sorted.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`).join('\n');
const source =
  '// Translations for tr() (korean.ts): Korean text -> [English, Japanese, Simplified Chinese].\n' +
  '// Generated and checked by tools/i18n-merge.mjs; tests/korean-coverage.test.mjs requires a row for every key.\n' +
  'export const fromKorean: Record<string, readonly [string, string, string]> = {\n' +
  body +
  '\n};\n';
const options = (await prettier.resolveConfig(tablePath)) ?? {};
writeFileSync(tablePath, await prettier.format(source, {...options, filepath: tablePath}));
console.log('merged', added, 'rows', sorted.length, 'keys', keys.size, 'missing', keys.size - sorted.length);
for (const p of problems) console.log('REJECTED', p);
