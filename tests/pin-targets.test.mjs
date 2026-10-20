import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace} from '../src/workspace.ts';
import {addConnected} from '../src/graph/contextAdd.ts';
import {checklistModel, checklistProjection} from '../src/graph/checklist.ts';
import {pinRows, connectPin, routable, shareRow} from '../src/graph/pinTargets.ts';
import {shareCondition} from '../src/graph/reuseConnection.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {flatGraph} from '../src/graph/flat.ts';

// Connecting by choosing from a list (the card's ▾ and Details "연결"): the same connection as a drag.
const SOURCE = `<AnimationSet version="4" id="Pins">
  <Inputs><Input id="use" key="E"/></Inputs>
  <Pair id="Grab" clip="Animations\\Test\\Grab.hkx"><Start input="use"/></Pair>
  <Pair id="Carry" clip="Animations\\Test\\Carry.hkx"></Pair>
  <Action id="Attacker" clip="Animations\\Test\\Attacker.hkx"/>
  <Action id="Victim" clip="Animations\\Test\\Victim.hkx"/>
  <Action id="Dispatch" clip="Animations\\Test\\D.hkx"><Start event="Go"/>
    <Flow entry="C1">
      <Test id="C1" kind="air" subject="self" pass="P1" fail="C2"/>
      <Test id="C2" kind="combat" subject="self" pass="P2"/>
      <Play id="P1" action="Attacker"/>
      <Play id="P2" action="Victim"/>
    </Flow>
  </Action>
</AnimationSet>`;
// a1 Grab (pair), a2 Carry (pair), a3 Attacker, a4 Victim, a5 Dispatch (flow)
const view = w => checklistProjection(w, checklistModel(w));
const hkx = uid => `anim:${uid}:|clip_A1`;
const choose = (w, id, pin, target) => connectPin(w, view(w), id, pin, target);

test('a new transition node lists HKX destinations and choosing one makes the transition', () => {
  let w = importWorkspaceXml(SOURCE);
  const added = addConnected(w, hkx('a1'), {kind: 'markerReceive', label: '전환 이벤트 추가'}, {x: 0, y: 0});
  w = added.workspace;
  w.drafts.find(d => d.id === added.id).value.config.start.event = 'Stage1';
  const [row] = pinRows(w, view(w), added.id);
  assert.equal(row.pin, 'trigger');
  assert.equal(row.current, '');
  assert.ok(row.targets.some(t => t.id === hkx('a3') && t.group === '일반 동작' && !t.disabled));
  w = choose(w, added.id, 'trigger', hkx('a3'));
  assert.deepEqual(
    w.links.map(l => [l.from, l.to, l.event]),
    [['a1', 'a3', 'Stage1']]
  );
});

test('a pair transition lists its attacker and victim with the runtime rules, and the victim can be cleared', () => {
  let w = importWorkspaceXml(SOURCE);
  const added = addConnected(w, hkx('a1'), {kind: 'markerReceive', label: '전환 이벤트 추가'}, {x: 0, y: 0});
  w = added.workspace;
  w.drafts.find(d => d.id === added.id).value.config.start.event = 'Stage1';
  w = choose(w, added.id, 'trigger', hkx('a3'));
  const node = `link:${w.links[0].id}|markerReceive`;
  assert.ok(routable(view(w).nodes.find(n => n.id === node)));
  let rows = pinRows(w, view(w), node);
  assert.deepEqual(
    rows.map(r => [r.pin, r.label, r.currentLabel, r.clearable]),
    [
      ['trigger', '가해자', 'Attacker', false],
      ['partner', '피해자', '', true],
    ]
  );
  const partner = rows[1].targets;
  assert.match(partner.find(t => t.id === hkx('a2')).disabled, /페어/);
  assert.match(partner.find(t => t.id === hkx('a3')).disabled, /가해자/);
  assert.equal(partner.find(t => t.id === hkx('a4')).disabled, undefined);
  w = choose(w, node, 'partner', hkx('a4'));
  assert.equal(w.links[0].partnerTo, 'a4');
  rows = pinRows(w, view(w), node);
  assert.equal(rows[1].currentLabel, 'Victim');
  assert.match(compileWorkspace(w), /<Connect to="Attacker" partnerTo="Victim" event="Stage1"\/>/);
  w = choose(w, node, 'partner', '');
  assert.equal(w.links[0].partnerTo, '');
  assert.throws(() => choose(w, node, 'trigger', ''), /비워 둘 수 없습니다/);
});

test('a condition route is replaced by the choice (not shared), can point at another condition, and can be cleared', () => {
  let w = importWorkspaceXml(SOURCE);
  const c1 = 'flow:a5:C1',
    rows = pinRows(w, view(w), c1);
  assert.deepEqual(
    rows.map(r => [r.label, r.currentLabel]),
    [
      ['통과', 'Attacker'],
      ['실패', 'C2'],
    ]
  );
  assert.ok(rows[0].targets.some(t => t.id === 'flow:a5:C2' && t.group === '조건'));
  assert.ok(!rows[0].targets.some(t => t.id === c1), 'not itself');
  w = choose(w, c1, 'pass', hkx('a4'));
  const tests = () => w.actions.find(a => a.uid === 'a5').flow.tests;
  assert.deepEqual(tests().find(t => t.id === 'C1').pass, {action: 'a4'});
  assert.equal(w.sharedRules?.length ?? 0, 0);
  w = choose(w, c1, 'fail', '');
  assert.equal(tests().find(t => t.id === 'C1').fail, undefined);
  w = choose(w, c1, 'fail', 'flow:a5:C2');
  assert.deepEqual(tests().find(t => t.id === 'C1').fail, {node: 'C2'});
});

test('only routing nodes offer a list', () => {
  const w = importWorkspaceXml(SOURCE);
  assert.deepEqual(pinRows(w, view(w), hkx('a3')), []);
});

test('a dispatch-only action stays in its condition lists without a card, and the lists show the route rules', () => {
  let w = importWorkspaceXml(SOURCE);
  // a5 sends every route elsewhere: no card is drawn, yet its lists still offer a route back to it.
  assert.ok(!view(w).nodes.some(n => n.id === hkx('a5')));
  const [pass] = pinRows(w, view(w), 'flow:a5:C1'),
    target = id => pass.targets.find(t => t.id === hkx(id));
  assert.equal(target('a5').disabled, undefined);
  assert.match(target('a1').disabled, /페어는 페어의 조건/);
  w = choose(w, 'flow:a5:C1', 'pass', hkx('a5'));
  assert.deepEqual(w.actions.find(a => a.uid === 'a5').flow.tests.find(t => t.id === 'C1').pass, {action: 'a5'});
  assert.ok(
    view(w).nodes.some(n => n.id === hkx('a5')),
    'a route back to it: no longer dispatch-only, its card is drawn'
  );
});

test('"공유 →" lists the actions that can take the condition and shares it only when chosen', () => {
  let w = importWorkspaceXml(SOURCE);
  const row = shareRow(w, view(w), 'flow:a5:C1');
  assert.ok(!row.targets.some(t => t.id === hkx('a5')), 'not its own action');
  assert.equal(row.targets.find(t => t.id === hkx('a3')).disabled, undefined);
  w = shareCondition(w, 'flow:a5:C1', 'a3');
  assert.equal(w.actions.find(a => a.uid === 'a3').flow.tests[0].kind, 'air');
  assert.match(shareRow(w, view(w), 'flow:a5:C1').targets.find(t => t.id === hkx('a3')).disabled, /이미 조건/);
  assert.throws(() => shareCondition(w, 'flow:a5:C1', 'a3'), /이미 조건/);
  assert.equal(compactGraph(w, flatGraph(w)).nodes.filter(n => n.kind === 'conditionBranch').length, 2);
});
