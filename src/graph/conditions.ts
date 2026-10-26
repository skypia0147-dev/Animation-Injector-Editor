import type {ExtensionKind, Comparison} from './conditionExtensions.ts';
import {equippedTypes, attackStates} from '../runtimeExtensions.ts';
// A condition's settings (a condition card's check or AND/OR group, cards.ts CardTest).
/** Room and ground checks turn from the actor's own heading on its start mark (self*, runtime 0.12.280); partner* is
 *  the older form, still read and written as it was until changed (docs/mockup-space-sentence). */
/** A room or ground check's direction, from the actor's current heading (runtime 0.12.299). */
export type SpaceDirection = (typeof selfDirections)[number];
export const selfDirections = ['selfForward', 'selfBack', 'selfLeft', 'selfRight'] as const;
export type BranchTest = {
  id: string;
  label?: string;
  enabled?: boolean;
  negate?: boolean;
  option?: string;
  compare?: Comparison;
  measure?: 'current' | 'percent' | 'base';
  /** previousAction (runtime 0.12.296): the actions (uids), the seconds since it ended (absent = any time) and how. */
  actions?: string[];
  within?: number;
  ended?: 'any' | 'completed' | 'cancelled';
  value?: number;
  upper?: number;
  kind:
    | ExtensionKind
    | 'all'
    | 'any'
    | 'not'
    | 'air'
    | 'weaponDrawn'
    | 'combat'
    | 'alive'
    | 'stamina'
    | 'magicka'
    | 'space'
    | 'ground'
    | 'magicEffect'
    | 'global'
    | 'equippedType'
    | 'attackState'
    | 'sneaking'
    | 'female';
  hand?: 'left' | 'right';
  equipmentType?: (typeof equippedTypes)[number];
  attackState?: (typeof attackStates)[number];
  operands?: string[];
  subject: 'self' | 'partner';
  minimum: number;
  form?: {plugin: string; id: string};
  equals?: number;
  space?: {distance: number; direction: SpaceDirection};
  ground?: {maxRise: number; maxDrop: number; maxSlope: number; radius: number};
};
