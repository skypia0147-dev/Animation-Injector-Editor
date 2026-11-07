import type {ExtensionKind, Comparison} from './conditionExtensions.ts';
// A condition's settings (a condition card's check or AND/OR group, cards.ts CardTest).
/** Room and ground checks turn from the actor's own heading on its start mark (self*, runtime 0.12.280); partner* is
 *  the older form, still read and written as it was until changed (docs/mockup-space-sentence). */
/** A room or ground check's direction, from the actor's current heading (runtime 0.12.299). */
export type SpaceDirection = (typeof selfDirections)[number];
export const selfDirections = ['selfForward', 'selfBack', 'selfLeft', 'selfRight'] as const;
export type GroundLimits = {maxRise: number; maxDrop: number; maxSlope: number; radius: number};
/** What the runtime uses for a ground limit the condition leaves out. */
export const groundDefaults: GroundLimits = {maxRise: 20, maxDrop: 40, maxSlope: 45, radius: 20};
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
  /** recentEvent (runtime 1.0.3): the animation event names; `within` is then the seconds since one arrived. */
  events?: string[];
  within?: number;
  ended?: 'any' | 'completed' | 'cancelled';
  value?: number;
  upper?: number;
  kind:
    | ExtensionKind
    | 'all'
    | 'any'
    | 'not'
    | 'alive'
    | 'space'
    | 'ground'
    | 'magicEffect'
    | 'global'
    | 'equippedType'
    | 'attackState'
    | 'female'
    /** Not chosen yet: a new condition starts here (11-02, no default kind). */
    | '';
  hand?: 'left' | 'right';
  /** Comma lists: any of them holds (runtime 0.12.301, graph/multiValue.ts). */
  equipmentType?: string;
  attackState?: string;
  operands?: string[];
  /** '' until chosen (11-02); kinds without a target keep 'self'. */
  subject: 'self' | 'partner' | '';
  form?: {plugin: string; id: string};
  /** A keyword check named by its editor ID (runtime keyword=) instead of `form`; undefined: by plugin and form. */
  keyword?: string;
  equals?: number;
  /** Both chosen by the user (11-02: a new check starts without them). */
  space?: {distance?: number; direction?: SpaceDirection};
  /** Each left out uses the runtime's own (groundDefaults). */
  ground?: Partial<GroundLimits>;
};
