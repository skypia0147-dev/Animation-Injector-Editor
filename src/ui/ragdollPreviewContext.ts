import {createContext} from 'react';

/** The carry ragdoll simulation shown in the 3D view (viewport/RagdollView): which lift action it shows and the body
 *  selected in it, shared by the card's ragdoll group and the view (selecting in one selects in the other). */
export type RagdollPreviewState = {
  /** The lift action's uid, or null when the 3D view shows the animation. */
  active: string | null;
  selected: string;
  /** Counts the selections made in the 3D view: the card brings that body's row to the middle of the canvas. */
  reveal: number;
  toggle: (uid: string) => void;
  /** `fromView`: picked in the 3D view (the card then shows the row). */
  select: (bone: string, fromView?: boolean) => void;
};
export const RagdollPreviewContext = createContext<RagdollPreviewState>({
  active: null,
  selected: '',
  reveal: 0,
  toggle: () => {},
  select: () => {},
});
