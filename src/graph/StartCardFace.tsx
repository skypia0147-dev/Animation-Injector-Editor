import type {ReactNode} from 'react';
import type {Workspace} from '../workspace.ts';
import {useStartSettings, useTransitionSettings} from './CardDetails.tsx';
import {SettingRows, useSettings} from './cardSettings.tsx';

type Edit = (f: (w: Workspace) => Workspace) => void;

// Start and transition cards edited on the card (docs/mockup unify ⑨, 10-27): a box per setting in use, the routes
// under them, 「＋ 설정」 for the rest.
// `fold`: the card is left in the summary view, and its open setting closes (as a condition card's parts fold).
type Face = {w: Workspace; edit: Edit; routes: ReactNode; fold?: boolean};
export function StartFace({w, uid, edit, routes, fold}: Face & {uid: string}) {
  return <SettingRows settings={useSettings(useStartSettings(w, uid, edit), fold)} after={routes} />;
}
export function TransitionFace({w, id, edit, routes, fold}: Face & {id: string}) {
  return <SettingRows settings={useSettings(useTransitionSettings(w, id, edit), fold)} after={routes} />;
}
