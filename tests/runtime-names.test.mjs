import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {s4sample} from './fixtures/s4sample.ts';
import {compileWorkspace, validateWorkspace} from '../src/workspace.ts';
import {runtimeNameUses, runtimeEventNames, runtimeFixedNames} from '../src/runtimeNames.ts';
import {runtimeSource, needsRuntimeSource} from './local.mjs';

const warnings = w =>
  validateWorkspace(w).filter(
    i => i.level === 'warning' && runtimeFixedNames.some(n => i.message.startsWith(`'${n}'`))
  );

test('a sample project uses no runtime name', () => {
  assert.deepEqual(runtimeNameUses(s4sample()), []);
});

test('a shared runtime event typed as an event name warns on its start card, ignoring case', () => {
  const w = s4sample();
  Object.assign(w.starts[0], {mode: 'event', key: '', event: 'ai_pairenterlead'});
  const found = warnings(w).filter(i => i.node === w.starts[0].uid);
  assert.equal(found.length, 1);
  assert.ok(found[0].message.includes("'AI_PairEnterLead'") && found[0].message.includes('공용 이벤트'));
  assert.ok(compileWorkspace(w), 'a warning never blocks the output');
});

test('every field is read: links, cancel lists, project events and globals', () => {
  const w = s4sample();
  w.links[0].event = 'AI_FullBodyEnter';
  w.eventRegistry = [{id: 'event1', name: 'AI_PairEnterSupport', functions: []}];
  w.globals.cameraReset = 'AI_FullBodyLinkEnter';
  w.actions[1].config.cancel = [{to: 'vanilla:Attack, event:AI_PairEnterLead'}];
  const nodes = runtimeNameUses(w).map(i => i.node);
  assert.ok(nodes.includes(w.links[0].id));
  assert.ok(nodes.includes('project'));
  assert.ok(nodes.includes('globals'));
  assert.ok(nodes.includes('a2'), 'event: entries of a comma list');
});

test('fixed variable and state names get the milder message; near names pass', () => {
  const w = s4sample();
  w.links[0].event = 'iAI_PairState';
  const [only] = runtimeNameUses(w);
  assert.ok(only.message.includes('고정 이름') && !only.message.includes('공용 이벤트'));
  w.links[0].event = 'AI_PairEnterLeadX';
  assert.deepEqual(runtimeNameUses(w), []);
});

test('one warning per name and place', () => {
  const w = s4sample();
  w.actions[0].config.events = ['AI_PairEnterLead', 'AI_PAIRENTERLEAD'];
  assert.equal(runtimeNameUses(w).length, 1);
  assert.equal(runtimeEventNames.length, 4);
  assert.equal(new Set(runtimeFixedNames.map(n => n.toLowerCase())).size, 16);
});

test('the lists match the runtime headers', needsRuntimeSource, () => {
  const core = `${runtimeSource}/src/core/`;
  const constants = ['FullBodyEntryNames.h', 'PairEntryNames.h'].flatMap(f => [
    ...readFileSync(core + f, 'utf8').matchAll(/constexpr const char\* (\w+) = "([^"]+)"/g),
  ]);
  const blends = [...readFileSync(core + 'GraphInjector.cpp', 'utf8').matchAll(/"(AI_FullBody\w*Blend)"/g)].map(
    m => m[1]
  );
  assert.deepEqual(
    [...runtimeEventNames].sort(),
    constants
      .filter(m => /Event$/.test(m[1]))
      .map(m => m[2])
      .sort()
  );
  assert.deepEqual([...runtimeFixedNames].sort(), [...new Set([...constants.map(m => m[2]), ...blends])].sort());
});
