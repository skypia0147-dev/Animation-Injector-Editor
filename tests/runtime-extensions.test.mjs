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

test('FireArrow timing, graph lifecycle and Pair rejection round-trip through the runtime', needsRuntime, () => {
  let w = importWorkspaceXml(raw);
  const a = w.actions[1];
  // The action keeps the release shot; the event shot is a registered function.
  assert.deepEqual(a.config.fireArrow, {at: null, onRelease: true});
  const shot = w.eventRegistry.find(r => r.name === 'DodgeShotFire');
  assert.deepEqual(
    shot.functions.map(f => f.values),
    [{op: 'fireArrow'}]
  );
  let node = flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'fireArrow');
  assert.ok(node);
  a.config.fireArrow = {
    at: {basis: 'seconds', seconds: 0.67, event: '', fallback: false, fallbackBasis: 'seconds'},
    onRelease: false,
  };
  w = parseWorkspace(JSON.stringify(captureGraph(w)));
  let xml = compileWorkspace(w);
  assert.match(xml, /<FireArrow at="0.67" onRelease="false"\/>/);
  fs.writeFileSync(folder + '/fire.xml', xml);
  runtime(folder + '/fire.xml');
  // Cutting its line takes the shot off, as deleting it does.
  const edge = flatGraph(w).edges.find(e => e.target === node.id);
  const cut = disconnectEdge(w, edge);
  assert.equal(importWorkspaceXml(compileWorkspace(cut)).actions[1].config.fireArrow, undefined);
  w = deleteFlat(w, node.id);
  assert.equal(w.actions[1].config.fireArrow, undefined);
  const hkx = 'anim:a2:|clip_A1';
  assert.ok(contextualAdds(w, hkx).some(o => o.kind === 'fireArrow'));
  w = addConnected(w, hkx, {kind: 'fireArrow', label: '활 발사'}, {x: 200, y: 300}).workspace;
  assert.deepEqual(w.actions[1].config.fireArrow, {at: null, onRelease: true});
  xml = compileWorkspace(w);
  assert.match(xml, /<FireArrow\/>/);
  fs.writeFileSync(folder + '/fire-release.xml', xml);
  runtime(folder + '/fire-release.xml');
  // Neither own shot (10-22): the item stays for the event shots and no <FireArrow> is written; the registry's event
  // shot still is. An event moment on the action's own shot is refused.
  w.actions[1].config.fireArrow.onRelease = false;
  const eventOnly = compileWorkspace(w);
  assert.doesNotMatch(eventOnly.slice(eventOnly.indexOf('id="BowDodge_L1"')).split('</Action>')[0], /<FireArrow/);
  assert.match(eventOnly, /<Do op="fireArrow"\/>/);
  fs.writeFileSync(folder + '/fire-event-only.xml', eventOnly);
  runtime(folder + '/fire-event-only.xml');
  assert.deepEqual(
    parseWorkspace(JSON.stringify(captureGraph(w))).actions[1].config.fireArrow,
    w.actions[1].config.fireArrow,
    'the item is kept in the project'
  );
  w.actions[1].config.fireArrow.at = {
    basis: 'event',
    seconds: 0,
    event: 'Fire',
    fallback: false,
    fallbackBasis: 'seconds',
  };
  assert.throws(() => compileWorkspace(w));
  for (const bad of [
    '<FireArrow onRelease="false"/>',
    '<FireArrow at="-1"/>',
    '<FireArrow at="end"/>',
    '<FireArrow at="0" fallback="1"/>',
    '<FireArrow at="event:Fire"/>',
    '<FireArrow at="0"/><FireArrow at="1"/>',
  ]) {
    assert.throws(() =>
      importWorkspaceXml(
        '<AnimationSet version="6" id="Test"><Action id="A" clip="a.hkx">' + bad + '</Action></AnimationSet>'
      )
    );
  }
  assert.throws(
    () =>
      importWorkspaceXml(
        '<AnimationSet version="6" id="Test"><Pair id="A" clip="a.hkx"><FireArrow at="0"/></Pair></AnimationSet>'
      ),
    /페어/
  );
  const p = createProject('single');
  p.fireArrow = {at: null, onRelease: true};
  assert.deepEqual(parseProject(JSON.stringify(p)).fireArrow, {at: null, onRelease: true});
  assert.throws(() => parseProject(JSON.stringify({...p, fireArrow: {at: 0, onRelease: true}})));
});

test(
  'a direct shot (runtime 0.12.268) round-trips on the action and as a node own event shot, checked by the runtime',
  needsRuntime,
  async () => {
    const {setNodeValues, nodeValues} = await import('../src/eventRegistry.ts');
    let w = importWorkspaceXml(raw);
    const a = w.actions[1];
    a.config.fireArrow = {
      at: {basis: 'seconds', seconds: 0.6, event: '', fallback: false, fallbackBasis: 'seconds'},
      onRelease: false,
      mode: 'direct',
      damage: 80,
    };
    const row = w => w.eventRegistry.find(r => r.name === 'DodgeShotFire');
    // The event shot's way is the node's (runtime 0.12.281): another node sending the event keeps the drawn shot.
    w = setNodeValues(w, w.actions[2].uid, row(w), row(w).functions[0], {mode: 'direct', damage: '150'});
    w = parseWorkspace(JSON.stringify(captureGraph(w)));
    const xml = compileWorkspace(w);
    assert.match(xml, /<FireArrow at="0.6" mode="direct" damage="80"\/>/);
    assert.match(xml, /<Event name="DodgeShotFire">\s*<Do op="fireArrow"\/>/);
    assert.match(
      xml,
      /<EventValues>\s*<Event name="DodgeShotFire">\s*<Do op="fireArrow" mode="direct" damage="150"\/>/
    );
    fs.writeFileSync(folder + '/fire-direct.xml', xml);
    runtime(folder + '/fire-direct.xml');
    const back = importWorkspaceXml(xml);
    assert.deepEqual(back.actions[1].config.fireArrow, a.config.fireArrow);
    assert.deepEqual(back.eventRegistry.find(r => r.name === 'DodgeShotFire').functions[0].values, {op: 'fireArrow'});
    assert.deepEqual(nodeValues(back.actions[2], row(back), row(back).functions[0]), {
      op: 'fireArrow',
      mode: 'direct',
      damage: '150',
    });
    assert.equal(nodeValues(back.actions[3], row(back), row(back).functions[0]), undefined);
    // Numbers in the registry are refused: they are the sending nodes' (<EventValues>, runtime 0.12.281).
    assert.throws(
      () => importWorkspaceXml(raw.replace('<Do op="fireArrow"/>', '<Do op="fireArrow" mode="direct" damage="90"/>')),
      /EventValues/
    );
    // 100% is the default and left out; the drawn shot writes no mode.
    back.actions[1].config.fireArrow.damage = undefined;
    delete back.actions[1].config.fireArrow.damage;
    assert.match(compileWorkspace(back), /<FireArrow at="0.6" mode="direct"\/>/);
    // A direct shot needs a time and has no release shot; damage is only for it.
    back.actions[1].config.fireArrow.at = null;
    assert.throws(() => compileWorkspace(back), /바로 발사/);
    for (const bad of [
      '<FireArrow mode="direct"/>',
      '<FireArrow at="0.6" mode="direct" onRelease="true"/>',
      '<FireArrow at="0.6" damage="80"/>',
      '<FireArrow at="0.6" mode="direct" damage="0"/>',
      '<FireArrow at="0.6" mode="full"/>',
    ])
      assert.throws(() => importWorkspaceXml(raw.replace('<FireArrow/>', bad)), bad);
    const p = createProject('single');
    p.fireArrow = {at: null, onRelease: true, damage: 80};
    assert.throws(() => parseProject(JSON.stringify(p)), 'damage without a direct shot');
  }
);

test(
  'the Fire bow item has one automatic shot; an event shot runs with each node own way (0.12.281)',
  needsRuntime,
  async () => {
    const {sentEvents, fireTiming, fireArrowSummary, fireToEvent, setShotWay, dropClipTime} =
      await import('../src/graph/fireArrowMoments.ts');
    const {hkxMoments} = await import('../src/graph/hkxMoments.ts');
    const {clipKey} = await import('../src/graph/annotations.ts');
    const {setFunctions} = await import('../src/eventRegistry.ts');
    let w = importWorkspaceXml(raw);
    const uid = w.actions[1].uid,
      other = w.actions[2].uid;
    const one = [
      {time: 0.15, text: 'SoundPlay.WPNBowPullLPM'},
      {time: 0.62, text: 'DodgeShotFire'},
    ];
    // The clip's annotations as the HKX gives them (desktop only).
    const annotations = new Map(
      w.actions.filter(x => x.config.steps[0]?.clip).map(x => [clipKey(x.config.steps[0].clip), one])
    );
    const a = (id = uid) => w.actions.find(x => x.uid === id);
    const sent = (id = uid) => sentEvents(w, a(id), annotations);
    assert.deepEqual(
      sent().map(s => [s.name, s.time, s.senders]),
      [
        ['SoundPlay.WPNBowPullLPM', 0.15, 6],
        ['DodgeShotFire', 0.62, 6],
      ]
    );
    // DDS: the button first, else DodgeShotFire. Its registry shot is the item's, not a second registry row.
    assert.equal(fireTiming(w, a(), sent()).kind, 'event');
    assert.equal(fireArrowSummary(w, a(), sent()), 'DodgeShotFire 주석 · 당긴 만큼 · 버튼 먼저');
    assert.equal(
      hkxMoments(w, a(), one).registry.some(r => r.fn.values.op === 'fireArrow'),
      false,
      'no registry row for the item own shot'
    );
    // This node shoots direct at 80%; another node sending the same event keeps the drawn shot.
    w = setShotWay(w, uid, fireTiming(w, a(), sent()).shot, {mode: 'direct', damage: '80'});
    assert.equal(fireArrowSummary(w, a(), sent()), 'DodgeShotFire 주석 · 바로 발사 80%');
    assert.equal(fireArrowSummary(w, a(other), sent(other)), 'DodgeShotFire 주석 · 당긴 만큼 · 버튼 먼저');
    let xml = compileWorkspace(w);
    assert.match(xml, /<Event name="DodgeShotFire">\s*<Do op="fireArrow"\/>/, 'the registry holds no way');
    assert.equal(xml.match(/<Do op="fireArrow" mode="direct" damage="80"\/>/g)?.length, 1, 'one node own way');
    // A clip time beside the event shot shoots twice; the clip time can go, the event is the registry's.
    w.actions = w.actions.map(x =>
      x.uid === uid
        ? {
            ...x,
            config: {
              ...x.config,
              fireArrow: {
                ...x.config.fireArrow,
                at: {basis: 'seconds', seconds: 0.5, event: '', fallback: false, fallbackBasis: 'seconds'},
              },
            },
          }
        : x
    );
    assert.equal(fireTiming(w, a(), sent()).kind, 'conflict');
    assert.equal(fireArrowSummary(w, a(), sent()), '자동 발사 시점 2개');
    w = dropClipTime(w, uid);
    assert.equal(fireTiming(w, a(), sent()).kind, 'event');
    // A direct clip shot moves to an event with its damage, which stays this node's.
    w = setFunctions(w, 'DodgeShotFire', []);
    w.actions = w.actions.map(x =>
      x.uid === uid
        ? {
            ...x,
            config: {
              ...x.config,
              fireArrow: {
                at: {basis: 'seconds', seconds: 0.5, event: '', fallback: false, fallbackBasis: 'seconds'},
                mode: 'direct',
                damage: 70,
                onRelease: false,
              },
            },
          }
        : x
    );
    w = fireToEvent(w, uid, 'DodgeShotFire');
    const t = fireTiming(w, a(), sent());
    assert.deepEqual([t.kind, t.shot.fn.values], ['event', {op: 'fireArrow'}]);
    assert.equal(a().config.fireArrow.at, null);
    assert.equal(fireArrowSummary(w, a(), sent()), 'DodgeShotFire 주석 · 바로 발사 70%');
    xml = compileWorkspace(w);
    assert.match(xml, /<EventValues>\s*<Event name="DodgeShotFire">\s*<Do op="fireArrow" mode="direct" damage="70"\/>/);
    fs.writeFileSync(folder + '/fire-moments.xml', xml);
    runtime(folder + '/fire-moments.xml');
  }
);
