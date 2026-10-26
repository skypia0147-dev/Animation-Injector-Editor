import {useEffect, useId, useState} from 'react';
import {keys} from '../../model.ts';
import {t} from '../../i18n/index.ts';
import {capturedKey} from './keyCapture.ts';
import {tr} from '../../i18n/korean.ts';
import {gameControlLabel, gameControls, type GameControl} from '../../keys.ts';
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
  control,
  changeControl,
  labeled = false,
}: {
  value: string;
  change: (s: string) => void;
  gamepad: number;
  changeGamepad: (n: number) => void;
  /** A game control instead of the key and button (runtime 0.12.292); offered when changeControl is given. */
  control?: GameControl;
  changeControl?: (control: GameControl | undefined) => void;
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
  // A game control: the player's own keyboard, mouse and gamepad keys for it, followed when remapped.
  const controlPicker = changeControl && (
    <select
      aria-label={tr('게임 동작')}
      title={tr(
        '게임 동작을 고르면 키보드·마우스·게임패드에서 그 동작에 묶인 키로 동작합니다. 게임 설정에서 키를 바꾸면 따라갑니다.'
      )}
      value={control ?? ''}
      onChange={e => changeControl((e.target.value || undefined) as GameControl | undefined)}
    >
      <option value="">{tr('키·패드 직접 지정')}</option>
      <optgroup label={tr('게임 동작')}>
        {gameControls.map(c => (
          <option key={c} value={c}>
            {gameControlLabel(c)}
          </option>
        ))}
      </optgroup>
    </select>
  );
  if (control) return <div className="key-field">{controlPicker}</div>;
  return (
    <div className="key-field">
      {controlPicker}
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
