import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventSenders} from '../src/graph/annotations.ts';

test('a paired clip says which actor sends an event: "2_" the victim, otherwise the attacker', () => {
  const list = [
    {time: 0.4, text: '2_Grapple_Stage_Start_02'},
    {time: 0.4, text: 'Grapple_Stage_Start_01'},
    {time: 0.9, text: 'NPCGrapple_Stage_Start_01'},
    {time: 1.2, text: '2_Grapple_Stage_Start_10|1'},
  ];
  assert.deepEqual([...eventSenders(list, 'Grapple_Stage_Start_02')], ['partner']);
  assert.deepEqual([...eventSenders(list, 'Grapple_Stage_Start_01')], ['self']);
  assert.deepEqual([...eventSenders(list, 'Grapple_Stage_Start_10')], ['partner']);
  assert.equal(eventSenders(list, 'Missing').size, 0);
});
