import {tr} from './i18n/korean.ts';
// Runtime key names from AnimationInjector 0.12.0 Settings.cpp.
export const keyCodes: Record<string, number> = {
  Esc: 1,
  '1': 2,
  '2': 3,
  '3': 4,
  '4': 5,
  '5': 6,
  '6': 7,
  '7': 8,
  '8': 9,
  '9': 10,
  '0': 11,
  Minus: 12,
  Equals: 13,
  Backspace: 14,
  Tab: 15,
  Q: 16,
  W: 17,
  E: 18,
  R: 19,
  T: 20,
  Y: 21,
  U: 22,
  I: 23,
  O: 24,
  P: 25,
  LBracket: 26,
  RBracket: 27,
  Enter: 28,
  LCtrl: 29,
  A: 30,
  S: 31,
  D: 32,
  F: 33,
  G: 34,
  H: 35,
  J: 36,
  K: 37,
  L: 38,
  Semicolon: 39,
  Apostrophe: 40,
  Grave: 41,
  LShift: 42,
  Backslash: 43,
  Z: 44,
  X: 45,
  C: 46,
  V: 47,
  B: 48,
  N: 49,
  M: 50,
  Comma: 51,
  Period: 52,
  Slash: 53,
  RShift: 54,
  NumMul: 55,
  LAlt: 56,
  Space: 57,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  NumLock: 69,
  ScrollLock: 70,
  Num7: 71,
  Num8: 72,
  Num9: 73,
  NumMinus: 74,
  Num4: 75,
  Num5: 76,
  Num6: 77,
  NumPlus: 78,
  Num1: 79,
  Num2: 80,
  Num3: 81,
  Num0: 82,
  NumDot: 83,
  F11: 87,
  F12: 88,
  NumEnter: 156,
  RCtrl: 157,
  NumDiv: 181,
  RAlt: 184,
  Home: 199,
  Up: 200,
  PageUp: 201,
  Left: 203,
  Right: 205,
  End: 207,
  Down: 208,
  PageDown: 209,
  Insert: 210,
  Delete: 211,
  Mouse1: 256,
  Mouse2: 257,
  Mouse3: 258,
  Mouse4: 259,
  Mouse5: 260,
  Mouse6: 261,
  Mouse7: 262,
  MouseWheelUp: 264,
  MouseWheelDown: 265,
};
/** Gamepad buttons by their XML name (format 4, runtime XmlV2 kGamepadButtons): the engine's codes. A button
 *  without a name is written code:<number>. */
export const gamepadNames: Record<string, number> = {
  A: 4096,
  B: 8192,
  X: 16384,
  Y: 32768,
  LB: 256,
  RB: 512,
  LT: 9,
  RT: 10,
  Start: 16,
  Back: 32,
  LS: 64,
  RS: 128,
  Up: 1,
  Down: 2,
  Left: 4,
  Right: 8,
};
/** A gamepad code as the XML writes it: its name, else code:<number>. */
export const gamepadXml = (code: number) =>
  Object.keys(gamepadNames).find(name => gamepadNames[name] === code) ?? 'code:' + code;
/** A gamepad attribute's code: a name (any case) or code:<1..65535>. A bare number is refused like the runtime. */
export function gamepadFromXml(text: string, where = 'gamepad'): number {
  const name = Object.keys(gamepadNames).find(n => n.toLowerCase() === text.toLowerCase());
  if (name) return gamepadNames[name];
  const m = /^code:(\d{1,5})$/.exec(text);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 65535) return Number(m[1]);
  throw new Error(
    tr(
      '{where}: 알 수 없는 패드 버튼 {text} (A B X Y LB RB LT RT LS RS Start Back Up Down Left Right 또는 code:숫자)',
      {where, text}
    )
  );
}
/** Game controls (runtime 0.12.292, GameControls.h): an input given by what the game calls it, control="jump".
 *  The game maps it to the player's keyboard, mouse and gamepad bindings, so one choice covers every device and
 *  follows remapping. In the runtime's order; the label is the game's own name for it. */
export const gameControls = [
  'jump',
  'sprint',
  'sneak',
  'activate',
  'readyWeapon',
  'shout',
  'rightAttack',
  'leftAttack',
  'togglePOV',
  'run',
  'toggleRun',
  'autoMove',
  'wait',
  'favorites',
  'tweenMenu',
] as const;
export type GameControl = (typeof gameControls)[number];
export const isGameControl = (text: string | undefined): text is GameControl =>
  !!text && (gameControls as readonly string[]).includes(text);
export const gameControlLabel = (control: GameControl): string =>
  ({
    jump: tr('점프'),
    sprint: tr('질주'),
    sneak: tr('웅크리기'),
    activate: tr('상호작용'),
    readyWeapon: tr('무기 꺼내기·넣기'),
    shout: tr('외침·능력'),
    rightAttack: tr('오른손 공격'),
    leftAttack: tr('왼손 공격·막기'),
    togglePOV: tr('시점 전환'),
    run: tr('걷기·뛰기'),
    toggleRun: tr('항상 달리기 전환'),
    autoMove: tr('자동 이동'),
    wait: tr('기다리기'),
    favorites: tr('즐겨찾기'),
    tweenMenu: tr('메뉴'),
  })[control];
/** A control attribute's value: one of gameControls (exact case, like the runtime). */
export function gameControlFromXml(text: string, where = 'control'): GameControl {
  if (isGameControl(text)) return text;
  throw new Error(tr('{where}: 알 수 없는 게임 동작 {text} ({names})', {where, text, names: gameControls.join(' ')}));
}
/** The game's default bindings for each control (keyboard/mouse key name, gamepad button name; '' = none), for the
 *  editor's QTE preview only: in the game the player's own bindings are used. */
export const gameControlDefaults: Record<GameControl, {key: string; pad: string}> = {
  jump: {key: 'Space', pad: 'Y'},
  sprint: {key: 'LAlt', pad: 'LB'},
  sneak: {key: 'LCtrl', pad: 'LS'},
  activate: {key: 'E', pad: 'A'},
  readyWeapon: {key: 'R', pad: 'X'},
  shout: {key: 'Z', pad: 'RB'},
  rightAttack: {key: 'Mouse1', pad: 'RT'},
  leftAttack: {key: 'Mouse2', pad: 'LT'},
  togglePOV: {key: 'F', pad: 'RS'},
  run: {key: 'LShift', pad: ''},
  toggleRun: {key: 'CapsLock', pad: ''},
  autoMove: {key: 'C', pad: ''},
  wait: {key: 'T', pad: 'Back'},
  favorites: {key: 'Q', pad: 'Up'},
  tweenMenu: {key: 'Tab', pad: 'B'},
};
