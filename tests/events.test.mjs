import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';
import {mark} from '../src/model.ts';
import {newStart} from '../src/cards.ts';
import {addMarker, markerNames, markerUses, renameMarker, removeMarker} from '../src/ui/details/markerCatalog.ts';

test('events can be added without actions, saved as graph source, renamed and deleted', () => {
  let w = addMarker(emptyWorkspace(), 'ComboOpen');
  assert.equal(w.actions.length, 0);
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.deepEqual(markerNames(w), ['ComboOpen']);
  assert.deepEqual(markerUses(w, 'ComboOpen'), []);
  w = renameMarker(w, 'ComboOpen', 'WindowOpen');
  assert.deepEqual(markerNames(w), ['WindowOpen']);
  assert.deepEqual(markerNames(removeMarker(w, 'WindowOpen')), []);
  assert.throws(() => addMarker(w, 'WindowOpen'));
  assert.throws(() => addMarker(w, 'bad|name'));
  assert.throws(() =>
    parseWorkspace(JSON.stringify({...emptyWorkspace(), eventRegistry: [{id: 'e', name: 'A', functions: [], x: 1}]}))
  );
});
test('rename includes start cards going nowhere, cancel windows and saved action variants', () => {
  let w = emptyWorkspace();
  const a = addAction(w);
  a.config.steps[0].clip = 'Animations/Test.hkx';
  w.actions.push(a);
  const event = {...mark(), basis: 'event', event: 'ComboOpen', fallback: false};
  a.clipWindows = {[a.config.steps[0].id]: {open: structuredClone(event), close: mark(0, 'end'), buffered: true}};
  a.cancels.push({
    id: 'cancel',
    to: 'vanilla:Attack',
    open: structuredClone(event),
    close: mark(0, 'end'),
    buffered: true,
    blend: null,
  });
  a.variants.single = structuredClone(a);
  delete a.variants.single.variants;
  // A start card that goes nowhere yet.
  w.starts.push({...newStart(w, {x: 100, y: 100}, 'event'), event: 'ComboOpen'});
  assert.ok(markerUses(w, 'ComboOpen').some(s => s.includes('시작 카드')));
  assert.throws(() => removeMarker(w, 'ComboOpen'), /사용 중인 이벤트/);
  w = renameMarker(w, 'ComboOpen', 'WindowOpen');
  assert.ok(!markerNames(w).includes('ComboOpen'));
  assert.equal(w.starts[0].event, 'WindowOpen');
  assert.equal(w.actions[0].cancels[0].open.event, 'WindowOpen');
  assert.equal(w.actions[0].variants.single.cancels[0].open.event, 'WindowOpen');
  // The renamed event is used by actual XML, rather than only by the catalog.
  w.starts[0].to = {action: a.uid};
  w.actions[0].variants = {};
  const xml = compileWorkspace(w);
  assert.match(xml, /<Start to="[^"]+" event="WindowOpen"/);
  assert.ok(xml.includes('event:WindowOpen'));
  assert.ok(!xml.includes('ComboOpen'));
  const restored = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(restored.actions[0].cancels[0].open.event, 'WindowOpen');
});
