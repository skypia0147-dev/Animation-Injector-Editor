import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {emptyWorkspace, compileWorkspace, parseWorkspace, addLink} from '../src/workspace.ts';
import {addFlat, connectFlat, deleteFlat, flatGraph} from '../src/graph/flat.ts';
import {animId} from '../src/graph/blends.ts';
import {captureGraph} from '../src/graph/document.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {checkFlows} from '../src/graph/conditions.ts';
import {s4sample} from '../src/s4sample.ts';
import {checker, needsChecker} from './local.mjs';
function sample() {
  let w = emptyWorkspace();
  w = addFlat(w, '', 'playNode', {x: 600, y: 50}).workspace;
  w = addFlat(w, '', 'playNode', {x: 600, y: 300}).workspace;
  for (const a of w.actions) a.config.steps[0].clip = 'animations\\test.hkx';
  const result = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 250, y: 50});
  return result;
}

test(
  'form conditions round trip with local IDs, reject malformed references and preserve comparison values',
  needsChecker,
  () => {
    for (const kind of ['magicEffect', 'global']) {
      let {workspace: w} = sample();
      const t = w.actions[0].flow.tests[0];
      t.kind = kind;
      t.fail = undefined;
      t.subject = 'self';
      t.form = {plugin: 'FH_Grapple.esp', id: kind === 'global' ? '803' : '82C'};
      if (kind === 'global') t.equals = 1;
      assert.deepEqual(checkFlows(w), []);
      const xml = compileWorkspace(w, 2),
        restored = importWorkspaceXml(xml);
      assert.deepEqual(restored.actions[0].flow, w.actions[0].flow);
      assert.deepEqual(
        parseWorkspace(JSON.stringify(captureGraph(w))).actions[0].flow,
        JSON.parse(JSON.stringify(w.actions[0].flow))
      );
      mkdirSync('tests/generated/conditions', {recursive: true});
      const path = `tests/generated/conditions/${kind}.xml`,
        copy = `tests/generated/conditions/${kind}-reload.xml`;
      writeFileSync(path, xml);
      writeFileSync(copy, compileWorkspace(restored, 2));
      execFileSync(checker, ['--compare', path, copy]);
      for (const id of ['0', 'FF00082C', 'zz', '0x82C']) {
        const bad = structuredClone(w);
        bad.actions[0].flow.tests[0].form.id = id;
        assert.ok(checkFlows(bad).length);
      }
      assert.throws(() => importWorkspaceXml(xml.replace('plugin="FH_Grapple.esp"', 'plugin=""')));
      if (kind === 'global') assert.throws(() => importWorkspaceXml(xml.replace('equals="1"', 'equals="NaN"')));
    }
  }
);
test(
  'space condition preserves candidate and direction through editor/runtime XML and rejects invalid scope',
  needsChecker,
  () => {
    let w = s4sample();
    w = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 0, y: 0}).workspace;
    const t = w.actions[0].flow.tests[0];
    t.kind = 'space';
    t.subject = 'partner';
    t.space = {candidate: w.actions[0].uid, distance: 250, direction: 'partnerBack'};
    t.fail = {action: w.actions[1].uid};
    assert.deepEqual(checkFlows(w), []);
    const xml = compileWorkspace(w, 2),
      restored = importWorkspaceXml(xml);
    assert.deepEqual(restored.actions[0].flow, w.actions[0].flow);
    assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).actions[0].flow, w.actions[0].flow);
    mkdirSync('tests/generated/conditions', {recursive: true});
    writeFileSync('tests/generated/conditions/space.xml', xml);
    execFileSync(checker, ['tests/generated/conditions/space.xml']);
    writeFileSync('tests/generated/conditions/space-reloaded.xml', compileWorkspace(restored, 2));
    execFileSync(checker, [
      '--compare',
      'tests/generated/conditions/space.xml',
      'tests/generated/conditions/space-reloaded.xml',
    ]);
    for (const distance of [0, -1, 2001, NaN]) {
      t.space.distance = distance;
      assert.ok(checkFlows(w).length);
    }
    t.space.distance = 250;
    t.space.candidate = w.actions[2].uid;
    assert.ok(checkFlows(w).length);
    assert.throws(() => importWorkspaceXml(xml.replace('direction="partnerBack"', 'direction="forward"')));
    assert.throws(() => importWorkspaceXml(xml.replace('distance="250"', 'distance="0"')));
  }
);
test('paired condition branch retains paired destination through XML and runtime parser', needsChecker, () => {
  let w = s4sample();
  const added = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 0, y: 0});
  w = added.workspace;
  w = connectFlat(w, added.id, animId(w.actions[1].uid, 'clip_' + w.actions[1].config.entry), 'fail');
  assert.deepEqual(checkFlows(w), []);
  const xml = compileWorkspace(w, 2);
  mkdirSync('tests/generated/conditions', {recursive: true});
  writeFileSync('tests/generated/conditions/pairs.xml', xml);
  execFileSync(checker, ['tests/generated/conditions/pairs.xml']);
  const restored = importWorkspaceXml(xml);
  assert.deepEqual(restored.actions[0].flow, w.actions[0].flow);
  writeFileSync('tests/generated/conditions/pairs-reloaded.xml', compileWorkspace(restored, 2));
  execFileSync(checker, [
    '--compare',
    'tests/generated/conditions/pairs.xml',
    'tests/generated/conditions/pairs-reloaded.xml',
  ]);
});

test('ground condition exports limits and preserves semantics through runtime and editor', needsChecker, () => {
  let w = s4sample();
  w = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 0, y: 0}).workspace;
  const t = w.actions[0].flow.tests[0];
  t.kind = 'ground';
  t.fail = undefined;
  t.space = {candidate: w.actions[0].uid, distance: 0, direction: 'partnerForward'};
  t.ground = {maxRise: 15, maxDrop: 30, maxSlope: 35, radius: 18};
  assert.deepEqual(checkFlows(w), []);
  const xml = compileWorkspace(w, 2),
    restored = importWorkspaceXml(xml);
  assert.deepEqual(restored.actions[0].flow, w.actions[0].flow);
  mkdirSync('tests/generated/conditions', {recursive: true});
  writeFileSync('tests/generated/conditions/ground.xml', xml);
  writeFileSync('tests/generated/conditions/ground-reloaded.xml', compileWorkspace(restored, 2));
  execFileSync(checker, [
    '--compare',
    'tests/generated/conditions/ground.xml',
    'tests/generated/conditions/ground-reloaded.xml',
  ]);
  for (const [field, value] of [
    ['maxRise', -1],
    ['maxDrop', 501],
    ['maxSlope', 81],
    ['radius', 0],
    ['maxSlope', NaN],
  ]) {
    const bad = structuredClone(w);
    bad.actions[0].flow.tests[0].ground[field] = value;
    assert.ok(checkFlows(bad).length);
  }
  assert.throws(() => importWorkspaceXml(xml.replace('maxSlope="35"', 'maxSlope="90"')));
});
test('condition branches persist in graph document and XML with both destinations', needsChecker, () => {
  let {workspace: w, id} = sample();
  w = connectFlat(w, id, animId(w.actions[1].uid, 'clip_' + w.actions[1].config.entry), 'fail');
  assert.deepEqual(checkFlows(w), []);
  assert.deepEqual(parseWorkspace(JSON.stringify(captureGraph(w))).actions[0].flow, w.actions[0].flow);
  const xml = compileWorkspace(w, 2);
  mkdirSync('tests/generated/conditions', {recursive: true});
  writeFileSync('tests/generated/conditions/branches.xml', xml);
  execFileSync(checker, ['tests/generated/conditions/branches.xml']);
  const restored = importWorkspaceXml(xml);
  assert.equal(restored.actions[0].flow.tests[0].fail.action, restored.actions[1].uid);
  assert.equal(compileWorkspace(restored, 2), xml);
  assert.equal(flatGraph(w).edges.filter(e => e.source === id).length, 2);
});
test('condition links support serial fallback, diagnose cycles and delete only one node', () => {
  let {workspace: w, id} = sample();
  const second = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 400, y: 300});
  w = second.workspace;
  w = connectFlat(w, id, second.id, 'fail');
  assert.deepEqual(checkFlows(w), []);
  assert.throws(() => connectFlat(w, second.id, id, 'fail'), /순환/);
  const deleted = deleteFlat(w, second.id);
  assert.equal(deleted.actions.length, 2);
  assert.equal(deleted.actions[0].flow.tests.length, 1);
  assert.equal(deleted.actions[0].flow.tests[0].fail, undefined);
  assert.equal(deleteFlat(deleted, id).actions[0].flow, undefined);
});

test('nested AND OR NOT groups round trip and reject cycles and branching operands', needsChecker, () => {
  let {workspace: w} = sample();
  const f = w.actions[0].flow;
  f.entry = 'Group';
  f.tests = [
    {
      id: 'Group',
      kind: 'all',
      subject: 'self',
      minimum: 0,
      operands: ['Either', 'Inverse'],
      pass: {action: w.actions[0].uid},
    },
    {id: 'Either', kind: 'any', subject: 'self', minimum: 0, operands: ['Combat', 'Drawn']},
    {id: 'Inverse', kind: 'air', negate: true, subject: 'self', minimum: 0},
    ...[
      ['Combat', 'combat'],
      ['Drawn', 'weaponDrawn'],
    ].map(([id, kind]) => ({id, kind, subject: 'self', minimum: 0})),
  ];
  assert.deepEqual(checkFlows(w), []);
  const xml = compileWorkspace(w, 2),
    copy = compileWorkspace(importWorkspaceXml(xml), 2);
  const projected = flatGraph(importWorkspaceXml(xml));
  const dependencies = projected.edges.filter(e => e.id.startsWith('operand:'));
  assert.equal(dependencies.length, 4);
  for (const e of dependencies) {
    assert.ok(projected.nodes.find(n => n.id === e.source)?.outputs.includes(e.pin));
    assert.ok(projected.nodes.find(n => n.id === e.target)?.inputs.includes(e.targetPin));
  }
  assert.throws(() => connectFlat(w, `flow:${w.actions[0].uid}:Group`, `flow:${w.actions[0].uid}:Either`, 'condition'));
  mkdirSync('tests/generated/conditions', {recursive: true});
  writeFileSync('tests/generated/conditions/groups.xml', xml);
  writeFileSync('tests/generated/conditions/groups-copy.xml', copy);
  execFileSync(checker, [
    '--compare',
    'tests/generated/conditions/groups.xml',
    'tests/generated/conditions/groups-copy.xml',
  ]);
  assert.deepEqual(checkFlows(parseWorkspace(JSON.stringify(captureGraph(w)))), []);
  const bad = structuredClone(w);
  bad.actions[0].flow.tests[1].operands = ['Group'];
  assert.ok(checkFlows(bad).length);
  const connected = structuredClone(w);
  connected.actions[0].flow.tests[3].pass = {action: w.actions[0].uid};
  assert.ok(checkFlows(connected).length);
  const deleted = deleteFlat(deleteFlat(w, `flow:${w.actions[0].uid}:Combat`), `flow:${w.actions[0].uid}:Drawn`);
  assert.deepEqual(deleted.actions[0].flow.tests.find(t => t.id === 'Either').operands, []);
  assert.ok(checkFlows(deleted).length);
});

test('conditional ordinary link retains explicit blend through editor XML', () => {
  let {workspace: w} = sample();
  w = addFlat(w, '', 'playNode', {x: 900, y: 300}).workspace;
  w.actions[2].config.steps[0].clip = 'animations\\third.hkx';
  const host = w.actions[0];
  host.flow.tests[0].fail = {action: w.actions[2].uid};
  const link = addLink(w, w.actions[1].uid, host.uid);
  link.event = 'Next';
  link.blend = 0.7;
  w.links.push(link);
  assert.deepEqual(checkFlows(w), []);
  const restored = importWorkspaceXml(compileWorkspace(w, 2));
  assert.equal(restored.links[0].blend, 0.7);
  host.flow.tests[0].fail = {action: w.actions[1].uid};
  assert.ok(checkFlows(w).length);
});
