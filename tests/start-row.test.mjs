import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {savedProject} from '../src/editorBlock.ts';
import {parseWorkspace} from '../src/workspace.ts';
import {addFlat, flatGraph} from '../src/graph/flat.ts';
import {startRow} from '../src/graph/startRow.ts';
import {executeGraphCommand} from '../src/graph/commands.ts';

// The "시작" row under an HKX card's title (mockup A, 10-20): how its action starts.
const grapple = () =>
  parseWorkspace(savedProject(readFileSync('tests/fixtures/grapple-carry-qte-cuts.xml', 'utf8')).project);
const rows = w => {
  const g = flatGraph(w);
  return g.nodes.filter(n => n.kind === 'hkxPlay').map(n => ({n, row: startRow(w, n, g)}));
};

test('a card says its start key, or the actions that lead to it', () => {
  const w = grapple();
  const all = rows(w).filter(r => r.row);
  const set = all.filter(r => r.row.tone === 'set'),
    via = all.filter(r => r.row.tone === 'via');
  assert.ok(set.length > 0 && via.length > 0);
  // A start card going straight to the action: the row picks it.
  for (const {n, row} of set) {
    const start = w.starts.find(s => 'startCard:' + s.uid === row.node);
    assert.equal(start?.to?.action, n.action);
  }
  // Grapple's stage targets start only through the attacker's transitions.
  for (const {n, row} of via) {
    assert.ok(!w.starts.some(s => s.to?.action === n.action));
    assert.match(row.text, /\(.+\)/);
  }
  assert.ok(!all.some(r => r.row.tone === 'none'), 'every Grapple action starts somehow');
});

test('a new card has no start and gets one from the row', () => {
  let w = grapple();
  const r = addFlat(w, '', 'playNode', {x: 0, y: 0});
  w = r.workspace;
  const card = rows(w).find(x => x.n.id === r.id);
  assert.equal(card.row.tone, 'none');
  // ＋ 키: the same command as the card's right-click "시작 키 입력 추가".
  const added = executeGraphCommand(w, {
    type: 'addConnected',
    source: r.id,
    option: {label: '', kind: 'keyInput', before: true},
    position: {x: -300, y: 0},
  });
  const after = rows(added.workspace).find(x => x.n.id === r.id);
  assert.equal(after.row.tone, 'set');
});

test("an action an event's QTE starts says so (10-20: it read 'no way to start')", async () => {
  const {emptyWorkspace, wrap} = await import('../src/workspace.ts');
  const {createProject} = await import('../src/model.ts');
  const {connectFlat} = await import('../src/graph/flat.ts');
  let w = emptyWorkspace();
  for (const [i, id] of ['Stage10Attacker', 'Stage10Target'].entries()) {
    const p = createProject('single');
    p.actionId = id;
    p.name = id;
    p.steps[0].clip = 'Animations/' + id + '.hkx';
    w.actions.push(wrap(p, 'b' + i));
  }
  const qte = addFlat(w, '', 'qte', {x: 400, y: 0});
  w = qte.workspace;
  const draft = addFlat(w, '', 'markerReceive', {x: 0, y: 0});
  w = draft.workspace;
  w.starts.find(s => 'startCard:' + s.uid === draft.id).event = 'Grapple_Stage_Start_10';
  w = connectFlat(w, draft.id, qte.id, 'trigger');
  w.qtes[0].results.success = {mode: 'transition', event: '', recipient: 'self', to: 'b0', partnerTo: 'b1'};
  for (const {row} of rows(w)) {
    assert.equal(row.tone, 'via');
    assert.match(row.text, /Grapple_Stage_Start_10/);
  }
});
