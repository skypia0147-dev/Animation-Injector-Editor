import {mark} from '../model.ts';
import type {Mark} from '../model.ts';
import type {Action} from '../workspace.ts';

export type ClipWindow = {open: Mark; close: Mark; buffered: boolean};
/** The detection window an ordinary HKX's key transitions share (sourceLinks): its own, else the editor's
 *  starting window for a new key transition. */
export function sourceWindow(a: Action, step: string) {
  return {value: a.clipWindows?.[step] ?? {open: mark(0.45), close: mark(0, 'end'), buffered: true}};
}
export function setSourceWindow(a: Action, step: string, value: ClipWindow): Action {
  return {...a, clipWindows: {...a.clipWindows, [step]: structuredClone(value)}};
}
