import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liftStartLimits} from '../src/startLimits.ts';

// 시작 제한 (runtime 0.12.276): an older project's state checks move into condition branches.
const action = (uid, config, flow) => ({uid, config: {start: {mode: 'none'}, ...config}, ...(flow ? {flow} : {})});
test('state checks move to the front of a flow, before a picked action, or into a flow of its own', () => {
  const w = {
    actions: [
      // A selecting action checking a drawn weapon, picking A and B (A checks the same, B checks stamina).
      action(
        'pick',
        {start: {mode: 'input'}, weapon: true},
        {
          entry: 'Sneak',
          tests: [
            {id: 'Sneak', kind: 'sneaking', subject: 'self', minimum: 0, pass: {action: 'a'}, fail: {action: 'b'}},
          ],
        }
      ),
      action('a', {weapon: true}),
      action('b', {requiredStamina: 30}),
      // A key start of its own, and the second hit of a combo reached by a transition only.
      action('key', {start: {mode: 'input'}, blockWhileAttacking: true}),
      action('next', {weapon: true}),
      // A key start a transition with its own blend reaches: the runtime takes no flow there.
      action('blended', {start: {mode: 'input'}, weapon: true}),
      action('plain', {weapon: false, blockWhileAttacking: false, requiredStamina: 0, cooldown: 0.2}),
    ],
    links: [{from: 'key', to: 'blended', blend: 0.1}],
  };
  liftStartLimits(w);
  const [pick, a, b, key, next, blended, plain] = w.actions;
  assert.deepEqual(
    pick.flow.tests.map(t => [t.id, t.kind, t.pass, t.fail]),
    [
      ['RequireWeapon', 'weaponDrawn', {node: 'Sneak'}, undefined],
      ['Sneak', 'sneaking', {action: 'a'}, {node: 'RequireStamina'}],
      ['RequireStamina', 'stamina', {action: 'b'}, undefined],
    ],
    "the owner's front check guards A; B's own check sits just before it"
  );
  assert.equal(pick.flow.entry, 'RequireWeapon');
  assert.equal(pick.flow.tests[2].minimum, 30);
  assert.equal(a.flow, undefined);
  assert.equal(b.flow, undefined);
  assert.deepEqual(key.flow, {
    entry: 'RequireNotAttacking',
    tests: [
      {
        id: 'RequireNotAttacking',
        subject: 'self',
        minimum: 0,
        kind: 'attackState',
        attackState: 'none',
        pass: {action: 'key'},
      },
    ],
  });
  assert.equal(next.flow, undefined, 'a transition-only action keeps no check');
  assert.equal(blended.flow, undefined, 'a blended transition target cannot hold a flow');
  assert.equal(plain.flow, undefined, 'no check, no flow');
  for (const x of w.actions)
    for (const k of ['weapon', 'blockWhileAttacking', 'requiredStamina']) assert.equal(k in x.config, false, k);
  assert.equal(plain.config.cooldown, 0.2);
});
