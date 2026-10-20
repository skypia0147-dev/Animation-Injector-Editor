import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, wrap, compileWorkspace} from '../src/workspace.ts';
import {createProject} from '../src/model.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {flatGraph, addFlat, connectFlat} from '../src/graph/flat.ts';
import {presentCard} from '../src/graph/cardPresentation.ts';
import {qteErrors} from '../src/qte.ts';

// A hidden QTE (runtime 0.12.266): nothing on screen, the input and its results only.
test('a hidden QTE is written, read back and named on its card', () => {
  let w = emptyWorkspace();
  const p = createProject('single');
  p.actionId = 'Mash';
  p.name = 'Mash';
  p.steps[0].clip = 'Animations\Mash.hkx';
  p.start.mode = 'none';
  w.actions.push(wrap(p, 'a1'));
  const added = addFlat(w, 'a1', 'qte', {x: 420, y: 160});
  w = added.workspace;
  const play = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay');
  w = connectFlat(w, play.id, added.id, 'trigger');
  assert.doesNotMatch(compileWorkspace(w), /hidden=/);
  w.qtes[0].type = 'rapidPress';
  w.qtes[0].pressCount = 5;
  w.qtes[0].hidden = true;
  assert.deepEqual(qteErrors(w), []);
  const xml = compileWorkspace(w);
  assert.match(xml, /<QTE id="QTE1"[^>]* hidden="true"/);
  const back = importWorkspaceXml(xml);
  assert.equal(back.qtes[0].hidden, true);
  assert.equal(compileWorkspace(back), xml);
  assert.match(
    presentCard(
      w,
      flatGraph(w).nodes.find(n => n.id === added.id)
    ).qte.typeName,
    /화면 표시 없음/
  );
  assert.throws(() => importWorkspaceXml(xml.replace('hidden="true"', 'hidden="yes"')), /hidden/);
});
