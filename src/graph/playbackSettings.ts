import type {Action, Workspace} from '../workspace.ts';
import {putAction} from '../workspace.ts';
import {createProject} from '../model.ts';
import {offersOtherView, otherViewStart, fixedThird} from '../view.ts';
import {sharesSourceWindow} from './playback.ts';

// An HKX card's playback settings (unify ⑩, ChecklistCard.tsx): which differ from their default (a chip on the card)
// and how each goes back to it. tests/card-xml.test.mjs writes their XML.

export type PlaybackSetting = 'kind' | 'view' | 'otherView' | 'air' | 'detection' | 'exit' | 'attack';
/** Each setting: whether it applies to this action and whether it is set (not its default). */
export function playbackState(w: Workspace, a: Action, step: string) {
  const p = a.config,
    fixed = fixedThird(w, a);
  return {
    kind: {applies: true, set: !!a.pair},
    view: {applies: !fixed, set: a.view !== undefined},
    otherView: {applies: offersOtherView(w, a), set: otherViewStart(w, a) !== 'block'},
    // Where it may start (11-01: a playback setting, no longer a 「+ 기능」 item): the ground only is the default.
    air: {applies: true, set: p.air !== 'deny'},
    // The detection window is what the key transitions out of this HKX read when they share it (sourceLinks): with none
    // reading it, it changes nothing in the XML and is not offered.
    detection: {
      applies: !a.pair && w.links.some(l => l.from === a.uid && sharesSourceWindow(w, l) && !l.ownWindow),
      set: !!a.clipWindows?.[step],
    },
    exit: {applies: true, set: JSON.stringify(p.exit) !== JSON.stringify(createProject().exit)},
    attack: {applies: true, set: !!(p.attack || p.steps.some(s => s.attack))},
  } satisfies Record<PlaybackSetting, {applies: boolean; set: boolean}>;
}
const edited = (w: Workspace, uid: string, f: (a: Action) => Action) => {
  const a = w.actions.find(a => a.uid === uid);
  return a ? putAction(w, f(a)) : w;
};
/** The detection window back to the default (the clip's own window dropped). */
export const resetDetection = (w: Workspace, uid: string, step: string) =>
  edited(w, uid, a => {
    const {[step]: _, ...rest} = a.clipWindows ?? {};
    return {...a, clipWindows: rest};
  });
/** On the ground only, the default. */
export const resetAir = (w: Workspace, uid: string) =>
  edited(w, uid, a => ({...a, config: {...a.config, air: 'deny'}}));
/** The end back to the clip's end. */
export const resetExit = (w: Workspace, uid: string) =>
  edited(w, uid, a => ({...a, config: {...a.config, exit: structuredClone(createProject().exit)}}));
/** No attack data, the action's or a clip's. */
export const resetAttack = (w: Workspace, uid: string) =>
  edited(w, uid, a => ({
    ...a,
    config: {...a.config, attack: '', steps: a.config.steps.map(s => ({...s, attack: ''}))},
  }));
