import {test} from 'node:test';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {addLink} from '../src/workspace.ts';
import {dropBinding} from '../src/graph/flat.ts';
import {setLinkKey, setReleaseKey} from '../src/graph/cardEdits.ts';
import {synchronizeRules} from '../src/graph/sharing.ts';

// A release transition (charge) with a key of its own uses a binding of its source's inputs, as a key transition
// does; an import gives one key one binding (release review 11-02).
function sharedBinding() {
  const w = s4sample();
  const press = {...addLink(w, 'a3', 'a4'), mode: 'input'};
  w.links.push(press);
  let next = setLinkKey(w, press.id, 'E', 0);
  const input = next.links.find(l => l.id === press.id).input;
  const release = {...addLink(next, 'a3', 'a5'), mode: 'release', input};
  next = {...next, links: [...next.links, release]};
  return {w: next, press: press.id, release: release.id, input};
}
const inputsOf = (w, action) => w.actions.find(a => a.uid === action).config.inputs;

test('a binding a release transition still uses is not dropped with a key transition', () => {
  const {w, press, input} = sharedBinding();
  const next = dropBinding({...w, links: w.links.filter(l => l.id !== press)}, 'a3', input);
  assert.ok(inputsOf(next, 'a3').some(i => i.id === input));
});

test("changing a key transition's key leaves the release transition's key alone", () => {
  const {w, press, release, input} = sharedBinding();
  const next = setLinkKey(w, press, 'R', 0);
  const own = next.links.find(l => l.id === release).input;
  assert.equal(own, input);
  assert.equal(inputsOf(next, 'a3').find(i => i.id === own).key, 'E');
  assert.notEqual(next.links.find(l => l.id === press).input, input);
});

test('a shared release card given a key of its own leaves the group: each HKX keeps a binding of its own', () => {
  const w = s4sample();
  const a = {...addLink(w, 'a3', 'a5'), mode: 'release', input: ''};
  const b = {...addLink({...w, links: [...w.links, a]}, 'a4', 'a5'), mode: 'release', input: ''};
  const before = {...w, links: [...w.links, a, b], sharedRules: [{kind: 'link', members: [a.id, b.id]}]};
  const next = synchronizeRules(before, setReleaseKey(structuredClone(before), a.id, true));
  for (const l of next.links.filter(l => l.id === a.id || l.id === b.id))
    assert.ok(!l.input || inputsOf(next, l.from).some(i => i.id === l.input), `${l.from} names a binding it has`);
});
