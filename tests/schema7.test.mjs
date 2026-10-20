import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {request} from '../src/package.ts';
import {s4sample} from '../src/s4sample.ts';

const asSchema6 = w => {
  const old = structuredClone(w);
  old.schema = 6;
  delete old.xmlVersion;
  delete old.layout;
  return old;
};

test('schema 6 projects load as schema 7 without an output version and with an empty layout, without changing the XML', () => {
  const w = parseWorkspace(JSON.stringify(asSchema6(s4sample())));
  assert.equal(w.schema, 7);
  assert.equal(w.xmlVersion, undefined);
  assert.deepEqual(w.layout, {});
  assert.equal(compileWorkspace(w), compileWorkspace(s4sample(), 2));
  assert.deepEqual(parseWorkspace(JSON.stringify(w)), w);
});

test('retired XML output preferences are ignored and removed on load', () => {
  const w = s4sample();
  const before = compileWorkspace(w);
  w.xmlVersion = 1;
  assert.equal(compileWorkspace(w), before);
  assert.match(compileWorkspace(w), /<AnimationSet version="4"/);
  assert.equal(request(w).xml, compileWorkspace(w));
  const reloaded = parseWorkspace(JSON.stringify(w));
  assert.equal(reloaded.xmlVersion, undefined);
});

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
