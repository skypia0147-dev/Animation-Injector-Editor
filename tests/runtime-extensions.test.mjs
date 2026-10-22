import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, emptyWorkspace, wrap, selectsOnly} from '../src/workspace.ts';
import {createProject, parseProject} from '../src/model.ts';
import {parseXml, documentXml} from '../src/xml.ts';
import {equippedTypes, attackStates, eventListError} from '../src/runtimeExtensions.ts';
import {captureGraph} from '../src/graph/document.ts';
import {flatGraph, addFlat, connectFlat, deleteFlat} from '../src/graph/flat.ts';
import {disconnectEdge} from '../src/graph/disconnect.ts';
import {addConnected, contextualAdds} from '../src/graph/contextAdd.ts';
import {setBranchTarget} from '../src/graph/conditionCommands.ts';
import {checker, needsChecker, runtimeSource, needsRuntimeSource} from './local.mjs';

// Every test here reads the runtime's Dynamic Dodge Shot port; most also run the runtime checker.
const needsRuntime = {skip: needsRuntimeSource.skip || needsChecker.skip};

const folder = 'tests/generated/runtime-extensions';
fs.mkdirSync(folder, {recursive: true});
// The Dynamic Dodge Shot port (runtime test data, format 4).
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

// Compare the predicate/branch tree independently of Editor model and generated node IDs.
function flowTree(flow) {
  const byId = new Map(flow.children.map(n => [n.attrs.id, n]));
  const visit = (id, seen = []) => {
    if (!id) return {kind: 'Stop'};
    assert.ok(!seen.includes(id), 'cycle');
    const n = byId.get(id);
    assert.ok(n, id);
    const {id: _, pass, fail, ...attrs} = n.attrs;
    if (n.name === 'Stop') return {kind: 'Stop'};
    if (n.name === 'Play') return {kind: 'Play', ...attrs};
    if (n.name === 'Test') attrs.subject ??= 'self';
    return {
      kind: n.name,
      attrs,
      operands: n.children.map(c => visit(c.attrs.node, [...seen, id])),
      pass: visit(pass, [...seen, id]),
      fail: visit(fail, [...seen, id]),
    };
  };
  return visit(flow.attrs.entry);
}

test('DDS import → schema8 save/reload → XML preserves branch meaning and native action settings', needsRuntime, () => {
  const w = importWorkspaceXml(raw),
    saved = parseWorkspace(JSON.stringify(captureGraph(w))),
    out = compileWorkspace(saved);
  const original = parseXml(raw),
    exported = parseXml(out);
  for (const action of original.children.filter(n => n.name !== 'Inputs' && n.name !== 'EventRegistry')) {
    const actual = exported.children.find(n => n.attrs.id === action.attrs.id);
    const sourceFlow = action.children.find(n => n.name === 'Flow'),
      actualFlow = actual.children.find(n => n.name === 'Flow');
    if (sourceFlow) assert.deepEqual(flowTree(actualFlow), flowTree(sourceFlow));
  }
  // A selecting action (BowDodge picks a direction and never plays its own clip) is written with its
  // start, conditions, suppression and flow only: the source without the rest is what the export means.
  const selecting = w.actions.filter(selectsOnly).map(a => a.config.actionId);
  assert.deepEqual(selecting, ['BowDodge']);
  for (const id of selecting) {
    const kept = ['Start', 'Require', 'Suppress', 'Flow'],
      source = original.children.find(n => n.attrs.id === id),
      actual = exported.children.find(n => n.attrs.id === id);
    assert.deepEqual(
      actual.children.map(n => n.name),
      source.children.map(n => n.name).filter(n => kept.includes(n))
    );
    source.children = source.children.filter(n => kept.includes(n.name));
    // Nor its clip (runtime 0.12.244).
    assert.equal(actual.attrs.clip, undefined);
    delete source.attrs.clip;
  }
  fs.writeFileSync(folder + '/source-selecting.xml', documentXml(original));
  // The source ends two branches at <Stop>, which the Editor writes as a missing pass/fail; the
  // runtime checker folds Stop nodes, so the source compares with the export directly.
  fs.writeFileSync(folder + '/roundtrip.xml', out);
  runtime('--compare', folder + '/source-selecting.xml', folder + '/roundtrip.xml');
  // A selecting action's clip is not written (runtime 0.12.244): it reads back empty.
  assert.deepEqual(
    importWorkspaceXml(out).actions.map(a => a.config.steps.map(s => s.clip)),
    w.actions.map(a => a.config.steps.map(s => (selectsOnly(a) ? '' : s.clip)))
  );
});

test('removed motion forms are refused by the editor import and the runtime alike (0.12.231)', needsRuntime, () => {
  const action = body =>
    '<AnimationSet version="4" id="Test"><Action id="A" clip="a.hkx">' + body + '</Action></AnimationSet>';
  for (const [name, xml] of [
    ['motion-none', action('<Motion type="none"/>')],
    ['motion-annotation', action('<Motion type="annotation"/>')],
    ['motion-curve', action('<Motion type="curve" distance="300" duration="0.5"/>')],
    ['motion-keys', action('<Motion type="keys"><Key at="0" x="0" y="0"/><Key at="1" x="0" y="5"/></Motion>')],
    [
      'clips',
      '<AnimationSet version="4" id="Test"><Action id="A"><Clips><Clip file="a.hkx" direction="back" tag="B"/></Clips></Action></AnimationSet>',
    ],
    ['start-direction', action('<Start event="E" direction="movement"/>')],
    ['start-default', action('<Start event="E" defaultDirection="back"/>')],
    ['start-strict', action('<Start event="E" strict="true"/>')],
  ]) {
    assert.throws(() => importWorkspaceXml(xml), /0\.12\.231/, name);
    fs.writeFileSync(folder + '/removed-' + name + '.xml', xml);
    runtime('--reject', folder + '/removed-' + name + '.xml');
  }
  // Without them the same declaration loads in both.
  const kept = action('<Start event="E"/>');
  assert.doesNotThrow(() => importWorkspaceXml(kept));
  fs.writeFileSync(folder + '/kept-action.xml', kept);
  runtime(folder + '/kept-action.xml');
  // A combo is refused by both, naming its replacement (format 4).
  const combo =
    '<AnimationSet version="4" id="Test"><Combo id="A" entry="S"><Step id="S" clip="a.hkx"/></Combo></AnimationSet>';
  assert.throws(() => importWorkspaceXml(combo), /Connect/);
  fs.writeFileSync(folder + '/removed-combo.xml', combo);
  runtime('--reject', folder + '/removed-combo.xml');
});

test(
  'a project saved with declared motion opens without it; a directional action keeps its entry clip',
  needsRuntime,
  () => {
    const single = createProject('single');
    Object.assign(single, {
      motion: 'keys',
      motionKeys: [
        {at: 0, x: 0, y: 0},
        {at: 1, x: 0, y: 5},
      ],
      distance: 800,
      duration: 0.55,
      ease: 2,
    });
    Object.assign(single.start, {movement: false, direction: 'back', strict: true});
    Object.assign(single.steps[0], {direction: 'none', motion: {type: 'curve', distance: 10}});
    const directional = structuredClone(single);
    directional.kind = 'directional';
    directional.actionId = 'Dodge';
    directional.steps = ['F', 'B', 'L', 'R'].map((id, i) => ({
      ...structuredClone(single.steps[0]),
      id,
      label: id,
      clip: 'Animations/Dodge' + id + '.hkx',
      direction: ['forward', 'back', 'left', 'right'][i],
    }));
    directional.entry = 'B';
    const old = emptyWorkspace();
    old.actions = [wrap(single, 'a1'), wrap(directional, 'a2')];
    old.actions[0].variants = {directional: {config: structuredClone(directional), pair: null}};
    const window = {
      open: {basis: 'seconds', seconds: 0.2, event: '', fallback: false, fallbackBasis: 'seconds'},
      close: {basis: 'end', seconds: 0, event: '', fallback: false, fallbackBasis: 'seconds'},
      buffered: true,
    };
    old.actions[1].clipWindows = {F: structuredClone(window), B: structuredClone(window)};
    const opened = parseWorkspace(JSON.stringify(old));
    for (const a of opened.actions) {
      for (const k of ['motion', 'motionKeys', 'distance', 'duration', 'ease']) assert.ok(!(k in a.config), k);
      for (const k of ['movement', 'direction', 'strict']) assert.ok(!(k in a.config.start), k);
      for (const step of a.config.steps) assert.ok(!('motion' in step) && !('direction' in step));
    }
    const dodge = opened.actions[1];
    assert.equal(dodge.config.kind, 'single');
    assert.deepEqual(
      dodge.config.steps.map(s => [s.id, s.clip]),
      [['B', 'Animations/DodgeB.hkx']]
    );
    assert.equal(dodge.config.entry, 'B');
    assert.deepEqual(Object.keys(dodge.clipWindows), ['B']);
    assert.equal(opened.actions[0].variants.directional, undefined);
    const xml = compileWorkspace(opened);
    assert.doesNotMatch(xml, /<Motion|<Clips|direction=|strict=/);
    fs.writeFileSync(folder + '/migrated.xml', xml);
    runtime(folder + '/migrated.xml');
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
          t = w.actions[0].flow.tests.find(t => t.id === 'bow');
        Object.assign(t, {kind, ...(value ? {[field]: value} : {}), hand: 'right'});
        const out = compileWorkspace(w);
        fs.writeFileSync(folder + '/predicate.xml', out);
        runtime(folder + '/predicate.xml');
        const reread = importWorkspaceXml(out).actions[0].flow.tests.find(t => t.id === 'bow');
        assert.equal(reread.kind, kind);
        if (value) assert.equal(reread[field], value);
      }
    for (const replacement of [
      'kind="equippedType" hand="feet" type="bow"',
      'kind="equippedType" type="bow"',
      'kind="attackState" state="typo"',
      'kind="sneaking" hand="left" type="bow"',
      'kind="sneaking" state="none"',
    ])
      assert.throws(() =>
        importWorkspaceXml(raw.replace('kind="equippedType" subject="self" hand="left" type="bow"', replacement))
      );
    const w = importWorkspaceXml(raw);
    assert.doesNotThrow(() => setBranchTarget(w, 'a1', 'sneak', 'pass', {action: 'a2'}));
  }
);

test(
  'new feature nodes add, attach, edit, disconnect, reconnect and delete without affecting playback',
  needsRuntime,
  () => {
    for (const kind of ['suppress']) {
      let w = importWorkspaceXml(raw);
      delete w.actions[1].config[kind];
      const hkx = 'anim:a2:|clip_A1';
      assert.ok(contextualAdds(w, hkx).some(o => o.kind === kind));
      // Registering annotation names moved to the event registry (format 3).
      assert.ok(!contextualAdds(w, hkx).some(o => o.kind === 'extraEvents'));
      const added = addConnected(w, hkx, {kind, label: kind}, {x: 200, y: 200});
      w = added.workspace;
      w.actions[1].config.suppress = {events: ['blockStart'], when: 'both'};
      const node = flatGraph(w).nodes.find(n => n.action === 'a2' && n.kind === kind);
      assert.ok(node);
      w = parseWorkspace(JSON.stringify(captureGraph(w)));
      const xml = compileWorkspace(w);
      assert.match(xml, /events="blockStart" when="both"/);
      const edge = flatGraph(w).edges.find(e => e.target === node.id);
      assert.ok(edge);
      const cut = disconnectEdge(w, edge);
      assert.ok(cut.actions[1].config[kind]);
      const exported = importWorkspaceXml(compileWorkspace(cut));
      assert.equal(exported.actions[1].config[kind], undefined);
      assert.ok(compileWorkspace(connectFlat(cut, edge.source, edge.target)).includes('<Suppress'));
      const deleted = deleteFlat(w, node.id);
      assert.equal(deleted.actions[1].config[kind], undefined);
      assert.equal(deleted.actions[1].config.steps.length, 1);
    }
  }
);

test(
  'suppression survives input edits; events reject empty, control, byte overflow; corrupt saves rejected',
  needsRuntime,
  () => {
    const w = importWorkspaceXml(raw);
    for (const when of ['startable', 'active', 'both']) {
      w.actions[0].config.suppress.when = when;
      assert.equal(importWorkspaceXml(compileWorkspace(w)).actions[0].config.suppress.when, when);
    }
    for (const events of [[], [''], ['a', ''], ['한'.repeat(22)], ['a\tb']]) assert.ok(eventListError(events));
    assert.equal(eventListError(['한'.repeat(21)]), undefined);
    const p = structuredClone(w.actions[0].config);
    p.suppress = {events: ['blockStart'], when: 'always'};
    assert.throws(() => parseProject(JSON.stringify(p)));
    const corrupt = structuredClone(w);
    corrupt.actions[0].config.suppress.extra = true;
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
  const edge = flatGraph(w).edges.find(e => e.target === node.id);
  const cut = disconnectEdge(w, edge);
  assert.equal(importWorkspaceXml(compileWorkspace(cut)).actions[1].config.fireArrow, undefined);
  w = connectFlat(cut, edge.source, edge.target);
  assert.equal(importWorkspaceXml(compileWorkspace(w)).actions[1].config.fireArrow.at.seconds, 0.67);
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
  assert.doesNotMatch(eventOnly.slice(eventOnly.indexOf('id="BowDodge_B1"')).split('</Action>')[0], /<FireArrow/);
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
        '<AnimationSet version="4" id="Test"><Action id="A" clip="a.hkx">' + bad + '</Action></AnimationSet>'
      )
    );
  }
  assert.throws(
    () =>
      importWorkspaceXml(
        '<AnimationSet version="4" id="Test"><Pair id="A" clip="a.hkx"><FireArrow at="0"/></Pair></AnimationSet>'
      ),
    /페어/
  );
  const p = createProject('single');
  p.fireArrow = {at: null, onRelease: true};
  assert.deepEqual(parseProject(JSON.stringify(p)).fireArrow, {at: null, onRelease: true});
  assert.throws(() => parseProject(JSON.stringify({...p, fireArrow: {at: 0, onRelease: true}})));
  // An older project's event shot moves to the registry when it is opened.
  const old = emptyWorkspace();
  old.actions = [wrap(createProject('single'), 'a1')];
  old.actions[0].config.fireArrow = {
    at: {basis: 'event', seconds: 0, event: 'OldFire', fallback: false, fallbackBasis: 'seconds'},
  };
  const opened = parseWorkspace(JSON.stringify(old));
  assert.deepEqual(opened.actions[0].config.fireArrow, {at: null, onRelease: true});
  assert.deepEqual(opened.eventRegistry, [
    {id: 'event1', name: 'OldFire', functions: [{id: 'fn1', values: {op: 'fireArrow'}}]},
  ]);
});

test(
  'a direct shot (runtime 0.12.268) round-trips on the action and on the registry, checked by the runtime',
  needsRuntime,
  () => {
    let w = importWorkspaceXml(raw);
    const a = w.actions[1];
    a.config.fireArrow = {
      at: {basis: 'seconds', seconds: 0.6, event: '', fallback: false, fallbackBasis: 'seconds'},
      onRelease: false,
      mode: 'direct',
      damage: 80,
    };
    const shot = w.eventRegistry.find(r => r.name === 'DodgeShotFire');
    shot.functions[0].values = {op: 'fireArrow', mode: 'direct', damage: '150'};
    w = parseWorkspace(JSON.stringify(captureGraph(w)));
    const xml = compileWorkspace(w);
    assert.match(xml, /<FireArrow at="0.6" mode="direct" damage="80"\/>/);
    assert.match(xml, /<Do op="fireArrow" mode="direct" damage="150"\/>/);
    fs.writeFileSync(folder + '/fire-direct.xml', xml);
    runtime(folder + '/fire-direct.xml');
    const back = importWorkspaceXml(xml);
    assert.deepEqual(back.actions[1].config.fireArrow, a.config.fireArrow);
    assert.deepEqual(back.eventRegistry.find(r => r.name === 'DodgeShotFire').functions[0].values, {
      op: 'fireArrow',
      mode: 'direct',
      damage: '150',
    });
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
  'the Fire bow item lists every moment the HKX shoots, its event shots included (10-22)',
  needsRuntime,
  async () => {
    const {sentEvents, eventShots, fireArrowSummary, setEventShot, addEventShot} =
      await import('../src/graph/fireArrowMoments.ts');
    const {clipKey} = await import('../src/graph/annotations.ts');
    let w = importWorkspaceXml(raw);
    const a = w.actions[1];
    // The clip's annotations as the HKX gives them (desktop only).
    const annotations = new Map(
      w.actions
        .filter(x => x.config.steps[0]?.clip)
        .map(x => [
          clipKey(x.config.steps[0].clip),
          [
            {time: 0.15, text: 'SoundPlay.WPNBowPullLPM'},
            {time: 0.62, text: 'DodgeShotFire'},
          ],
        ])
    );
    let sent = sentEvents(w, a, annotations);
    assert.deepEqual(
      sent.map(s => [s.name, s.time]),
      [
        ['SoundPlay.WPNBowPullLPM', 0.15],
        ['DodgeShotFire', 0.62],
      ]
    );
    const shots = eventShots(w, sent);
    assert.deepEqual(
      shots.map(s => [s.name, s.time, s.senders]),
      [['DodgeShotFire', 0.62, 6]]
    );
    assert.equal(fireArrowSummary(w, a, sent), 'DodgeShotFire 주석 · 버튼 떼기');
    // A direct event shot, then removed; an annotation event added as a shot.
    w = setEventShot(w, shots[0], {...shots[0].fn.values, mode: 'direct', damage: '80'});
    assert.equal(fireArrowSummary(w, w.actions[1], sent), 'DodgeShotFire 주석 · 바로 80% · 버튼 떼기');
    assert.match(compileWorkspace(w), /<Do op="fireArrow" mode="direct" damage="80"\/>/);
    w = setEventShot(w, eventShots(w, sent)[0]);
    assert.equal(eventShots(w, sent).length, 0);
    w = addEventShot(w, 'SoundPlay.WPNBowPullLPM');
    assert.deepEqual(
      eventShots(w, sent).map(s => [s.name, s.fn.values]),
      [['SoundPlay.WPNBowPullLPM', {op: 'fireArrow'}]]
    );
    fs.writeFileSync(folder + '/fire-moments.xml', compileWorkspace(w));
    runtime(folder + '/fire-moments.xml');
  }
);
