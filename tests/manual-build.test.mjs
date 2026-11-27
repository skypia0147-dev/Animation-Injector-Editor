import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileWorkspace} from '../src/workspace.ts';
import {importWorkspaceXml} from '../src/importXml.ts';
import {cardIssues} from '../src/cardChecks.ts';
import {cardTitle} from '../src/cards.ts';

// What rebuilding the MCO add-on by hand in the editor needed (11-27): a window closing on an event written from the
// model (not only kept from an imported file), and condition cards named, told apart and shared under their name.
const SRC = `<?xml version="1.0" encoding="utf-8"?>
<AnimationSet version="6" id="ManualBuild">
  <Start event="attackStart" block="attackStart" to="Attack1"/>
  <Action id="Attack1" clip="Animations\\MCO_attack1.hkx" attack="attackStart">
    <Transition condition="NextPower" event="attackPowerStartInPlace" from="0.2" until="1.5"/>
    <Transition condition="NextPower" on="npc" from="0.2" until="1.5" cooldown="4"/>
  </Action>
  <Action id="Power1" clip="Animations\\MCO_powerattack1.hkx" attack="attackPowerStartInPlace"/>
  <Condition id="NextPower">
    <Row to="Power1"><Check kind="graphVariable" variable="MCO_nextpowerattack" type="int" compare="eq" value="1"/></Row>
    <False to="Power1"/>
  </Condition>
</AnimationSet>
`;

test('a window can close on an event: the model writes until="event:…" and keeps a clip-time open', () => {
  const w = importWorkspaceXml(SRC);
  const link = w.links.find(l => l.event === 'attackPowerStartInPlace');
  // What 「닫힘 · 이벤트」 sets (ClipWindowFields): the close side alone becomes an event.
  link.close = {...link.close, basis: 'event', event: 'MCO_PowerWinClose', fallback: false};
  const xml = compileWorkspace(w);
  assert.match(xml, /event="attackPowerStartInPlace" from="0.2" until="event:MCO_PowerWinClose"/);
});

test('a named condition card: its title and list label are its name, and it is shared under it', () => {
  const w = importWorkspaceXml(SRC);
  const card = w.cards.find(c => c.xmlId === 'NextPower');
  assert.ok(card, 'the shared card keeps its id as its name');
  assert.equal(
    cardTitle(card, () => 'graph variable'),
    '조건 · NextPower'
  );
  const renamed = {...w, cards: w.cards.map(c => (c === card ? {...c, xmlId: 'NextPowerHit'} : c))};
  const xml = compileWorkspace(renamed);
  assert.match(xml, /<Condition id="NextPowerHit">/);
  assert.equal((xml.match(/condition="NextPowerHit"/g) ?? []).length, 2);
});

test('two condition cards with one name are refused', () => {
  const w = importWorkspaceXml(SRC);
  const copy = {...structuredClone(w.cards[0]), uid: 'card99', xmlId: 'nextpower'};
  const issues = cardIssues({...w, cards: [...w.cards, copy]}).filter(i => i.level === 'error');
  assert.ok(
    issues.some(i => i.message.includes('nextpower')),
    JSON.stringify(issues)
  );
});

test("an action's block has no timing to choose: one saved with none compiles, written as the runtime reads it", () => {
  const w = importWorkspaceXml(SRC);
  const a = w.actions.find(x => x.config.actionId === 'Power1');
  // A block added before 11-27 kept an empty timing, which stopped the project compiling.
  a.config.suppress = {events: ['attackStart', 'attackPowerStartInPlace'], when: ''};
  const xml = compileWorkspace(w);
  assert.match(xml, /<Action id="Power1" [^>]*block="attackStart,attackPowerStartInPlace"/);
  assert.doesNotMatch(xml, /<Action [^>]*blockWhen/);
});
