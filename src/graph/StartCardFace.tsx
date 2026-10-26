import type {ReactNode} from 'react';
import type {Workspace} from '../workspace.ts';
import {useStartSettings, useTransitionSettings} from './CardDetails.tsx';
import {SettingRows, useSettings} from './cardSettings.tsx';

type Edit = (f: (w: Workspace) => Workspace) => void;

// Start and transition cards edited on the card (docs/mockup unify ⑨, 10-27): a box per setting in use, the routes
// under them, 「＋ 설정」 for the rest.
export function StartFace({w, uid, edit, routes}: {w: Workspace; uid: string; edit: Edit; routes: ReactNode}) {
  return <SettingRows settings={useSettings(useStartSettings(w, uid, edit))} after={routes} />;
}
export function TransitionFace({w, id, edit, routes}: {w: Workspace; id: string; edit: Edit; routes: ReactNode}) {
  return <SettingRows settings={useSettings(useTransitionSettings(w, id, edit))} after={routes} />;
}
