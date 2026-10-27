import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capturedKey} from '../src/ui/details/keyCapture.ts';
import {nodeCatalog} from '../src/nodes/catalog.ts';
import {markerNames, renameMarker, removeMarker} from '../src/ui/details/markerCatalog.ts';
import {emptyWorkspace, addAction, addLink, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {switchActionKind} from '../src/actionTypes.ts';
import {newStart} from '../src/cards.ts';

test('physical keys cover IME-independent letters, numpad, modifiers and punctuation', () => {
  for (const [code, name] of Object.entries({
    KeyG: 'G',
    Digit1: '1',
    Numpad1: 'Num1',
    NumpadEnter: 'NumEnter',
    AltLeft: 'LAlt',
    F7: 'F7',
    BracketLeft: 'LBracket',
    Escape: 'Esc',
  }))
    assert.equal(capturedKey(code), name);
  assert.equal(capturedKey('Unidentified'), undefined);
});
test('catalog contains existing graph nodes and the carry operation', () => {
  assert.equal(Object.keys(nodeCatalog).length, 20);
  assert.deepEqual(nodeCatalog.carryRelease.fields, ['config.carryRelease']);
  assert.deepEqual(nodeCatalog.carryFix.fields, ['pair.carry.fix']);
  assert.deepEqual(nodeCatalog.qte.outputs, ['pass', 'fail', 'perfect']);
  assert.equal(nodeCatalog.extraEvents, undefined);
  assert.deepEqual(nodeCatalog.suppress.fields, ['config.suppress']);
  assert.deepEqual(nodeCatalog.carry.fields, ['pair.carry']);
  assert.deepEqual(nodeCatalog.result.inputs, ['trigger', 'condition']);
  for (const n of Object.values(nodeCatalog)) {
    assert.ok(['state', 'rule', 'anim'].includes(n.layer));
    assert.ok(Array.isArray(n.fields));
  }
});
test('marker rename preserves references in the registry, windows, globals and cached types', () => {
  let w = emptyWorkspace();
  const a = addAction(w, 'pair');
  w.actions.push(a);
  const b = addAction(w);
  w.actions.push(b);
  w.eventRegistry = [{id: 'event1', name: 'Old', functions: [{id: 'fn1', values: {op: 'hide'}}]}];
  w.starts.push({...newStart(w, {x: 0, y: 0}, 'event'), event: 'Old', to: {action: a.uid}});
  a.camera = {reset: 'Old', restore: 'end', timeout: 10};
  w.globals.cameraReset = 'Old';
  const l = addLink(w, a.uid, b.uid);
  l.event = 'Old';
  l.window = true;
  l.open = {...l.open, basis: 'event', event: 'Old'};
  w.links.push(l);
  w = switchActionKind(w, a.uid, 'single');
  const before = JSON.stringify(w);
  const next = renameMarker(w, 'Old', 'New');
  assert.equal(JSON.stringify(w), before);
  assert.ok(!markerNames(next).includes('Old'));
  assert.equal(next.links[0].open.event, 'New');
  assert.equal(next.eventRegistry[0].name, 'New');
  assert.equal(next.starts[0].event, 'New');
  // Camera restore is the action's (10-16): it stays across the kind switch.
  assert.equal(next.actions[0].camera.reset, 'New');
  assert.deepEqual(parseWorkspace(JSON.stringify(next)), next);
  assert.throws(() => removeMarker(next, 'New'));
  const restored = switchActionKind(next, a.uid, 'pair');
  assert.ok(compileWorkspace(restored).includes('New'));
});
test('unreferenced markers can be deleted while collisions and references are protected', () => {
  const w = emptyWorkspace();
  const a = addAction(w);
  w.actions.push(a);
  a.config.events.push('Unused', 'Existing');
  assert.throws(() => renameMarker(w, 'Unused', 'Existing'));
  assert.throws(() => renameMarker(w, 'Unused', '@bad'));
  assert.ok(!markerNames(removeMarker(w, 'Unused')).includes('Unused'));
});
