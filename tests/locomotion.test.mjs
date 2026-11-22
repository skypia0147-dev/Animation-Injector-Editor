import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileWorkspace, emptyWorkspace, parseWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {
  LADDER_SETS,
  LOCOMOTION_NODE,
  isTreeFile,
  ladderSets,
  missingFeet,
  motionSpeed,
  offeredSets,
  removeLocomotion,
  setApplies,
  setExcept,
  setTreeUse,
  treeFiles,
} from '../src/locomotion.ts';
import {assets as packageAssets, request as packageRequest, selectAsset, xmlName, xmlSavePath} from '../src/package.ts';
import {assetLibrary, modXmlPath} from '../src/assets.ts';
import {connectXmlAssets} from '../src/importAssets.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {checker, needsChecker} from './local.mjs';

// The locomotion (runtime 1.0.9 <Locomotion>): read, written and checked as the runtime does.
const WALK = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="WalkRun">
  <Locomotion>
    <Tree weapon="2HW" use="own"/>
    <Except set="Sneak"/>
    <Except set="BlockSneak"/>
  </Locomotion>
</AnimationSet>
`;
const errors = w => validateWorkspace(w).filter(i => i.level === 'error');
const locomotionLines = text =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^<\/?(Locomotion|Tree|Except)\b/.test(l));
const check = (name, xml) => {
  mkdirSync('tests/generated/locomotion', {recursive: true});
  writeFileSync(`tests/generated/locomotion/${name}.xml`, xml);
  execFileSync(checker, [`tests/generated/locomotion/${name}.xml`]);
};

test('a locomotion-only file reads in, writes back unchanged and is what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(WALK);
  assert.deepEqual(w.locomotion, {trees: {'2HW': 'own'}, except: ['Sneak', 'BlockSneak']});
  assert.deepEqual(errors(w), []);
  const xml = compileWorkspace(w);
  assert.deepEqual(locomotionLines(xml), locomotionLines(WALK));
  check('WalkRun', xml);
  // The project file keeps it too.
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).locomotion, w.locomotion);
});

test('the installed walk/run file round-trips', {skip: !existsSync('../WalkRunSplit/Locomotion.xml')}, () => {
  const text = readFileSync('../WalkRunSplit/Locomotion.xml', 'utf8');
  const w = importWorkspaceXml(text);
  assert.deepEqual(errors(w), []);
  assert.deepEqual(importWorkspaceXml(compileWorkspace(w)).locomotion, w.locomotion);
});

test('an empty declaration is every set, and is written', needsChecker, () => {
  const w = importWorkspaceXml('<AnimationSet version="6" id="X"><Locomotion/></AnimationSet>');
  assert.deepEqual(w.locomotion, {});
  assert.deepEqual(errors(w), []);
  // Every vanilla set; an own tree's sets are not in the game without the tree.
  assert.deepEqual(ladderSets(w.locomotion), offeredSets(w.locomotion));
  assert.equal(offeredSets(w.locomotion).length, LADDER_SETS.length - 4);
  assert.ok(
    !setApplies(w.locomotion, '2HW') && !setApplies(w.locomotion, 'BlockH2H') && setApplies(w.locomotion, 'Bow')
  );
  const xml = compileWorkspace(w);
  assert.match(xml, /<Locomotion\s*\/>/);
  check('Empty', xml);
  // No declaration: nothing applies and nothing is written.
  assert.ok(!setApplies(undefined, 'Bow') && ladderSets(undefined).length === 0);
});

test('what the runtime refuses is refused on import, with its message', () => {
  const file = body => `<AnimationSet version="6" id="X"><Locomotion>${body}</Locomotion></AnimationSet>`;
  const refused = [
    [file('<Except set="2HX"/>'), /set은/],
    [file('<Except/>'), /set: 필수 값/],
    [file('<Except set="Bow" direction="left"/>'), /지원하지 않는 속성/],
    [file('<Except set="Bow"/><Except set="Bow"/>'), /같은 set을 두 번/],
    // The earlier formats are not read.
    [file('<Ladder set="1HM" direction="left" walkUntil="100" runFrom="300"/>'), /지원하지 않는/],
    [file('').replace('<Locomotion>', '<Locomotion smoothing="0.1">'), /지원하지 않는 속성/],
    [file('').replace('<Locomotion>', '<Locomotion runUpperBody="true">'), /지원하지 않는 속성/],
    [file('').replace('<Locomotion>', '<Locomotion axes="own">'), /지원하지 않는 속성/],
    [file('<Tree weapon="1HM" use="own"/>'), /weapon은/],
    [file('<Tree weapon="2HW" use="true"/>'), /use는/],
    [file('<Tree weapon="H2H" use="2HM"/>'), /weapon="2HW"에만/],
    [file('<Tree weapon="2HW"/>'), /use: 필수 값/],
    [file('<Tree weapon="2HW" use="own"/><Tree weapon="2HW" use="2HM"/>'), /같은 weapon/],
  ];
  for (const [xml, message] of refused) assert.throws(() => importWorkspaceXml(xml), message, xml);
  // A project file from the earlier format is not read either.
  const old = JSON.parse(JSON.stringify(importWorkspaceXml(WALK)));
  old.locomotion = {ladders: []};
  assert.throws(() => parseWorkspace(JSON.stringify(old)), /이동 선언 형식 오류/);
});

test('edits: a set left vanilla and covered again, the declaration removed', () => {
  const w = importWorkspaceXml(WALK);
  setExcept(w, 'Bow', true);
  setExcept(w, 'Bow', true);
  assert.deepEqual(w.locomotion.except, ['Bow', 'Sneak', 'BlockSneak']); // the runtime's set order, once each
  assert.ok(!setApplies(w.locomotion, 'Bow') && setApplies(w.locomotion, '2HW'));
  setExcept(w, 'Sneak', false);
  setExcept(w, 'BlockSneak', false);
  setExcept(w, 'Bow', false);
  assert.equal(w.locomotion.except, undefined);
  assert.ok(!compileWorkspace(w).includes('<Except'));
  removeLocomotion(w);
  assert.equal(w.locomotion, undefined);
});

test("a dedicated file's movement annotations: the last one's distance over its time", () => {
  const note = (time, text) => ({time, text});
  assert.equal(motionSpeed([note(0.867, 'animmotion 0 190.16 0')], 0.867).toFixed(1), '219.3');
  // Several: the latest counts; sideways distance counts; the height does not.
  assert.equal(
    motionSpeed([note(0.5, 'animmotion 0 50 0'), note(1, 'animmotion 30 40 99'), note(0.2, 'FootLeft')], 2),
    50
  );
  // An annotation at time 0 is over the file's length.
  assert.equal(motionSpeed([note(0, 'animmotion 0 100 0')], 2), 50);
  assert.equal(motionSpeed([note(0.5, 'FootLeft'), note(0.9, 'animmotionX 1 2 3')], 1), undefined);
  assert.equal(motionSpeed([note(1, 'animmotion 0 0 0')], 1), undefined);
  assert.equal(motionSpeed([], 1), undefined);
});

test('the locomotion is one card on the canvas, there only when the project has it', () => {
  assert.ok(!flatGraph(emptyWorkspace()).nodes.some(n => n.kind === 'locomotion'));
  assert.ok(flatGraph(importWorkspaceXml(WALK)).nodes.some(n => n.kind === 'locomotion'));
});

// An own tree's files (<Tree use="own">): what the runtime looks for, their sources in the HKX library, the package.
const MOD = 'F:/Mods/Walk Run Split';
const source = clip => `${MOD}/meshes/actors/character/${clip}`.replaceAll('/', BACKSLASH);
const BACKSLASH = String.fromCharCode(92);

test('2HW files: the eighteen the runtime looks for, only with the own tree, each with its library source', () => {
  const w = importWorkspaceXml(WALK);
  const files = treeFiles(w, '2HW');
  assert.deepEqual(
    ['walk', 'run', 'strafe'].map(g => files.filter(f => f.group === g).length),
    [8, 8, 2]
  );
  assert.ok(files.every(f => /^Animations.2HW_(Walk|Run)\w+\.hkx$/.test(f.clip) && !f.localPath));
  assert.equal(files[0].name, '2HW_WalkForward.hkx');
  const picked = selectAsset(w, 'animations/2hw_runleft.HKX', source('Animations/2HW_RunLeft.hkx'));
  assert.equal(
    treeFiles(picked, '2HW').find(f => f.name === '2HW_RunLeft.hkx').localPath,
    source('Animations/2HW_RunLeft.hkx')
  );
  // The HKX library shows it as the ladder card's file.
  assert.deepEqual(assetLibrary(picked).find(e => e.name === '2hw_runleft.HKX').users, [LOCOMOTION_NODE]);
  assert.deepEqual(treeFiles(picked, 'H2H'), []); // unarmed has no tree of its own here
  setTreeUse(picked, '2HW', '2HM');
  assert.deepEqual(treeFiles(picked, '2HW'), []);
  assert.deepEqual(assetLibrary(picked)[0].users, []);
  assert.ok(isTreeFile('Animations/2HW_RunStrafeLeft.hkx') && isTreeFile('animations/h2h_walkleft.hkx'));
  assert.ok(!isTreeFile('Animations/2HM_RunLeft.hkx') && !isTreeFile('Animations/1HM_RunLeft.hkx'));
});

test('2HW files: the mod package copies the ones with a source and is not held back by the others', () => {
  let w = importWorkspaceXml(WALK);
  assert.deepEqual(packageAssets(w), []);
  w = selectAsset(w, 'Animations\\2HW_WalkForward.hkx', source('Animations/2HW_WalkForward.hkx'));
  assert.deepEqual(packageAssets(w), [
    {
      clip: 'Animations\\2HW_WalkForward.hkx',
      actorRoots: ['meshes/actors/character'],
      paths: [source('Animations/2HW_WalkForward.hkx')],
      mode: 'copy',
      dependency: '',
      expectedSha256: '',
    },
  ]);
  setTreeUse(w, '2HW', undefined);
  assert.deepEqual(packageAssets(w), []);
});

test('2HW files: an XML opened from its mod folder finds the files the mod holds', async () => {
  const w = importWorkspaceXml(WALK);
  const held = ['Animations/2HW_WalkLeft.hkx', 'Animations/2HW_RunLeft.hkx'].map(source);
  const resolve = async paths =>
    paths.map(path => {
      const at = held.find(h => h.toLowerCase() === path.toLowerCase());
      return {path, clip: at ? path.slice(path.toLowerCase().indexOf('animations')) : '', error: at ? '' : 'none'};
    });
  const xml = `${MOD}/SKSE/Plugins/AnimationInjector/WalkRun/WalkRun.xml`.replaceAll('/', BACKSLASH);
  const result = await connectXmlAssets(w, xml, resolve);
  assert.equal(result.connected, 2);
  assert.equal(result.missing, 0); // a 2HW file the mod does not hold is not a missing source
  assert.deepEqual(
    treeFiles(result.workspace, '2HW')
      .filter(f => f.localPath)
      .map(f => f.name),
    ['2HW_WalkLeft.hkx', '2HW_RunLeft.hkx']
  );
});

test('2HW files: both foot annotations must be in the file', () => {
  const notes = (...names) => names.map(text => ({text}));
  assert.deepEqual(missingFeet(notes('FootLeft', 'footright', 'weaponSwing')), []);
  assert.deepEqual(missingFeet(notes('FootLeft', 'FootRightish')), ['FootRight']);
  assert.deepEqual(missingFeet(notes('SoundPlay|FootLeft')), ['FootLeft', 'FootRight']);
  assert.deepEqual(missingFeet([]), ['FootLeft', 'FootRight']);
});

test('unarmed with a tree of its own: its sets, its files, what the runtime loads', needsChecker, () => {
  const w = importWorkspaceXml(WALK);
  assert.ok(!offeredSets(w.locomotion).includes('H2H') && offeredSets(w.locomotion).includes('2HW'));
  setTreeUse(w, 'H2H', 'own');
  assert.deepEqual(w.locomotion.trees, {'2HW': 'own', H2H: 'own'});
  assert.ok(setApplies(w.locomotion, 'H2H') && setApplies(w.locomotion, 'BlockH2H'));
  const files = treeFiles(w, 'H2H');
  assert.equal(files.length, 18);
  assert.ok(files.every(f => /^Animations.H2H_(Walk|Run)\w+\.hkx$/.test(f.clip)));
  assert.deepEqual(errors(w), []);
  const xml = compileWorkspace(w);
  assert.ok(xml.includes('<Tree weapon="2HW" use="own"/>') && xml.includes('<Tree weapon="H2H" use="own"/>'));
  check('Unarmed', xml);
  assert.deepEqual(importWorkspaceXml(xml).locomotion, w.locomotion);
  assert.deepEqual(parseWorkspace(JSON.stringify(w)).locomotion, w.locomotion);
  // Back to the one-handed tree: the files and the sets go; an exception of theirs stays for when the tree returns.
  setExcept(w, 'BlockH2H', true);
  setTreeUse(w, 'H2H', undefined);
  assert.deepEqual(w.locomotion.trees, {'2HW': 'own'});
  assert.deepEqual(treeFiles(w, 'H2H'), []);
  assert.ok(!setApplies(w.locomotion, 'H2H') && w.locomotion.except.includes('BlockH2H'));
  assert.deepEqual(errors(w), []);
  setTreeUse(w, 'H2H', 'own');
  assert.ok(setApplies(w.locomotion, 'H2H') && !setApplies(w.locomotion, 'BlockH2H'));
  setTreeUse(w, 'H2H', undefined);
  assert.throws(() => setTreeUse(w, 'H2H', '2HM'), /weapon="2HW"에만/);
});

test("a locomotion project is the game's one locomotion file, apart from actions", () => {
  let w = importWorkspaceXml(WALK);
  w.packaging.folder = 'Walk Run Split';
  // Its XML is Locomotion/Locomotion.xml, whatever the mod is called.
  assert.equal(xmlName(w), 'Locomotion');
  assert.equal(xmlSavePath(xmlName(w)), 'Locomotion.xml');
  assert.equal(packageRequest(w).locomotion, true);
  w = selectAsset(w, 'Animations\\2HW_WalkForward.hkx', source('Animations/2HW_WalkForward.hkx'));
  assert.equal(
    modXmlPath(w),
    `${MOD}/SKSE/Plugins/AnimationInjector/Locomotion/Locomotion.xml`.replaceAll('/', BACKSLASH)
  );
  // A project without a locomotion keeps its own name.
  const plain = emptyWorkspace();
  plain.packaging.folder = 'My Mod';
  assert.equal(xmlName(plain), 'My Mod');
  // A locomotion beside an event registry (or actions) is refused: the locomotion file holds nothing else.
  assert.deepEqual(errors(w), []);
  w.eventRegistry = [{id: 'e1', name: 'MyEvent', functions: []}];
  assert.ok(errors(w).some(e => /Locomotion\.xml 한 파일에만/.test(e.message)));
});
