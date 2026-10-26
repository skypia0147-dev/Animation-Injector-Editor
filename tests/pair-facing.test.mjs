import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {projectText} from '../tools/projectFile.mjs';
import {parseWorkspace, compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {withFacings, pairSources} from '../src/graph/pairFacing.ts';

// 10-16 (runtime 0.12.259): a pair's alignment wait, tolerance and motion from the root are gone; whether its start
// turns the two to face each other comes from the HKX (graph/pairFacing.ts), not a checkbox.
const grapple = () =>
  parseWorkspace(projectText(fileURLToPath(new URL('./fixtures/grapple-carry-qte-cuts.xml', import.meta.url))));
const byName = (w, name) => w.actions.find(a => a.config.name === name);

test('an XML carrying the removed values imports; only reorientSupport is kept', () => {
  const w = importWorkspaceXml(`<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Facing">
  <Start key="G" to="Behind"/>
  <Pair id="Behind" clip="Animations\\Behind.hkx" reorient="false"/>
</AnimationSet>`);
  const p = w.actions[0].pair;
  assert.equal(p.reorientSupport, false);
  assert.ok(!('getToMarkTime' in p) && !('applyMotionFromRoot' in p));
  assert.match(compileWorkspace(w), /<Pair id="Behind" clip="[^"]+" reorient="false"\/>/);
});

test('a facing read from the HKX sets the pair; a pair facing each other writes nothing', () => {
  const w = grapple();
  const suplex = byName(w, 'GrappleSuplex'),
    front = byName(w, 'GrappleAttackFront');
  const turned = withFacings(
    w,
    new Map([
      [suplex.uid, true],
      [front.uid, false],
    ])
  );
  assert.equal(byName(turned, 'GrappleSuplex').pair.reorientSupport, true);
  assert.equal(byName(turned, 'GrappleAttackFront').pair.reorientSupport, false);
  assert.equal(withFacings(w, new Map()), w);
  assert.equal(
    turned.actions.find(a => a.uid === byName(w, 'GrappleRKO').uid),
    byName(w, 'GrappleRKO')
  );
  // Every Grapple pair with a clip has its file known to the project (its HKX source), so the editor reads them all;
  // the choosing pair (GrappleFront) plays no clip of its own.
  const clipped = w.actions.filter(a => a.pair && a.config.steps.some(s => s.clip));
  assert.equal(pairSources(w).length, clipped.length);
  assert.equal(clipped.length, 14);
});
