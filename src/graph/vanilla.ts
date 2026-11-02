import {tr} from '../i18n/korean.ts';

// A vanilla transition (runtime <Vanilla to>, 11-01, docs/mockup-moment-effects ④): its targets as the card names
// them. The card is graph/vanillaTransition.tsx; switching it to and from a transition card, cardEdits.ts.

/** The runtime's aliases (XmlV2 VanillaMatch) as a card chooses them. 공격 holds the power attack too. */
export const vanillaChoices = (): [string, string][] => [
  ['Attack', tr('공격')],
  ['PowerAttack', tr('강공격만')],
  ['Block', tr('방어')],
  ['Bash', tr('밀치기')],
  ['Sprint', tr('질주')],
  ['Jump', tr('점프')],
  ['Sneak', tr('은신')],
];
/** `to` as stored ("vanilla:Attack,event:Name"): the aliases chosen and the graph events written by hand. */
/** A comma list's items, trimmed, the empty ones left out. */
export const listItems = (text: string) =>
  text
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
export function vanillaTargets(to: string) {
  const items = listItems(to);
  return {
    aliases: items.filter(s => s.startsWith('vanilla:')).map(s => s.slice(8)),
    events: items.filter(s => s.startsWith('event:')).map(s => s.slice(6)),
  };
}
export const joinTargets = (aliases: string[], events: string[]) =>
  [...aliases.map(a => 'vanilla:' + a), ...events.map(e => 'event:' + e)].join(',');
/** What it waits for, as the card's title and chips name it. */
export function vanillaNames(to: string): string[] {
  const {aliases, events} = vanillaTargets(to),
    names = vanillaChoices();
  return [...aliases.map(a => names.find(([k]) => k === a)?.[1] ?? a), ...events];
}
export const vanillaCardId = (action: string, cancel: string) => `notify:${action}|cancel:${cancel}`;
