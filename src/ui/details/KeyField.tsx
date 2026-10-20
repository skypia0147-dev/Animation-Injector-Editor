import {useEffect, useId, useState} from 'react';
import {keys} from '../../model.ts';
import {t} from '../../i18n/index.ts';
import {capturedKey} from './keyCapture.ts';
import {tr} from '../../i18n/korean.ts';
export const gamepadButtons = [
  ['—', 0],
  ['A', 4096],
  ['B', 8192],
  ['X', 16384],
  ['Y', 32768],
  ['LB', 256],
  ['RB', 512],
  ['LT', 9],
  ['RT', 10],
  ['Start', 16],
  ['Back', 32],
  ['LS', 64],
  ['RS', 128],
  ['↑', 1],
  ['↓', 2],
  ['←', 4],
  ['→', 8],
] as const;
export function KeyField({
  value,
  change,
  gamepad,
  changeGamepad,
  labeled = false,
}: {
  value: string;
  change: (s: string) => void;
  gamepad: number;
  changeGamepad: (n: number) => void;
  labeled?: boolean;
}) {
  const [capture, setCapture] = useState(false),
    [message, setMessage] = useState('');
  const id = useId();
  const [custom, setCustom] = useState(false);
  const showCode = custom || !gamepadButtons.some(([, v]) => v === gamepad);
  useEffect(() => {
    if (!capture) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        setCapture(false);
        return;
      }
      const next = capturedKey(e.code);
      if (next) {
        change(next);
        setCapture(false);
        setMessage('');
      } else setMessage(t('detail.unsupportedKey'));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [capture, change]);
  return (
    <div className="key-field">
      {labeled && <span>{tr('키보드·마우스')}</span>}
      <div className="key-main">
        <input aria-label={t('node.keyInput')} list={id} value={value} onChange={e => change(e.target.value)} />
        <datalist id={id}>
          {keys.map(k => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <button aria-pressed={capture} onClick={() => setCapture(!capture)} title={t('detail.captureHint')}>
          ⌨ {t(capture ? 'detail.capture' : 'row.pressKey')}
        </button>
      </div>
      {labeled && <span>{tr('컨트롤러')}</span>}
      <select
        aria-label={t('row.gamepadButton')}
        value={showCode ? 'custom' : gamepad}
        onChange={e => {
          setCustom(e.target.value === 'custom');
          if (e.target.value !== 'custom') changeGamepad(Number(e.target.value));
        }}
      >
        {gamepadButtons.map(([s, v]) => (
          <option key={v} value={v}>
            {labeled && v === 0 ? tr('사용 안 함') : s}
          </option>
        ))}
        <option value="custom">{t('detail.code')}</option>
      </select>
      {showCode && (
        <input
          aria-label={t('detail.code')}
          type="number"
          min={0}
          max={65535}
          value={gamepad}
          onChange={e => changeGamepad(Number(e.target.value))}
        />
      )}
      {message && <span role="status">{message}</span>}
    </div>
  );
}
