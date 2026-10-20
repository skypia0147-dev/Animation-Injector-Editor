import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {sourceFiles, scanFile} from '../tools/i18n-korean-scan.mjs';
import {trKeys, rowProblems} from '../tools/i18n-keys.mjs';
import {fromKorean} from '../src/i18n/fromKorean.ts';

// The editor ships in English, Korean, Japanese and Chinese. Korean written in src/ is shown through tr()
// (src/i18n/korean.ts), whose table must give the other three languages. New Korean text needs both:
//   wrap it in tr('...'), then `node tools/i18n-merge.mjs --missing <file>`, translate, and merge.
test('Korean text in src/ is shown through tr()', async () => {
  const bare = [];
  for (const file of sourceFiles(join(process.cwd(), 'src')))
    for (const found of await scanFile(file))
      if (!found.context.includes('wrapped')) bare.push(`${file}:${found.start} ${found.text.slice(0, 60)}`);
  assert.deepEqual(bare, []);
});

test('every tr() key has English, Japanese and Chinese', async () => {
  const keys = await trKeys();
  assert.deepEqual(keys.dynamic, [], 'tr() takes the Korean text itself, so it can be checked');
  const missing = [...keys.keys()].filter(k => !fromKorean[k]);
  assert.deepEqual(missing.slice(0, 20), [], `${missing.length} keys without a translation`);
  const wrong = [...keys.keys()].flatMap(k => rowProblems(k, fromKorean[k]).map(p => `${JSON.stringify(k)}: ${p}`));
  assert.deepEqual(wrong.slice(0, 20), []);
});
