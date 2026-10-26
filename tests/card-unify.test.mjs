import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importWorkspaceXml} from '../src/importXml.ts';
import {compileWorkspace} from '../src/workspace.ts';
import {checklistModel, transferItem} from '../src/graph/checklist.ts';

// A feature dragged from one HKX card onto another (unify ⑪, 10-27): moved, or copied with Ctrl; a feature the card
// has once already is refused.
const grapple = () =>
  importWorkspaceXml(readFileSync(new URL('./fixtures/current-xml/Grapple.xml', import.meta.url), 'utf8'));
const kinds = (w, action) => {
  const m = checklistModel(w),
    card = m.raw.nodes.find(n => n.kind === 'hkxPlay' && n.action === action);
  // A pair's notify is pair:<kind>.
  return (m.items.get(card.id) ?? []).map(i => (i.node.notify ?? i.node.kind).replace(/^pair:/, ''));
};
const armorOf = (w, action) => checklistModel(w).raw.nodes.find(n => n.action === action && n.notify === 'armor').id;

test('feature drag: moved to another HKX card, the original gone', () => {
  const w = grapple();
  assert.ok(kinds(w, 'a3').includes('armor') && !kinds(w, 'a1').includes('armor'));
  const moved = transferItem(w, armorOf(w, 'a3'), 'a1', false);
  assert.ok(kinds(moved, 'a1').includes('armor'), 'the card it was let go on has it');
  assert.ok(!kinds(moved, 'a3').includes('armor'), 'the card it came from has it no more');
  assert.doesNotThrow(() => compileWorkspace(moved));
});
test('feature drag: Ctrl copies, a feature the card has already is refused', () => {
  const w = grapple();
  const copied = transferItem(w, armorOf(w, 'a3'), 'a1', true);
  assert.ok(kinds(copied, 'a1').includes('armor') && kinds(copied, 'a3').includes('armor'));
  assert.throws(() => transferItem(w, armorOf(w, 'a3'), 'a4', false), /넣을 수 없는/);
  assert.equal(transferItem(w, armorOf(w, 'a3'), 'a3', false), w, 'onto its own card: nothing');
});
