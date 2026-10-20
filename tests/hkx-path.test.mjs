import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hkxPathOk} from '../src/model.ts';
import {emptyWorkspace, addAction, validateWorkspace} from '../src/workspace.ts';

// HKX paths are printable ASCII: the engine opens animation files through code-page paths, so a Korean
// name is never found (runtime 0.12.228 rejects such a declaration; XmlV2 clip()).
const symbols = "Animations\\Test Mod-1\\Attack_2+Alt (A)[b]!#$%&',;=@^~{}`.hkx";

test('HKX path rule: letters, digits and the symbols Windows allows in names', () => {
  for (const ok of ['Animations\\Grapple\\Grapple_Lift.hkx', 'Animations/a-b+c.hkx', symbols])
    assert.ok(hkxPathOk(ok), ok);
  for (const bad of [
    'Animations\\잡기\\Grapple.hkx',
    'Animations\\테스트.hkx',
    'Animations\\Café.hkx',
    'Animations\\a😀.hkx',
    'Animations\\a*.hkx',
    'Animations\\a?.hkx',
    'Animations\\a"b.hkx',
    'Animations\\a<b>.hkx',
    'Animations\\a|b.hkx',
    'Animations\\a\tb.hkx',
  ])
    assert.ok(!hkxPathOk(bad), bad);
});

test('HKX path rule: a non-ASCII clip is a project error, symbols are not', () => {
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  const rule = (issues, uid) =>
    issues.filter(i => i.level === 'error' && i.node === uid && /영문·숫자/.test(i.message));
  w.actions[0].config.steps[0].clip = 'Animations\\잡기\\Grapple.hkx';
  assert.equal(rule(validateWorkspace(w), w.actions[0].uid).length, 1);
  w.actions[0].config.steps[0].clip = symbols;
  assert.equal(rule(validateWorkspace(w), w.actions[0].uid).length, 0);
});
