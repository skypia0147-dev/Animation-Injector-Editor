import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNumberDraft, shownNumber} from '../src/ui/details/numberDraft.ts';
import {emptyWorkspace, addAction, parseWorkspace} from '../src/workspace.ts';

test('empty or partial number text never becomes a document value', () => {
  for (const text of ['', ' ', '-', '1e', 'abc', 'Infinity', '-Infinity', 'NaN'])
    assert.equal(parseNumberDraft(text), undefined, JSON.stringify(text));
  assert.equal(parseNumberDraft('0'), 0);
  assert.equal(parseNumberDraft('0.25'), 0.25);
  assert.equal(parseNumberDraft('-3'), -3);
  assert.equal(parseNumberDraft('1e3'), 1000);
});

test('the number box shows drag preview, then draft text, then the stored value', () => {
  assert.equal(shownNumber(0.2, null), '0.2');
  assert.equal(shownNumber(0.2, ''), '');
  assert.equal(shownNumber(0.2, '0.'), '0.');
  assert.equal(shownNumber(0.2, '', 0.4), '0.4');
  assert.equal(shownNumber(Number.NaN, null), '');
});

test('a NaN value turns into null in JSON and the recovery parser rejects it', () => {
  // The recovery writer relies on this: an unparsable document is never stored.
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  const valid = JSON.stringify(w);
  assert.doesNotThrow(() => parseWorkspace(valid));
  w.actions[0].config.enterBlend = Number.NaN;
  const broken = JSON.stringify(w);
  assert.match(broken, /"enterBlend":null/);
  assert.throws(() => parseWorkspace(broken));
});
