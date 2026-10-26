import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {request} from '../src/package.ts';
import {s4sample} from './fixtures/s4sample.ts';

// A schema 6 project held no start or condition cards (an action's start was its own); its actions here start nowhere.
const startless = () => ({...s4sample(), starts: [], cards: [], order: []});
const asSchema6 = w => {
  const old = structuredClone(w);
  old.schema = 6;
  delete old.xmlVersion;
  delete old.layout;
  for (const k of ['starts', 'cards', 'order']) delete old[k];
  return old;
};

test('layout keeps per-graph node coordinates and rejects malformed entries', () => {
  const w = emptyWorkspace();
  w.layout = {root: {a1: {x: 10, y: 20}}, a1: {hkx: {x: 0, y: 0}, out: {x: 300, y: 0}}};
  const back = parseWorkspace(JSON.stringify(w));
  assert.deepEqual(back.layout, w.layout);
  for (const bad of [
    {layout: []},
    {layout: {root: {a1: {x: 1}}}},
    {layout: {root: {a1: {x: 1, y: 2, z: 3}}}},
    {layout: {'bad id': {}}},
    {layout: {root: {a1: {x: Infinity, y: 0}}}},
  ]) {
    assert.throws(() => parseWorkspace(JSON.stringify({...emptyWorkspace(), ...bad})), String(Object.keys(bad)));
  }
});
