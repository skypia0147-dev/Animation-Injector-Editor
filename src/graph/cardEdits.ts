import type {Action, Workspace, Link} from '../workspace.ts';
import {uid} from '../workspace.ts';
import {mark} from '../model.ts';
import {tr} from '../i18n/korean.ts';
import {graphPosition} from './projection.ts';
import {rootGraph} from './state.ts';
import {vanillaCardId} from './vanilla.ts';
import type {StartCard} from '../cards.ts';
import type {GameControl} from '../keys.ts';
import {addTransition, deleteFlat, dropBinding, readsKey} from './flat.ts';
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
      n.links.some(x => x !== link && x.from === a.uid && readsKey(x) && x.input === i!.id) ||
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

// A vanilla transition and a transition card switched into each other (11-01, A7).
type Cancel = Action['cancels'][number];
/** A vanilla transition switched to another input: the same window on a transition card of that mode. */
export function cancelToLink(w: Workspace, action: string, id: string, mode: Link['mode']): Workspace {
  const a = w.actions.find(a => a.uid === action),
    c = a?.cancels.find(c => c.id === id);
  if (!a || !c) return w;
  const at = graphPosition(w, rootGraph, vanillaCardId(action, id), {x: a.position.x + 420, y: a.position.y + 90});
  const made = addTransition(
    deleteFlat(w, vanillaCardId(action, id)),
    action,
    null,
    at,
    mode === 'input' ? 'input' : 'event'
  );
  const linkId = made.id.slice('transition:'.length);
  let next = mode === 'input' || mode === 'event' ? made.workspace : setLinkMode(made.workspace, linkId, mode);
  if (mode !== 'end')
    next = {
      ...next,
      links: next.links.map(l =>
        l.id === linkId ? {...l, window: !c.always, open: c.open, close: c.close, buffered: c.buffered} : l
      ),
    };
  return next;
}
/** A transition card switched to 「바닐라 동작」: its window becomes the vanilla transition's (an ordinary action's). */
export function linkToCancel(w: Workspace, link: string): Workspace {
  const l = w.links.find(l => l.id === link),
    a = l && w.actions.find(a => a.uid === l.from);
  if (!l || !a) return w;
  if (a.pair) throw Error(tr('페어의 종료/전환 기능을 사용하세요.'));
  const next = deleteFlat(w, 'transition:' + link);
  const id = uid(
    'cancel',
    a.cancels.map(c => c.id)
  );
  const c: Cancel = {
    id,
    to: 'vanilla:Attack',
    open: l.window ? l.open : mark(0),
    close: l.window ? l.close : mark(0, 'end'),
    buffered: l.buffered,
    blend: null,
    ...(l.window ? {} : {always: true as const}),
  };
  return {...next, actions: next.actions.map(x => (x.uid === a.uid ? {...x, cancels: [...x.cancels, c]} : x))};
}
