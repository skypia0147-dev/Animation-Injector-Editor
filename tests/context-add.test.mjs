import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from '../src/s4sample.ts';
import {flatGraph, addFlat} from '../src/graph/flat.ts';
import {compactGraph} from '../src/graph/sharing.ts';
import {contextualAdds, addConnected} from '../src/graph/contextAdd.ts';
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
      assert.ok(g.nodes.some(n => n.id === r.id));
      assert.ok(g.edges.some(e => e.source === r.id || e.target === r.id));
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
test('branch context offers explicit pass/fail destinations and connects the chosen port', () => {
  const w = s4sample(),
    r = addFlat(w, w.actions[0].uid, 'conditionBranch', {x: 0, y: 0});
  for (const option of contextualAdds(r.workspace, r.id)) {
    assert.ok(['pass', 'fail'].includes(option.port));
    const next = addConnected(r.workspace, r.id, option, {x: 300, y: 0});
    const t = next.workspace.actions[0].flow.tests.find(t => t.id === r.id.split(':').at(-1));
    assert.ok(t[option.port]);
  }
});

test('paired playback exposes blends first and completes both endpoints without duplicate blends', () => {
  const w = s4sample(),
    a = w.actions[0],
    n = flatGraph(w).nodes.find(n => n.action === a.uid && n.kind === 'hkxPlay');
  for (const before of [true, false]) {
    const option = contextualAdds(w, n.id).find(o => o.kind === 'blend' && !!o.before === before);
    assert.ok(option);
    const r = addConnected(w, n.id, option, {x: 1, y: 2});
    const b = (r.workspace.blends ?? []).find(b => b.id === r.id);
    if (b) {
      assert.ok(b.source);
      assert.ok(b.target);
    }
    const repeated = addConnected(r.workspace, n.id, option, {x: 3, y: 4});
    assert.equal(repeated.id, r.id);
    assert.equal(contextualAdds(w, n.id)[0].kind, 'blend');
  }
});

test('lightweight next-play menu matches actual connection validation', () => {
  for (const field of ['cooldown', 'air', 'default', 'mixed']) {
    const r = addFlat(s4sample(), '', 'playNode', {x: 0, y: 0}),
      w = r.workspace;
    const a = w.actions.at(-1);
    if (field === 'cooldown') a.config.cooldown = 2;
    if (field === 'air') a.config.air = 'deny';
    if (field === 'mixed') {
      a.config.kind = 'combo';
      a.config.transitions = [
        {
          id: 'T1',
          from: a.config.entry,
          to: 'Missing',
          open: {basis: 'time', value: 1},
          close: {basis: 'time', value: 2},
          buffered: true,
          input: '',
        },
        {
          id: 'T2',
          from: a.config.entry,
          to: 'Missing',
          open: {basis: 'time', value: 2},
          close: {basis: 'time', value: 3},
          buffered: false,
          input: '',
        },
      ];
    }
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
