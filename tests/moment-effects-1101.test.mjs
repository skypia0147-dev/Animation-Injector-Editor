import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {flatGraph, deleteFlat} from '../src/graph/flat.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {conditionName} from '../src/graph/conditionExpression.ts';
import {extensionError} from '../src/graph/conditionExtensions.ts';

// The 11-01 cleanup (docs/기능-설정-조건-정리-2026-10-31.md, docs/mockup-moment-effects): one magic function, the
// vanilla transition as a transition card, the states as options of one check.

const head =
  '<?xml version="1.0" encoding="utf-8"?>\n<AnimationSet version="6" id="Test"><Inputs><Input id="use" key="LAlt"/></Inputs>';
const xml = (body, registry = '') =>
  head +
  registry +
  '<Start input="use" to="Dodge"/><Action id="Dodge" clip="Animations\\Dodge.hkx">' +
  body +
  '</Action></AnimationSet>';

test('the magic function reads and writes op="magic" with its action, held as one op per action', () => {
  const w = importWorkspaceXml(
    xml(
      '<Do at="0.2" op="magic" action="add" plugin="My.esp" form="801"/>',
      '<EventRegistry><Event name="Buff_Off"><Do op="magic" action="remove" plugin="My.esp" form="801"/></Event>' +
        '<Event name="Fire"><Do op="magic" action="cast" plugin="My.esp" form="802"/></Event></EventRegistry>'
    )
  );
  assert.equal(w.actions[0].config.effects[0].values.op, 'magicAdd');
  assert.deepEqual(
    w.eventRegistry.map(r => r.functions[0].values.op),
    ['magicRemove', 'magicCast']
  );
  const out = compileWorkspace(w);
  assert.match(out, /<Do at="0\.2" op="magic" action="add" plugin="My\.esp" form="801"\/>/);
  assert.match(out, /<Do op="magic" action="remove" plugin="My\.esp" form="801"\/>/);
  assert.match(out, /<Do op="magic" action="cast" plugin="My\.esp" form="802"\/>/);
  assert.ok(!validateWorkspace(w).some(i => i.level === 'error'));
  for (const bad of [
    '<Do at="0" op="magic" plugin="My.esp" form="1"/>',
    '<Do at="0" op="magic" action="learn" plugin="My.esp" form="1"/>',
    '<Do at="0" op="hide" action="add"/>',
    '<Do at="0" op="spell" plugin="My.esp" form="1"/>',
    '<Do at="0" op="stateOn" plugin="My.esp" form="1"/>',
  ])
    assert.throws(() => importWorkspaceXml(xml(bad)), bad);
});

test('a state names the state it picks; in the air at all has no fall distance', () => {
  assert.equal(conditionName({kind: 'actorStatus', option: 'weaponDrawn'}), '무기 뽑음');
  assert.equal(conditionName({kind: 'actorStatus', option: 'weaponDrawn,combat'}), '무기 뽑음·전투 중');
  assert.equal(conditionName({kind: 'protection', option: 'essential'}), '필수 대상');
  assert.equal(conditionName({kind: 'air', option: 'any'}), '공중');
  assert.equal(conditionName({kind: 'air', option: 'falling'}), '떨어지는 중');
  const air = {id: 'a', kind: 'air', subject: 'self'};
  assert.equal(extensionError({...air, option: 'falling', compare: 'ge', value: 200}), undefined);
  assert.ok(extensionError({...air, option: 'any', compare: 'ge', value: 200}));
  assert.ok(
    extensionError({
      id: 'h',
      kind: 'actorValue',
      option: 'Health',
      compare: 'ge',
      value: 1,
      subject: 'self',
    })
  );
});
