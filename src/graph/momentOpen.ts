import type {Workspace} from '../workspace.ts';
import {eventKey} from '../eventRegistry.ts';

// A switch from the clip to an event makes another item: a clip-time function and a registered one are separate
// rows. The item made by a switch opens
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
/** Runs a switch to an event and opens the registered function it made there. */
export function switchTo(action: string, made: {event: string}) {
  return (next: Workspace) => {
    const fn = lastFn(next, made.event);
    if (fn) openAfterSwitch(`${action}|${registryKey(made.event, fn)}`);
    return next;
  };
}
