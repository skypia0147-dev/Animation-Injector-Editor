// Format 4 (runtime 0.12.233): combos removed (an action is one HKX; Connect joins them), keys written where
// they are used (key=, gamepad= by name), an omitted Window is the whole clip, and attributes equal to the
// runtime's omitted value are not written. Format 3's global event registry stays.
export const XML_FORMAT_VERSION = 4;
// The runtime the editor writes for: format 4 grew features after 0.12.233 (action camera 0.12.260, QTE input owner
// 0.12.263, event QTE partner results 0.12.264, hidden QTE 0.12.266, actorType player 0.12.267), and an older runtime skips a file that uses one.
// Keep this equal to the version of the bundled AnimationInjectorXmlCheck, which is what saving validates against.
export const MINIMUM_RUNTIME_VERSION = '0.12.267';
