import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {captureGraph} from '../src/graph/document.ts';

// The per-pair end position is gone (runtime 0.12.255): the runtime corrects every pair's end position itself
// (INI [Compatibility] iPairEndPosition) and refuses <EndPosition>. The editor reads an older XML's element and
// drops it, never writes one, and older projects lose the old flag.
const xml =
  '<AnimationSet version="6" id="RootTest"><Pair id="PairTest" clip="Animations\\Other\\Unrelated.hkx"/></AnimationSet>';
test('an older XML opens without its EndPosition and is written without one', () => {
  for (const mode of ['root', 'origin']) {
    const w = importWorkspaceXml(xml.replace('mode="root"', `mode="${mode}"`));
    assert.equal('keepRootPosition' in w.actions[0].pair, false);
    assert.ok(!compileWorkspace(w).includes('EndPosition'));
  }
});
