import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, compileWorkspace, parseWorkspace} from '../src/workspace.ts';
import {addFlat, connectFlat, flatGraph} from '../src/graph/flat.ts';
import {animId, lowerBlends, editBlend} from '../src/graph/blends.ts';
import {captureGraph} from '../src/graph/document.ts';
import {disconnectEdge, lowerDisconnected} from '../src/graph/disconnect.ts';
import {parseXml} from '../src/xml.ts';

function sample() {
  let w = emptyWorkspace();
  for (let i = 0; i < 3; i++) w = addFlat(w, '', 'playNode', {x: 600, y: 200 * i}).workspace;
  const [a, b, c] = w.actions;
  w.actions.forEach((a, i) => {
    a.config.steps[0].clip = `animations\\Clip${i}.hkx`;
    a.config.actionId = 'Action' + i;
  });
  a.config.start.mode = 'event';
  a.config.start.event = 'TestStart';
  a.flow = {
    entry: 'Female',
    tests: [
      {id: 'Female', kind: 'female', subject: 'self', minimum: 0, pass: {action: b.uid}, fail: {node: 'Alive'}},
      {id: 'Alive', kind: 'alive', subject: 'self', minimum: 0, pass: {action: c.uid}},
      {id: 'Unused', kind: 'ground', subject: 'self', minimum: 0, pass: {action: a.uid}},
    ],
  };
  w.blends = [{id: 'Blend', source: `start:${a.uid}|markerReceive`, target: '', seconds: 0.4}];
  return {w, a, b, c, branch: `flow:${a.uid}:Female`, input: `start:${a.uid}|markerReceive`};
}

test('event → blend → conditions preserves branch topology and exports all candidate entry blends', () => {
  let {w, a, b, c, branch, input} = sample();
  w = connectFlat(w, 'Blend', branch);
  const g = flatGraph(w);
  assert.ok(g.edges.some(e => e.source === input && e.target === 'Blend'));
  assert.ok(g.edges.some(e => e.source === 'Blend' && e.target === branch));
  assert.ok(!g.edges.some(e => e.source === input && e.target === branch));
  assert.ok(g.edges.some(e => e.source === branch && e.pin === 'pass' && e.target === animId(b.uid, 'clip_A1')));
  assert.ok(lowerBlends(w).actions.every(a => a.enterBlendEnabled && a.config.enterBlend === 0.4));
  const xml = compileWorkspace(w),
    out = parseXml(xml);
  for (const id of [b.config.actionId, c.config.actionId]) {
    const action = out.children.find(n => n.name === 'Action' && n.attrs.id === id);
    assert.equal(action.children.find(n => n.name === 'Enter').attrs.blend, '0.4');
  }
  assert.equal(compileWorkspace(parseWorkspace(JSON.stringify(captureGraph(w)))), xml);
  w = editBlend(w, 'Blend', {seconds: 0.8});
  assert.ok(lowerBlends(w).actions.every(a => a.config.enterBlend === 0.8));
  const cut = disconnectEdge(
    w,
    g.edges.find(e => e.source === 'Blend' && e.target === branch)
  );
  assert.throws(() => compileWorkspace(cut), /블렌드 양쪽/);
  assert.equal(compileWorkspace(connectFlat(cut, 'Blend', branch)), compileWorkspace(w));
});

test('connect conditions before the event; entry switching excludes unreachable candidates', () => {
  let {w, a, b, c, input} = sample();
  w.blends[0].source = '';
  w = connectFlat(w, 'Blend', `flow:${a.uid}:Alive`);
  w = connectFlat(w, input, 'Blend');
  const n = lowerBlends(w);
  assert.equal(n.actions.find(x => x.uid === b.uid).enterBlendEnabled, false);
  assert.equal(n.actions.find(x => x.uid === c.uid).config.enterBlend, 0.4);
  assert.equal(n.actions[0].flow.entry, 'Alive');
  assert.doesNotThrow(() => compileWorkspace(w));
});

test('different entry blends for the same selected action report a conflict instead of overwriting a path', () => {
  let {w, b, branch} = sample();
  w = connectFlat(w, 'Blend', branch);
  w.blends.push({id: 'Other', source: 'entry', target: animId(b.uid, 'clip_A1'), seconds: 0.2});
  assert.throws(() => compileWorkspace(w), /블렌드가 충돌/);
  w.blends[1].seconds = 0.4;
  assert.doesNotThrow(() => compileWorkspace(w));
});

test('unrelated event cannot take over another action condition flow through a blend', () => {
  let {w, b, branch} = sample();
  b.config.start.mode = 'event';
  b.config.start.event = 'Other';
  w.blends[0].source = `start:${b.uid}|markerReceive`;
  assert.throws(() => connectFlat(w, 'Blend', branch));
});
