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
import {newStart} from '../src/cards.ts';

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
  // A cooldown is its start card's: the second HKX has a start of its own besides the transition into it.
  w.starts.push({...newStart(w, {x: 0, y: 0}), key: 'G', cooldown: 1.23, to: {action: 'a2'}});
  // An item is added on its own HKX card.
  w = addFlat(w, 'a2', 'notify:iframe', {x: 40, y: 80}).workspace;
  assert.equal(w.actions[0].config.slots.iframe.enabled, false);
  assert.equal(w.actions[1].config.slots.iframe.enabled, true);
  w = playbackLink(w, 'a1', 'a2', {id: 'H', label: 'H', key: 'H', gamepad: 0}).workspace;
  w.actions[0] = setSourceWindow(w.actions[0], 'A1', {
    open: mark(0.3),
    close: {...mark(0.1, 'end'), basis: 'event', event: 'Close'},
    buffered: true,
  });
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  const dir = resolve('tests/generated/playback');
  mkdirSync(dir, {recursive: true});
  for (const version of [1, 2]) writeFileSync(resolve(dir, `v${version}.xml`), compileWorkspace(w, version));
  const p = spawnSync(checker, ['--compare', resolve(dir, 'v1.xml'), resolve(dir, 'v2.xml')], {encoding: 'utf8'});
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const re = importWorkspaceXml(compileWorkspace(w));
  assert.equal(re.starts.find(s => s.to.action === re.actions[1].uid).cooldown, 1.23);
  assert.equal(re.actions[1].config.slots.iframe.enabled, true);
  // An event close waits for its event only (runtime 0.12.278).
  assert.equal(re.links[0].close.basis, 'event');
  assert.equal(re.links[0].close.event, 'Close');
  assert.equal(re.links[0].close.fallback, false);
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
