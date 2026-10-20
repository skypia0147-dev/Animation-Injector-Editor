import {keyCode} from '../../model.ts';
const aliases: Record<string, string> = {
  AltLeft: 'LAlt',
  AltRight: 'RAlt',
  ControlLeft: 'LCtrl',
  ControlRight: 'RCtrl',
  ShiftLeft: 'LShift',
  ShiftRight: 'RShift',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'NumPlus',
  NumpadSubtract: 'NumMinus',
  NumpadMultiply: 'NumMul',
  NumpadDivide: 'NumDiv',
  NumpadDecimal: 'NumDot',
  NumpadEnter: 'NumEnter',
  Backquote: 'Grave',
  Minus: 'Minus',
  Equal: 'Equals',
  BracketLeft: 'LBracket',
  BracketRight: 'RBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Apostrophe',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
};
// KeyboardEvent.code identifies the physical position independently of IME text.
export function capturedKey(code: string): string | undefined {
  const candidate = /^Key[A-Z]$/.test(code)
    ? code.slice(3)
    : /^Digit[0-9]$/.test(code)
      ? code.slice(5)
      : /^Numpad[0-9]$/.test(code)
        ? 'Num' + code.slice(6)
        : (aliases[code] ?? code);
  return keyCode(candidate) ? candidate : undefined;
}
