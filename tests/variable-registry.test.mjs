import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checker, needsChecker} from './local.mjs';

// Graph variables a file registers (runtime 1.1.0, <VariableRegistry>): the editor has no card for them yet, so it
// keeps them as read. A file may hold registrations alone.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="Vars">
  <EventRegistry>
    <Event name="MyDodge">
      <Do op="iframeOn" duration="0.5"/>
    </Event>
  </EventRegistry>
  <VariableRegistry>
    <Variable name="iMy_MoveInput" type="int" source="strafeInput"/>
    <Variable name="iMy_Hit" type="int"/>
    <Variable name="bMy_FollowUp" type="bool"/>
    <Variable name="fMy_Scale" type="float"/>
  </VariableRegistry>
</AnimationSet>
`;

test('registered graph variables read back as written, in a file without actions', needsChecker, () => {
  const w = importWorkspaceXml(XML, 'Vars.xml');
  assert.deepEqual(
    validateWorkspace(w).filter(i => i.level === 'error'),
    []
  );
  assert.deepEqual(w.variables, [
    {name: 'iMy_MoveInput', type: 'int', source: 'strafeInput'},
    {name: 'iMy_Hit', type: 'int'},
    {name: 'bMy_FollowUp', type: 'bool'},
    {name: 'fMy_Scale', type: 'float'},
  ]);
  const xml = compileWorkspace(w);
  assert.match(xml, /<Variable name="iMy_MoveInput" type="int" source="strafeInput"\s*\/>/);
  assert.deepEqual(importWorkspaceXml(xml, 'Vars.xml').variables, w.variables);
  // The saved project keeps them too.
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).variables, w.variables);
  mkdirSync('tests/generated/variable-registry', {recursive: true});
  writeFileSync('tests/generated/variable-registry/Vars.xml', xml);
  const out = execFileSync(checker, ['tests/generated/variable-registry/Vars.xml'], {encoding: 'utf8'});
  assert.match(out, /Valid/);
  assert.match(out, /iMy_MoveInput/);
});

test('what the runtime refuses is refused on reading', () => {
  const bad = (inner, message) =>
    assert.throws(
      () =>
        importWorkspaceXml(
          `<?xml version="1.0" encoding="utf-8"?><AnimationSet version="6" id="V"><VariableRegistry>${inner}</VariableRegistry></AnimationSet>`,
          'V.xml'
        ),
      message
    );
  bad('', /VariableRegistry/);
  bad('<Variable name="a" type="bool" source="moveInput"/>', /int/);
  bad('<Variable name="a" type="int"/><Variable name="A" type="int"/>', /VariableRegistry/);
  bad('<Variable name="a b" type="int"/>', /VariableRegistry/);
  bad('<Variable name="a" type="text"/>', /type/);
  bad('<Variable name="a"/>', /type/);
  bad('<Variable name="a" type="int" source="keys"/>', /source/);
});
