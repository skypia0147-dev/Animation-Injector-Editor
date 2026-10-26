import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {flatGraph, addFlat} from '../src/graph/flat.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {contextualAdds, addConnected} from '../src/graph/contextAdd.ts';
import {compileWorkspace} from '../src/workspace.ts';
test('every offered node action creates a connected node without mutating the source document', () => {
  const w = s4sample(),
    before = JSON.stringify(w);
  for (const action of [w.actions[0], w.actions[2]]) {
    const node = flatGraph(w).nodes.find(n => n.action === action.uid && n.kind === 'hkxPlay');
    const options = contextualAdds(w, node.id);
    assert.ok(options.length > 3);
    for (const option of options) {
      const r = addConnected(w, node.id, option, {x: 10, y: 20}),
        g = compactGraph(r.workspace, flatGraph(r.workspace));
      assert.ok(
        g.nodes.some(n => n.id === r.id),
        option.kind
      );
      assert.ok(
        g.edges.some(e => e.source === r.id || e.target === r.id),
        option.kind
      );
    }
  }
  assert.equal(JSON.stringify(w), before);
});
test("both playbacks offer clip-time functions; pair-only ones stay a pair's (runtime 0.12.274)", () => {
  const w = s4sample(),
    get = a => flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay').id;
  assert.ok(contextualAdds(w, get(w.actions[0])).some(o => o.kind === 'notify:spell'));
  const ordinary = contextualAdds(w, get(w.actions[2])).map(o => o.kind);
  for (const op of ['spell', 'shake', 'hide', 'timeOn']) assert.ok(ordinary.includes('notify:' + op), op);
  for (const op of ['cancel']) assert.ok(!ordinary.includes('notify:' + op), op);
  assert.deepEqual(contextualAdds(w, 'missing'), []);
});
test('a condition card offers a row, and an HKX or a card on its False; each lands on that pin', () => {
  const w = s4sample(),
    r = addFlat(w, '', 'conditionCard', {x: 0, y: 0}),
    uid = r.id.slice('conditionCard:'.length);
  const options = contextualAdds(r.workspace, r.id);
  assert.deepEqual(
    options.map(o => [o.kind, o.port]),
    [
      ['row', undefined],
      ['playNode', 'false'],
      ['conditionCard', 'false'],
    ]
  );
  const row = addConnected(r.workspace, r.id, options[0], {x: 300, y: 0}).workspace;
  assert.equal(row.cards.find(c => c.uid === uid).rows.length, 1);
  const play = addConnected(r.workspace, r.id, options[1], {x: 300, y: 0}).workspace;
  assert.equal(play.cards.find(c => c.uid === uid).false.action, play.actions.at(-1).uid);
  const card = addConnected(r.workspace, r.id, options[2], {x: 300, y: 0});
  assert.equal(card.workspace.cards.find(c => c.uid === uid).false.card, card.id.slice('conditionCard:'.length));
  // A False already set: not offered again.
  assert.ok(!contextualAdds(play, r.id).some(o => o.port === 'false'));
});

test('playback blends are offered first while absent and added once', () => {
  const w = s4sample(),
    a = w.actions[0];
  a.enterBlendEnabled = false;
  a.exitBlendEnabled = false;
  const n = flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay');
  assert.equal(contextualAdds(w, n.id)[0].kind, 'blend');
  for (const before of [true, false]) {
    const option = contextualAdds(w, n.id).find(o => o.kind === 'blend' && !!o.before === before);
    assert.ok(option);
    const r = addConnected(w, n.id, option, {x: 1, y: 2});
    assert.equal(r.workspace.actions[0][before ? 'enterBlendEnabled' : 'exitBlendEnabled'], true);
    assert.match(compileWorkspace(r.workspace), before ? /<Pair id="[^"]+" clip="[^"]+" enter=/ : /<Exit blend=/);
    const repeated = addConnected(r.workspace, n.id, option, {x: 3, y: 4});
    assert.equal(repeated.id, r.id);
    assert.ok(!contextualAdds(r.workspace, n.id).some(o => o.kind === 'blend' && !!o.before === before));
  }
});

test('lightweight next-play menu matches actual connection validation', () => {
  for (const field of ['air', 'default']) {
    const r = addFlat(s4sample(), '', 'playNode', {x: 0, y: 0}),
      w = r.workspace;
    const a = w.actions.at(-1);
    if (field === 'air') a.config.air = 'only';
    const expected = (() => {
      try {
        addConnected(w, r.id, {kind: 'playNode', label: 'next'}, {x: 300, y: 0});
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(
      contextualAdds(w, r.id).some(o => o.kind === 'playNode'),
      expected,
      field
    );
  }
});
