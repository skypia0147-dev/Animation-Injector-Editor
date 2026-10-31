import type {Workspace, Link} from '../workspace.ts';
import type {StartCard} from '../cards.ts';
import type {GameControl} from '../keys.ts';
import {dropBinding} from './flat.ts';
import {sourceWindow} from './clipWindows.ts';

// What the start and transition cards' settings change (unify ⑨, CardDetails.tsx), as plain edits of the document:
// the cards call these, and tests/card-xml.test.mjs writes their XML.

export const patchStart = (w: Workspace, uid: string, patch: Partial<StartCard>): Workspace => ({
  ...w,
  starts: w.starts.map(x => (x.uid === uid ? {...x, ...patch} : x)),
});
/** A start's trigger switched between a key and an event. */
export const startMode = (s: StartCard, mode: StartCard['mode']): Partial<StartCard> =>
  mode === 'event'
    ? {mode: 'event', key: '', gamepad: 0, press: 'down'}
    : {mode: 'input', event: '', actor: 'both', target: 'nearest', key: s.key || 'Num0'};
/** A start's setting back to its default (「기본값으로」): it leaves the card. */
export const startDefaults = {
  actor: {actor: 'both'},
  partner: {target: 'nearest'},
  target: {target: 'nearest', range: undefined, angle: undefined},
  cooldown: {cooldown: 0},
  block: {block: undefined},
} satisfies Record<string, Partial<StartCard>>;

export const patchLink = (w: Workspace, id: string, patch: Partial<Link>): Workspace => ({
  ...w,
  links: w.links.map(x => (x.id === id ? {...x, ...patch} : x)),
});
/** A transition's blend: added at 0.3 s, back to the destination HKX's start blend when reset. */
export const linkBlend = {add: {blend: 0.3}, reset: {blend: undefined}} satisfies Record<string, Partial<Link>>;
/** A transition's trigger switched: a key's press, an event, the HKX's end or a key let go (charge). Leaving a key
 *  drops its binding; a release starts on the key that started the action, an end has no window. */
export function setLinkMode(w: Workspace, id: string, mode: Link['mode']): Workspace {
  const l = w.links.find(l => l.id === id);
  if (!l) return w;
  if (mode === 'input') return patchLink(w, id, {mode: 'input', event: '', window: true});
  return dropBinding(
    {
      ...w,
      links: w.links.map(x =>
        x.id === id
          ? {...x, mode, input: '', event: mode === 'event' ? x.event : '', window: mode === 'end' ? false : x.window}
          : x
      ),
    },
    l.from,
    l.input
  );
}
/** A release transition's key: the key that started the action (none of its own), or one of its own. */
export function setReleaseKey(w: Workspace, id: string, own: boolean): Workspace {
  const l = w.links.find(l => l.id === id);
  if (!l) return w;
  if (own) return setLinkKey(w, id, 'E', 0);
  return dropBinding(patchLink(w, id, {input: ''}), l.from, l.input);
}
/** A transition's key: it lives in the source HKX's inputs (written in place in the XML). */
export function setLinkKey(w: Workspace, id: string, key: string, gamepad: number, control?: GameControl): Workspace {
  const n = structuredClone(w),
    link = n.links.find(x => x.id === id),
    a = link && n.actions.find(a => a.uid === link.from);
  if (!link || !a) return w;
  let i = a.config.inputs.find(i => i.id === link.input);
  // A binding something else also uses (another transition with the same key, a carry, a shared input): this
  // transition gets its own instead of changing theirs.
  const others = i
    ? n.sharedInputs.some(s => s.id === i!.id) ||
      n.links.some(x => x !== link && x.from === a.uid && x.mode === 'input' && x.input === i!.id) ||
      a.pair?.carry?.input === i.id
    : false;
  if (!i || others) {
    let k = 1;
    while (a.config.inputs.some(i => i.id === 'binding' + k)) k++;
    i = {id: 'binding' + k, label: 'binding' + k, key: '', gamepad: 0};
    a.config.inputs.push(i);
    link.input = i.id;
  }
  i.key = key;
  i.gamepad = gamepad;
  if (control) i.control = control;
  else delete i.control;
  return n;
}
/** A transition's detection window: the source HKX's (shared) or its own, starting as a copy of that. */
export function setLinkWindowScope(w: Workspace, id: string, own: boolean): Workspace {
  const l = w.links.find(l => l.id === id),
    from = l && w.actions.find(a => a.uid === l.from);
  if (!l || !from) return w;
  return {
    ...w,
    links: w.links.map(x => {
      if (x.id !== id) return x;
      const {ownWindow, ...rest} = x;
      return own
        ? {...rest, ownWindow: true, window: true, ...structuredClone(sourceWindow(from, from.config.entry).value)}
        : rest;
    }),
  };
}
