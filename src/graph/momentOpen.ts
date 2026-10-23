import type {Workspace} from '../workspace.ts';
import {clipEffects} from '../clipEffects.ts';
import {eventKey} from '../eventRegistry.ts';

// A switch between the clip and an event (or to another event) makes another item: a clip-time function and a
// registered one are separate rows, and a moved registered function gets a new id. The item made by a switch opens
// where the user was, as the 활 발사 item (one item both ways) stays open. Keys: `${action}|${notify id}` for an
// action's item, `${action}|${registry moment key}` for a registered one. A key is kept briefly, not taken, so a
// render that runs twice (development) opens it too.
const switched = new Map<string, number>();
export const openAfterSwitch = (key: string) => switched.set(key, Date.now());
export const openedBySwitch = (key: string) => {
  const at = switched.get(key);
  return at !== undefined && Date.now() - at < 2000;
};
export const registryKey = (event: string, fn: string) => `reg:${eventKey(event)}:${fn}`;
/** The id of the function `event` got last (the one a switch just added). */
const lastFn = (w: Workspace, event: string) =>
  w.eventRegistry?.find(r => eventKey(r.name) === eventKey(event))?.functions.at(-1)?.id;
/** Runs a switch and opens what it made on `event` (a registered function) or as `notify` (the action's item). */
export function switchTo(action: string, made: {event: string} | {notify: (w: Workspace) => string | undefined}) {
  return (next: Workspace) => {
    if ('event' in made) {
      const fn = lastFn(next, made.event);
      if (fn) openAfterSwitch(`${action}|${registryKey(made.event, fn)}`);
    } else {
      const id = made.notify(next);
      if (id) openAfterSwitch(`${action}|${id}`);
    }
    return next;
  };
}
export const lastEffect = (action: string) => (w: Workspace) => {
  const a = w.actions.find(x => x.uid === action);
  const e = a ? clipEffects(a).at(-1) : undefined;
  return e && 'effect:' + e.id;
};
