import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction, addLink, compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {placeStepFile} from '../src/view.ts';
import {assets} from '../src/package.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {contextualAdds} from '../src/graph/contextAdd.ts';
import {
  actionRig,
  creatureLimits,
  familyLabel,
  resolvePairRole,
  rigFamily,
  rigFromPath,
  rigsOfSkeletons,
} from '../src/creatureRig.ts';
import {withPairChanges} from '../src/graph/pairFacing.ts';

// A creature's own action (runtime 1.1.0 <Action rig>, docs/mockup-creature-rig 2안): the skeleton comes from the
// folder the HKX sits in, never from a choice on the card.
const CANINE = 'D:\\Mods\\Wolf Howl\\meshes\\actors\\canine\\animations\\WolfHowl\\howl.hkx';
const HUMAN = 'D:\\Mods\\Wolf Howl\\meshes\\actors\\character\\animations\\Slash.hkx';
function card(w, path, clip) {
  const a = addAction(w);
  w.actions.push(a);
  return placeStepFile(w, a.uid, a.config.steps[0].id, clip, path);
}

test('the folder an HKX sits in names its skeleton family', () => {
  assert.ok(rigFamily(rigFromPath(CANINE)).includes('wolf') && rigFamily(rigFromPath(CANINE)).includes('dog'));
  assert.equal(rigFromPath(HUMAN), 'character');
  assert.equal(rigFromPath('D:\\x\\meshes\\actors\\dlc02\\scrib\\animations\\a.hkx'), 'ashhopper');
  assert.equal(rigFromPath('D:\\x\\meshes\\actors\\draugr\\animations\\a.hkx') !== undefined, true);
  assert.equal(rigFromPath('D:\\Downloads\\howl.hkx'), undefined);
  assert.equal(familyLabel('wolf').includes('·'), true, 'dog and wolf share a label');
});

test('picking a creature HKX makes the card that creature’s; a character HKX makes it the character’s again', () => {
  let w = card(emptyWorkspace(), CANINE, 'animations\\WolfHowl\\howl.hkx');
  const a = w.actions[0];
  assert.ok(rigFamily(actionRig(a)).includes('wolf'));
  assert.match(compileWorkspace(w), /<Action [^>]*rig="(dog|wolf)"/);
  // The HKX goes to the creature's folder in a mod folder export, not the character's.
  assert.deepEqual(assets(w)[0].actorRoots, ['meshes/actors/canine']);
  w = placeStepFile(w, a.uid, a.config.steps[0].id, 'animations\\Slash.hkx', HUMAN);
  assert.equal(w.actions[0].config.rig, undefined);
  assert.doesNotMatch(compileWorkspace(w), /rig="/);
});

test('an XML creature action reads and writes back its rig', () => {
  const xml = compileWorkspace(card(emptyWorkspace(), CANINE, 'animations\\WolfHowl\\howl.hkx'));
  const back = importWorkspaceXml(xml);
  assert.ok(rigFamily(actionRig(back.actions[0])).includes('wolf'));
  assert.equal(compileWorkspace(back), xml);
  assert.throws(() => importWorkspaceXml(xml.replace(/rig="\w+"/, 'rig="unicorn"')), /unicorn/);
});

test('a creature card offers only what a creature plays, and what it already holds is its problem', () => {
  const w = card(emptyWorkspace(), CANINE, 'animations\\WolfHowl\\howl.hkx');
  const a = w.actions[0];
  const id = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === a.uid).id;
  const kinds = contextualAdds(w, id).map(o => o.kind);
  for (const hidden of ['qte', 'cameraRestore', 'notify:hide', 'notify:show', 'notify:fireArrow'])
    assert.ok(!kinds.includes(hidden), hidden);
  assert.ok(kinds.includes('notify:sound') && kinds.includes('notify:iframe'), 'what a creature plays stays');
  assert.deepEqual(creatureLimits(w, a), []);
  a.config.air = 'allow';
  a.cameraEnabled = true;
  assert.equal(creatureLimits(w, a).length, 2);
  assert.ok(
    validateWorkspace(w).some(i => i.level === 'error' && i.node === a.uid && /쓸 수 없습니다/.test(i.message))
  );
});

test('a transition stays within one skeleton', () => {
  let w = card(emptyWorkspace(), CANINE, 'animations\\WolfHowl\\howl.hkx');
  w = card(w, HUMAN, 'animations\\Slash.hkx');
  const [wolf, human] = w.actions;
  assert.throws(() => addLink(w, wolf.uid, human.uid), /스켈레톤이 다른/);
  assert.throws(() => addLink(w, human.uid, wolf.uid), /스켈레톤이 다른/);
  w = card(w, CANINE, 'animations\\WolfHowl\\bite.hkx');
  assert.doesNotThrow(() => addLink(w, wolf.uid, w.actions[2].uid));
});

// A pair a creature starts (runtime 1.1.0 <Pair rig>, docs/mockup-creature-pair 2안): both roles' skeletons come from
// the paired HKX's track names (hkx_meta pairRigs), the rig being its initiator; its clip stays in the character's folder.
const WOLF_PAIR = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="WolfKill">
  <Start event="NPCWolfAttackA" block="NPCWolfAttackA" actor="npc" target="combatTarget" to="WolfPounce"/>
  <Pair id="WolfPounce" rig="wolf" clip="animations\MyMod\WolfPounce.hkx">
    <FindPartner range="200" angle="90"/>
    <Exit blend="0.3"/>
  </Pair>
</AnimationSet>`;

test('the skeletons a pair HKX names map to rigs; one family is taken, several are left to choose', () => {
  assert.deepEqual(
    rigsOfSkeletons([
      'builtin/skeletons/canine_wolf.hkx',
      'builtin/skeletons/character_female.hkx',
      'builtin/skeletons/character.hkx',
    ]),
    ['wolf', 'character']
  );
  assert.deepEqual(resolvePairRole(['dog', 'wolf'], 'character'), {rig: 'dog', choices: []});
  assert.deepEqual(resolvePairRole(['dog', 'wolf'], 'wolf'), {rig: 'wolf', choices: []});
  assert.deepEqual(resolvePairRole(['giant', 'lurker'], 'character'), {rig: undefined, choices: ['giant', 'lurker']});
  assert.deepEqual(resolvePairRole(['giant', 'lurker'], 'lurker'), {rig: 'lurker', choices: ['giant', 'lurker']});
  assert.deepEqual(resolvePairRole([], 'bear'), {rig: undefined, choices: []});
});

test('a pair the HKX says a wolf starts gets rig, writes it on <Pair> and reads it back', () => {
  const w = importWorkspaceXml(WOLF_PAIR.replace(' rig="wolf"', ''));
  const pair = w.actions.find(a => a.pair);
  assert.equal(actionRig(pair), 'character');
  const found = withPairChanges(w, new Map([[pair.uid, {rig: 'wolf', targetRig: 'character'}]]));
  const xml = compileWorkspace(found);
  assert.match(xml, /<Pair id="WolfPounce" rig="wolf" clip=/);
  const back = importWorkspaceXml(xml);
  assert.equal(actionRig(back.actions.find(a => a.pair)), 'wolf');
  assert.equal(compileWorkspace(back), xml);
  // Both roles read the one paired HKX from the character's folder.
  assert.deepEqual(assets(found)[0].actorRoots, ['meshes/actors/character']);
});

test('a creature-started pair: its card, its menu and what it may not have', () => {
  const w = importWorkspaceXml(WOLF_PAIR);
  const pair = w.actions.find(a => a.pair);
  assert.deepEqual(
    validateWorkspace(w).filter(i => i.level === 'error'),
    []
  );
  const id = flatGraph(w).nodes.find(n => n.kind === 'hkxPlay' && n.action === pair.uid).id;
  const kinds = contextualAdds(w, id).map(o => o.kind);
  assert.ok(!kinds.includes('carry') && !kinds.includes('cameraRestore'), kinds.join());
  assert.ok(kinds.includes('notify:strike'), 'a strike stays');
  // A creature partner: refused until the runtime takes one.
  const bear = structuredClone(w);
  bear.actions.find(a => a.pair).pair.targetRig = 'bear';
  assert.ok(validateWorkspace(bear).some(i => i.level === 'error' && /상대는 인간만/.test(i.message)));
  // The partner's next action is the partner's skeleton's.
  const partnerXml = rig =>
    WOLF_PAIR.replace(
      '<Exit blend="0.3"/>',
      '<Exit blend="0.3"/><Transition to="Shake" partnerTo="Fall" event="e"/>'
    ).replace(
      '</AnimationSet>',
      `<Action id="Shake" rig="wolf" clip="animations\\shake.hkx"/><Action id="Fall"${rig} clip="animations\\fall.hkx"/></AnimationSet>`
    );
  assert.throws(() => importWorkspaceXml(partnerXml(' rig="wolf"')), /상대의 다음 동작/);
  assert.doesNotThrow(() => importWorkspaceXml(partnerXml('')), 'the partner goes on as a character');
});
