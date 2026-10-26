import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A sound preview plays from a blob: URL (soundPreview.ts). Without media-src the CSP falls back to default-src
// 'self' and the webview refuses it ("no supported source", user report 10-26).
test('the app CSP lets a sound preview play from a blob URL', () => {
  const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const media = conf.app.security.csp.split(';').find(d => d.trim().startsWith('media-src'));
  assert.ok(media, 'media-src is missing');
  assert.match(media, /\bblob:/);
});
