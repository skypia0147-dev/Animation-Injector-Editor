import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, connectFlat, flatNode} from '../src/graph/flat.ts';
import {captureGraph} from '../src/graph/document.ts';
import {playbackLink} from '../src/graph/playback.ts';
import {mark} from '../src/model.ts';
import {setSourceWindow} from '../src/graph/clipWindows.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checker, needsChecker} from './local.mjs';

function fixture() {
  let w = emptyWorkspace();
  for (let i = 0; i < 2; i++) {
    w = addFlat(w, '', 'playNode', {x: i * 400, y: 200}).workspace;
    w.actions[i].config.steps[0].clip = `Animations/Test${i}.hkx`;
  }
  return w;
}
test('distinct cooldown and per-HKX feature attachment survive graph save and native XML parsing', needsChecker, () => {
  let w = fixture();
  w.actions[1].config.cooldown = 1.23;
  let d = addFlat(w, 'a1', 'notify:iframe', {x: 40, y: 80});
  w = connectFlat(d.workspace, d.id, 'anim:a2:|clip_A1');
  assert.equal(w.actions[0].config.slots.iframe.enabled, false);
  assert.equal(w.actions[1].config.slots.iframe.enabled, true);
  w = playbackLink(w, 'a1', 'a2', {id: 'H', label: 'H', key: 'H', gamepad: 0}).workspace;
  w.actions[0] = setSourceWindow(w.actions[0], 'A1', {
    open: mark(0.3),
    close: {...mark(0.1, 'end'), basis: 'event', event: 'Close', fallback: true},
    buffered: true,
  });
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  const dir = resolve('tests/generated/playback');
  mkdirSync(dir, {recursive: true});
  for (const version of [1, 2]) writeFileSync(resolve(dir, `v${version}.xml`), compileWorkspace(w, version));
  const p = spawnSync(checker, ['--compare', resolve(dir, 'v1.xml'), resolve(dir, 'v2.xml')], {encoding: 'utf8'});
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const re = importWorkspaceXml(compileWorkspace(w));
  assert.equal(re.actions[1].config.cooldown, 1.23);
  assert.equal(re.actions[1].config.slots.iframe.enabled, true);
  assert.equal(re.links[0].close.fallbackBasis, 'end');
  assert.equal(re.links[0].close.seconds, 0.1);
});

test('two keys to the same HKX carry independent blends through graph, XML and the native parser', needsChecker, () => {
  let w = fixture();
  for (const key of ['G', 'H']) w = playbackLink(w, 'a1', 'a2', {id: key, label: key, key, gamepad: 0}).workspace;
  w.links[0].blend = 0.15;
  w.links[1].blend = 1.25;
  const original = structuredClone(w);
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.deepEqual(
    w.links.map(l => l.blend),
    [0.15, 1.25]
  );
  const dir = resolve('tests/generated/direct-links');
  mkdirSync(dir, {recursive: true});
  for (const v of [1, 2]) {
    const xml = compileWorkspace(w, v);
    writeFileSync(resolve(dir, `v${v}.xml`), xml);
    assert.deepEqual(
      importWorkspaceXml(xml).links.map(l => l.blend),
      [0.15, 1.25]
    );
  }
  const p = spawnSync(checker, ['--compare', resolve(dir, 'v1.xml'), resolve(dir, 'v2.xml')], {encoding: 'utf8'});
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.deepEqual(
    w.links.map(l => l.blend),
    original.links.map(l => l.blend)
  );
});
