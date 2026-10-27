import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, emptyWorkspace, wrap, validateWorkspace} from '../src/workspace.ts';
import {createProject, parseProject} from '../src/model.ts';
import {parseXml, documentXml} from '../src/xml.ts';
import {equippedTypes, attackStates, eventListError} from '../src/runtimeExtensions.ts';
import {captureGraph} from '../src/graph/document.ts';
import {flatGraph, addFlat, connectFlat, deleteFlat} from '../src/graph/flat.ts';
import {disconnectEdge} from '../src/graph/commands.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {checker, needsChecker, runtimeSource, needsRuntimeSource} from './local.mjs';

// Every test here reads the runtime's Dynamic Dodge Shot port; most also run the runtime checker.
const needsRuntime = {skip: needsRuntimeSource.skip || needsChecker.skip};

const folder = 'tests/generated/runtime-extensions';
fs.mkdirSync(folder, {recursive: true});
// The Dynamic Dodge Shot port (runtime test data, format 6).
const source = `${runtimeSource}/tests/data/dynamic-dodge-shot.xml`;
// The editor leaves Advanced safety out (10-23): the port without it is what an export means.
const raw = (fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : '')
  .replace(/ safety="[^"]*"/g, '')
  .replace(/^[ \t]*<Advanced\/>\r?\n/gm, '');
const runtime = (...args) => {
  const r = spawnSync(checker, args, {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
};

// The bow check of the port's start card.
const bowCheck = w => w.cards.flatMap(c => c.tests).find(t => t.kind === 'equippedType' && t.equipmentType === 'bow');

test(
  'the Dynamic Dodge Shot port opens, saves and writes back the same declarations (format 6, 1:1)',
  needsRuntime,
  () => {
    const w = importWorkspaceXml(raw),
      saved = parseWorkspace(JSON.stringify(captureGraph(w))),
      out = compileWorkspace(saved);
    // Its direction picking is the start's condition card (the selecting action of format 4 is gone).
    assert.deepEqual(
      w.actions.map(a => a.config.actionId),
      ['BowDodge_B1', 'BowDodge_L1', 'BowDodge_R1', 'SneakBowDodge_B1', 'SneakBowDodge_L1', 'SneakBowDodge_R1']
    );
    assert.equal(w.starts.length, 1);
    assert.ok(w.cards.length >= 3);
    fs.writeFileSync(folder + '/source.xml', raw);
    fs.writeFileSync(folder + '/roundtrip.xml', out);
    runtime('--compare-starts', folder + '/source.xml', folder + '/roundtrip.xml');
    // Written once by the editor, it reads and writes back the same text.
    assert.equal(compileWorkspace(importWorkspaceXml(out)), out);
    assert.match(out, /<Start id="BowDodge" key="Mouse2" cooldown="0.2" block="blockStart,bashStart">/);
  }
);

test(
  'all equipment/attack-state names and sneaking export to native predicates; bad attrs rejected',
  needsRuntime,
  () => {
    for (const [kind, values, field] of [
      ['equippedType', equippedTypes, 'equipmentType'],
      ['attackState', attackStates, 'attackState'],
      ['sneaking', [undefined], 'unused'],
    ])
      for (const value of values) {
        const w = importWorkspaceXml(raw),
          t = bowCheck(w);
        if (kind !== 'equippedType') {
          delete t.hand;
          delete t.equipmentType;
        }
        Object.assign(t, {
          kind,
          ...(value ? {[field]: value} : {}),
          ...(kind === 'equippedType' ? {hand: 'right'} : {}),
        });
        const out = compileWorkspace(w);
        fs.writeFileSync(folder + '/predicate.xml', out);
        runtime(folder + '/predicate.xml');
        const reread = importWorkspaceXml(out)
          .cards.flatMap(c => c.tests)
          .find(x => x.kind === kind && (!value || x[field] === value));
        assert.ok(reread, kind + ' ' + value);
        if (value) assert.equal(reread[field], value);
      }
    for (const replacement of [
      'kind="equippedType" hand="feet" type="bow"',
      'kind="equippedType" type="bow"',
      'kind="attackState" state="typo"',
      'kind="sneaking" hand="left" type="bow"',
      'kind="sneaking" state="none"',
    ])
      assert.throws(() => importWorkspaceXml(raw.replace('kind="equippedType" hand="left" type="bow"', replacement)));
  }
);

test('a block item adds, edits, cuts and deletes on its HKX card without affecting playback', needsRuntime, () => {
  let w = importWorkspaceXml(raw);
  const hkx = 'anim:a2:|clip_A1';
  assert.ok(contextualAdds(w, hkx).some(o => o.kind === 'suppress'));
  // Registering annotation names moved to the event registry (format 3).
  assert.ok(!contextualAdds(w, hkx).some(o => o.kind === 'extraEvents'));
  const added = addConnected(w, hkx, {kind: 'suppress', label: 'suppress'}, {x: 200, y: 200});
  w = added.workspace;
  // An HKX blocks while it plays (format 6 <Action block>); a block while it can start is its start card's.
  assert.deepEqual(w.actions[1].config.suppress, {events: [''], when: 'active'});
  w.actions[1].config.suppress.events = ['blockStart'];
  const node = flatGraph(w).nodes.find(n => n.action === 'a2' && n.kind === 'suppress');
  assert.ok(node);
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.match(compileWorkspace(w), /<Action id="BowDodge_L1" clip="[^"]+" block="blockStart">/);
  // Cutting its line takes the item off, as deleting it does.
  const edge = flatGraph(w).edges.find(e => e.target === node.id);
  assert.ok(edge);
  const off = disconnectEdge(w, edge);
  assert.equal(off.actions[1].config.suppress, undefined);
  assert.doesNotMatch(compileWorkspace(off), /BowDodge_L1" clip="[^"]+" block=/);
  const deleted = deleteFlat(w, node.id);
  assert.equal(deleted.actions[1].config.suppress, undefined);
  assert.equal(deleted.actions[1].config.steps.length, 1);
});

test(
  'suppression survives input edits; events reject empty, control, byte overflow; corrupt saves rejected',
  needsRuntime,
  () => {
    const w = importWorkspaceXml(raw);
    // A start card's block: while it can start, while what it started plays, or both.
    for (const when of ['startable', 'active', 'both']) {
      w.starts[0].block.when = when;
      assert.equal(importWorkspaceXml(compileWorkspace(w)).starts[0].block.when, when);
    }
    for (const events of [[], [''], ['a', ''], ['한'.repeat(22)], ['a\tb']]) assert.ok(eventListError(events));
    assert.equal(eventListError(['한'.repeat(21)]), undefined);
    const p = structuredClone(w.actions[0].config);
    p.suppress = {events: ['blockStart'], when: 'always'};
    assert.throws(() => parseProject(JSON.stringify(p)));
    const corrupt = structuredClone(w);
    corrupt.actions[0].config.suppress = {events: ['blockStart'], when: 'active', extra: true};
    assert.throws(() => parseWorkspace(JSON.stringify(corrupt)));
  }
);

// Firing an arrow is the direct shot only (runtime 0.12.303): an event's shot the registry's fireArrow with each
// HKX's damage; a clip-time shot an ordinary action's timed fireArrow. No way to pick, no button release, no delay.
test('an event shot: the HKX holds its damage, checked by the runtime', needsRuntime, async () => {
  const {setNodeValues, nodeValues, functionErrors, fieldsOf, valueFields} = await import('../src/eventRegistry.ts');
  assert.deepEqual(fieldsOf('fireArrow'), ['damage'], 'its damage is its one setting');
  assert.deepEqual(valueFields('fireArrow'), ['damage'], "an HKX's values: no delay row");
  let w = importWorkspaceXml(raw);
  const row = w => w.eventRegistry.find(r => r.name === 'DodgeShotFire'),
    fn = w => row(w).functions[0];
  assert.deepEqual(fn(w).values, {op: 'fireArrow'}, 'the registry holds no numbers');
  assert.equal(nodeValues(w.actions[0], row(w), fn(w)), undefined, 'the port shoots at 100%');
  w = setNodeValues(w, w.actions[0].uid, row(w), fn(w), {damage: '50'});
  assert.deepEqual(nodeValues(w.actions[0], row(w), fn(w)), {op: 'fireArrow', damage: '50'});
  let xml = compileWorkspace(w);
  assert.match(xml, /<EventValues>\s*<Event name="DodgeShotFire">\s*<Do op="fireArrow" damage="50"\/>/);
  assert.doesNotMatch(xml, /<FireArrow|onRelease|mode="/);
  fs.writeFileSync(folder + '/fire-event.xml', xml);
  runtime(folder + '/fire-event.xml');
  // Only the damage is kept: what the shot no longer has is not written.
  w = setNodeValues(w, w.actions[1].uid, row(w), fn(w), {damage: '80', mode: 'direct', onRelease: 'true', delay: '1'});
  assert.deepEqual(nodeValues(w.actions[1], row(w), fn(w)), {op: 'fireArrow', damage: '80'});
  xml = compileWorkspace(w);
  assert.match(
    xml.split('id="BowDodge_L1"')[1].split('</Action>')[0],
    /<EventValues>\s*<Event name="DodgeShotFire">\s*<Do op="fireArrow" damage="80"\/>/
  );
  fs.writeFileSync(folder + '/fire-damage.xml', xml);
  runtime(folder + '/fire-damage.xml');
  // 100% is the default: nothing written, the values gone.
  w = setNodeValues(w, w.actions[2].uid, row(w), fn(w), {damage: '100'});
  assert.equal(compileWorkspace(w).split('id="BowDodge_R1"')[1].split('</Action>')[0].includes('EventValues'), false);
  assert.deepEqual(
    parseWorkspace(JSON.stringify(captureGraph(w))).actions[1].config.eventValues,
    w.actions[1].config.eventValues
  );
  assert.ok(functionErrors({op: 'fireArrow', delay: '0.2'}).length, 'a shot has no delay');
  assert.ok(functionErrors({op: 'hide', damage: '50'}).length, "damage is a shot's");
  for (const attr of ['mode="direct"', 'onRelease="true"', 'delay="0.2"'])
    assert.throws(
      () => importWorkspaceXml(raw.replace('<Do op="fireArrow"/>', `<Do op="fireArrow" ${attr}/>`)),
      undefined,
      attr
    );
  for (const bad of ['<FireArrow/>', '<FireArrow at="0.5"/>'])
    assert.throws(() =>
      importWorkspaceXml(
        '<AnimationSet version="6" id="Test"><Action id="A" clip="a.hkx">' + bad + '</Action></AnimationSet>'
      )
    );
});

test("a clip-time shot: an ordinary action's timed fireArrow, checked by the runtime", needsRuntime, () => {
  let w = importWorkspaceXml(raw);
  const hkx = 'anim:a2:|clip_A1',
    option = () => contextualAdds(w, hkx).find(o => o.kind === 'notify:fireArrow');
  assert.ok(option() && !option().disabled, '「＋ 기능 › 활 발사」 is a moment');
  assert.equal(option().label, '활 발사 추가', 'named as the registry names it, not fireArrow');
  w = addConnected(w, hkx, option(), {x: 0, y: 0}).workspace;
  const shots = () => w.actions[1].config.effects.filter(e => e.values.op === 'fireArrow');
  assert.equal(shots().length, 1);
  assert.ok(!option().disabled, 'more than one may be added');
  shots()[0].values.at = '0.55';
  shots()[0].values.damage = '50';
  w.actions[1].config.effects.push({id: 'effect9', values: {op: 'fireArrow', at: '0.9'}});
  assert.deepEqual(
    validateWorkspace(w).filter(i => i.level === 'error'),
    [],
    'two clip-time shots are fine'
  );
  const xml = compileWorkspace(w);
  const own = xml.split('id="BowDodge_L1"')[1].split('</Action>')[0];
  assert.match(own, /<Do at="0.55" op="fireArrow" damage="50"\/>/);
  assert.match(own, /<Do at="0.9" op="fireArrow"\/>/);
  fs.writeFileSync(folder + '/fire-clip.xml', xml);
  runtime(folder + '/fire-clip.xml');
  const back = importWorkspaceXml(xml);
  assert.deepEqual(back.actions[1].config.effects.find(e => e.values.op === 'fireArrow').values, {
    op: 'fireArrow',
    at: '0.55',
    damage: '50',
  });
});
