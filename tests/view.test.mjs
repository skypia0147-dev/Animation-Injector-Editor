import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {captureGraph, lowerGraph} from '../src/graph/document.ts';
import {assets, selectAsset} from '../src/package.ts';
import {assetLibrary} from '../src/assets.ts';
import {portable} from '../src/authoring.ts';
import {
  actionView,
  assignFirstPerson,
  firstPersonClip,
  placeStepFile,
  setActionView,
  setFirstPersonStart,
  setProjectView,
  stepSource,
  viewIssues,
} from '../src/view.ts';
import {checker, needsChecker} from './local.mjs';

// Camera views (runtime 0.12.225): the editor writes and reads what the runtime's parser takes.
const folder = 'tests/generated/view';
fs.mkdirSync(folder, {recursive: true});
const run = (...args) => spawnSync(checker, args, {encoding: 'utf8'});
/** The runtime's view per action: "view<view><firstPerson>" (0 third/block, 1 first/switch, 2 both). */
function runtimeViews(file) {
  const list = folder + '/list.txt';
  fs.writeFileSync(list, path.resolve(file) + '\n');
  const out = run('--dump', list).stdout;
  const views = {};
  let id = '';
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('-- ')) views[(id = line.slice(3))] = 'view00';
    // Snapshot fields are separated by U+001F: "view\x1f1\x1f0\x1f".
    else if (line.startsWith('view\x1f')) views[id] = line.replaceAll('\x1f', '');
  }
  return views;
}
const xml = (body, root = '') => `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="4" id="ViewTest"${root}>
<Inputs><Input id="use" key="G"/><Input id="drop" key="H"/></Inputs>
${body}
</AnimationSet>`;
const views = xml(
  `<Action id="Look" clip="Animations\\ViewTest\\look.hkx"><Start input="use"/></Action>
<Action id="Roll" clip="Animations\\ViewTest\\roll.hkx" view="third" firstPerson="switch"><Start input="use"/></Action>
<Action id="Wave" clip="Animations\\ViewTest\\wave.hkx" view="both"/>
<Pair id="Lift" clip="Animations\\ViewTest\\lift.hkx" firstPerson="switch"><Start input="use"/><Target range="200" angle="90"/>
<Carry bone="NPC R Hand [RHnd]" targetRoot="NPC Root [Root]" putdown="Lower" input="drop"/></Pair>
<Action id="Lower" clip="Animations\\ViewTest\\lower.hkx"><CarryRelease at="0.5"/></Action>`,
  ' view="first"'
);
const byId = (w, id) => w.actions.find(a => a.config.actionId === id);

test('views round-trip: the file default, overrides, and third person for pairs and putdowns', needsChecker, () => {
  const source = folder + '/views.xml';
  fs.writeFileSync(source, views);
  assert.equal(run(source).status, 0);
  const w = importWorkspaceXml(views);
  assert.equal(w.view, 'first');
  // The file's view is no override; an explicit one that differs is; a putdown inherits nothing.
  assert.equal(byId(w, 'Look').view, undefined);
  assert.equal(byId(w, 'Roll').view, 'third');
  assert.equal(byId(w, 'Roll').firstPerson, 'switch');
  assert.equal(byId(w, 'Wave').view, 'both');
  assert.equal(byId(w, 'Lift').firstPerson, 'switch');
  assert.deepEqual(
    ['Look', 'Roll', 'Wave', 'Lift', 'Lower'].map(id => actionView(w, byId(w, id))),
    ['first', 'third', 'both', 'third', 'third']
  );
  // The saved project (graph document) keeps them.
  const saved = parseWorkspace(JSON.stringify(captureGraph(w)));
  assert.equal(saved.view, 'first');
  assert.deepEqual(
    saved.actions.map(a => [a.view, a.firstPerson]),
    w.actions.map(a => [a.view, a.firstPerson])
  );
  const out = compileWorkspace(saved);
  assert.match(out, /<AnimationSet version="4" id="ViewTest" view="first">/);
  assert.match(out, /<Action id="Roll"[^>]* view="third" firstPerson="switch"/);
  assert.doesNotMatch(out, /<Action id="Look"[^>]* view=/);
  assert.doesNotMatch(out, /<(Pair id="Lift"|Action id="Lower")[^>]* view=/);
  const back = folder + '/views-back.xml';
  fs.writeFileSync(back, out);
  assert.equal(run(back).status, 0);
  const compared = run('--compare', source, back);
  assert.equal(compared.status, 0, compared.stdout + compared.stderr);
  assert.deepEqual(runtimeViews(back), {
    Look: 'view10',
    Roll: 'view01',
    Wave: 'view20',
    Lift: 'view01',
    Lower: 'view00',
  });
});

test('the importer rejects what the runtime rejects', () => {
  const reject = (body, root, pattern) => assert.throws(() => importWorkspaceXml(xml(body, root)), pattern);
  reject(`<Pair id="P" clip="a.hkx" view="first"><Target/></Pair>`, '', /3인칭/);
  reject(`<Action id="A" clip="a.hkx" view="first" firstPerson="switch"/>`, '', /firstPerson/);
  reject(`<Action id="A" clip="a.hkx" firstPerson="switch"/>`, ' view="both"', /firstPerson/);
  reject(`<Action id="A" clip="a.hkx" view="side"/>`, '', /지원하지 않는 값/);
  reject(`<Action id="A" clip="a.hkx"/>`, ' view="side"', /지원하지 않는 값/);
  assert.throws(
    () => importWorkspaceXml(xml(`<Action id="A" clip="a.hkx" view="first"/>`).replace('version="4"', 'version="3"')),
    /version="4"/
  );
  assert.throws(() => parseWorkspace(JSON.stringify({...importWorkspaceXml(views), view: 'side'})), /인칭/);
});

test('project default and overrides: an override equal to the default is none', () => {
  let w = importWorkspaceXml(views);
  w = setProjectView(w, 'third');
  assert.equal(w.view, undefined);
  assert.equal(byId(w, 'Roll').view, undefined, 'the override now equals the default');
  assert.equal(actionView(w, byId(w, 'Look')), 'third');
  w = setActionView(w, byId(w, 'Look').uid, 'first');
  assert.equal(byId(w, 'Look').view, 'first');
  assert.throws(() => setActionView(w, byId(w, 'Lower').uid, 'first'), /3인칭/);
  // firstPerson is written only for a third-person action, and kept for a switch back.
  w = setFirstPersonStart(w, byId(w, 'Look').uid, 'switch');
  assert.doesNotMatch(compileWorkspace(w), /<Action id="Look"[^>]*firstPerson/);
  w = setActionView(w, byId(w, 'Look').uid, 'third');
  assert.match(compileWorkspace(w), /<Action id="Look"[^>]* firstPerson="switch"/);
  w = setFirstPersonStart(w, byId(w, 'Look').uid, 'block');
  assert.equal(byId(w, 'Look').firstPerson, undefined);
});

test('files: a first-person copy is _1stPerson\\<clip>, sourced from the library, packaged by view', () => {
  let w = importWorkspaceXml(views);
  const look = byId(w, 'Look'),
    wave = byId(w, 'Wave'),
    roll = byId(w, 'Roll');
  const clips = () => Object.fromEntries(assets(w).map(a => [a.clip, a]));
  let packaged = clips();
  assert.ok(packaged['_1stPerson\\Animations\\ViewTest\\look.hkx'], 'first person only');
  assert.ok(!packaged['Animations\\ViewTest\\look.hkx']);
  assert.ok(packaged['Animations\\ViewTest\\wave.hkx'] && packaged['_1stPerson\\Animations\\ViewTest\\wave.hkx']);
  assert.ok(packaged['Animations\\ViewTest\\roll.hkx'] && !packaged['_1stPerson\\Animations\\ViewTest\\roll.hkx']);
  assert.deepEqual(packaged['_1stPerson\\Animations\\ViewTest\\look.hkx'].actorRoots, ['meshes/actors/character']);
  // A first-person file comes from Actors\Character\_1stPerson; `both` keeps the clip's path.
  const lookSource = 'D:\\Mod\\meshes\\actors\\character\\_1stperson\\Animations\\ViewTest\\look2.hkx';
  assert.throws(
    () => assignFirstPerson(w, look.uid, 'A1', 'Animations\\ViewTest\\look2.hkx', 'D:\\x\\look2.hkx'),
    /_1stPerson/
  );
  assert.throws(
    () => assignFirstPerson(w, wave.uid, 'A1', '_1stperson\\Animations\\ViewTest\\other.hkx', 'D:\\o.hkx'),
    /같은 상대 경로/
  );
  w = assignFirstPerson(w, look.uid, 'A1', '_1stperson\\Animations\\ViewTest\\look2.hkx', lookSource);
  assert.equal(byId(w, 'Look').config.steps[0].clip, 'Animations\\ViewTest\\look2.hkx', 'first person takes its clip');
  assert.deepEqual(stepSource(w, byId(w, 'Look'), byId(w, 'Look').config.steps[0]), {
    clip: '_1stPerson\\Animations\\ViewTest\\look2.hkx',
    path: lookSource,
  });
  packaged = clips();
  assert.deepEqual(packaged['_1stPerson\\Animations\\ViewTest\\look2.hkx'].paths, [lookSource]);
  assert.match(compileWorkspace(w), /<Action id="Look" clip="Animations\\ViewTest\\look2.hkx"/);
  // The library lists the copy with its users; a chosen package candidate becomes an entry.
  const entry = assetLibrary(w).find(e => e.clip === firstPersonClip('Animations\\ViewTest\\wave.hkx'));
  assert.deepEqual(entry.users, [wave.uid]);
  w = selectAsset(w, firstPersonClip('Animations\\ViewTest\\wave.hkx'), 'D:\\Mod\\wave1st.hkx');
  assert.deepEqual(clips()['_1stPerson\\Animations\\ViewTest\\wave.hkx'].paths, ['D:\\Mod\\wave1st.hkx']);
  // A shared project carries no local source.
  assert.ok(portable(w).assets.every(a => a.localPath === ''));
  assert.equal(roll.view, 'third');
});

test('a dropped or picked file: its folder decides the person and the view follows', () => {
  let w = setProjectView(importWorkspaceXml(views), 'third');
  const roll = byId(w, 'Roll').uid,
    lift = byId(w, 'Lift').uid,
    source = name => `D:\\Mod\\meshes\\actors\\character\\_1stperson\\Animations\\ViewTest\\${name}`;
  // The same animation in first person: the third-person action plays in both.
  w = placeStepFile(w, roll, 'A1', '_1stperson\\Animations\\ViewTest\\roll.hkx', source('roll.hkx'));
  assert.equal(actionView(w, byId(w, 'Roll')), 'both');
  assert.equal(byId(w, 'Roll').config.steps[0].clip, 'Animations\\ViewTest\\roll.hkx');
  // Another animation in first person: first person only, the clip follows the file.
  w = placeStepFile(w, roll, 'A1', '_1stperson\\Animations\\ViewTest\\dash.hkx', source('dash.hkx'));
  assert.equal(actionView(w, byId(w, 'Roll')), 'first');
  assert.equal(byId(w, 'Roll').config.steps[0].clip, 'Animations\\ViewTest\\dash.hkx');
  // A third-person file of the same path: both; of another: third person.
  w = placeStepFile(w, roll, 'A1', 'Animations\\ViewTest\\dash.hkx', 'D:\\Mod\\dash.hkx');
  assert.equal(actionView(w, byId(w, 'Roll')), 'both');
  w = setActionView(w, roll, 'first');
  w = placeStepFile(w, roll, 'A1', 'Animations\\ViewTest\\other.hkx', 'D:\\Mod\\other.hkx');
  assert.equal(actionView(w, byId(w, 'Roll')), 'third');
  assert.equal(byId(w, 'Roll').config.steps[0].localPath, 'D:\\Mod\\other.hkx');
  // Pairs (and a carry's putdown) take third-person files only.
  assert.throws(() => placeStepFile(w, lift, 'A1', '_1stperson\\Animations\\ViewTest\\lift.hkx', source('lift.hkx')));
  // A clip that starts in the _1stPerson folder is flagged wherever it is.
  const odd = structuredClone(w);
  byId(odd, 'Roll').config.steps[0].clip = '_1stPerson\\Animations\\x.hkx';
  assert.ok(viewIssues(odd).some(i => /_1stPerson 폴더에서 시작/.test(i.message)));
});

test('warnings: a view nothing can play', () => {
  let w = importWorkspaceXml(
    xml(
      `<Action id="Hit" clip="a.hkx"><Start event="HitStart" actor="npc"/><Connect to="Follow" event="Go"/></Action>
<Action id="Follow" clip="b.hkx" view="third"/>`,
      ' view="first"'
    )
  );
  const messages = viewIssues(w).map(i => i.message);
  assert.ok(messages.some(m => /NPC는 1인칭/.test(m)));
  assert.ok(messages.some(m => /Hit → Follow.*1인칭 → 3인칭/.test(m)));
  assert.ok(validateWorkspace(w).some(i => i.level === 'warning' && /NPC는 1인칭/.test(i.message)));
  w = setActionView(w, byId(w, 'Follow').uid, 'both');
  assert.ok(!viewIssues(w).some(i => /→/.test(i.message)), 'both plays wherever its source does');
  assert.deepEqual(
    lowerGraph(captureGraph(w)).actions.map(a => a.view),
    w.actions.map(a => a.view)
  );
});

test('preview: a first-person action shows its _1stPerson copy, `both` the chosen person', async () => {
  const {previewPerson} = await import('../src/view.ts');
  const w = importWorkspaceXml(views);
  const look = byId(w, 'Look'),
    wave = byId(w, 'Wave'),
    roll = byId(w, 'Roll');
  assert.equal(previewPerson(w, look), 'first');
  assert.equal(previewPerson(w, look, 'third'), 'first', 'a first-person action has no third-person file');
  assert.equal(previewPerson(w, roll, 'first'), 'third');
  assert.equal(previewPerson(w, wave), 'third');
  assert.equal(previewPerson(w, wave, 'first'), 'first');
  assert.equal(stepSource(w, wave, wave.config.steps[0], 'first').clip, firstPersonClip(wave.config.steps[0].clip));
  assert.equal(stepSource(w, wave, wave.config.steps[0]).clip, wave.config.steps[0].clip);
});

test('first-person camera: through the camera bone, turned by the look offsets', async () => {
  const {firstPersonView} = await import('../src/viewport/firstPersonCamera.ts');
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  // The vanilla camera bone at rest (1hm_idle): no rotation, 120.5 up. The scene is Y up, forward -Z.
  const rest = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 120.5, 0, 0, 0, 1];
  let v = firstPersonView(rest, {yaw: 0, pitch: 0});
  assert.ok(near(v.position, [0, 120.5, 0]) && near(v.forward, [0, 0, -1]) && near(v.up, [0, 1, 0]));
  v = firstPersonView(rest, {yaw: Math.PI / 2, pitch: 0});
  assert.ok(near(v.forward, [-1, 0, 0]), 'positive yaw turns left');
  v = firstPersonView(rest, {yaw: 0, pitch: Math.PI / 2});
  assert.ok(near(v.forward, [0, 1, 0]) && near(v.up, [0, 0, 1]), 'positive pitch looks up');
  // A bone turned 90° left (its +Y is game -X) looks along scene -X.
  v = firstPersonView([0, -1, 0, 5, 1, 0, 0, 0, 0, 0, 1, 100, 0, 0, 0, 1], {yaw: 0, pitch: 0});
  assert.ok(near(v.forward, [-1, 0, 0]) && near(v.position, [5, 100, 0]));
});
