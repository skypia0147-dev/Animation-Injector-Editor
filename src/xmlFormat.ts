// Format 6 (runtime 0.12.291, docs/설계-형식6-에디터.md): starts at the root go to an HKX or through a condition card
// (common conditions, rows, True, False); a card more than one place goes to is a root <Condition id>. Element and
// attribute names follow the editor's (Transition, Vanilla, MoveCancel, FindPartner; air, attack, enter, block, …).
export const XML_FORMAT_VERSION = 6;
// The runtime the editor writes for: the runtime reads format 6 only from 0.12.291, game controls (control=) from
// 0.12.292. Keep this equal to the version of the bundled AnimationInjectorXmlCheck, which is what saving validates
// against.
export const MINIMUM_RUNTIME_VERSION = '0.12.296';
