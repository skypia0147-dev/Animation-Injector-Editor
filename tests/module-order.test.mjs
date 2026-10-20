// Loaded first, before workspace.ts: an import cycle that reads a value at load time fails here (the camera
// restore helper once made eventRegistry.ts -> workspace.ts -> eventRegistry.ts break the UI recreation tool).
import {splitValues} from '../src/eventRegistry.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('the event registry loads before the workspace module', () => {
  assert.deepEqual(splitValues('a b'), ['a', 'b']);
});
