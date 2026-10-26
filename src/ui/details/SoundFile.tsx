import {createContext, useContext, useState, type ReactNode} from 'react';
import * as io from '../../io.ts';
import {tr} from '../../i18n/korean.ts';
import type {SoundEntry} from '../../package.ts';
import {assetKey} from '../../package.ts';
import {previewable, toggleSound, useSoundPreview} from '../../soundPreview.ts';

/** What choosing a sound file needs from the app: the library's sounds, remembering a source for the mod package,
 *  and saying what failed. */
export const SoundSourceContext = createContext<{
  sounds: SoundEntry[];
  remember: (file: string, path: string) => void;
  status: (s: string) => void;
} | null>(null);

/** A sound function's file (runtime 0.12.296): typed as its path under Data, or chosen with 찾아보기, whose source
 *  the mod package then copies to that path. */
export function SoundFileInput({
  value,
  change,
  className,
}: {
  value: string;
  change: (file: string) => void;
  className?: string;
}) {
  const ctx = useContext(SoundSourceContext);
  const browse = async () => {
    try {
      const picked = await io.pickSound();
      if (!picked) return;
      change(picked.file);
      ctx?.remember(picked.file, picked.path);
    } catch (e) {
      ctx?.status(String(e));
    }
  };
  return (
    <span className="sound-file">
      <input
        type="text"
        className={className}
        aria-label={tr('소리 파일')}
        placeholder="sound\fx\…\a.wav"
        value={value}
        onChange={e => change(e.target.value)}
      />
      <button type="button" onClick={() => void browse()}>
        {tr('찾아보기')}
      </button>
    </span>
  );
}

const BROWSE = '\u0000browse',
  TYPE = '\u0000type';
const folderOf = (file: string) => file.split(/[\\/]/).slice(1, -1).join('\\');

/** A sound function's source (mockup ②, 10-26): 출처 파일 | 등록 사운드. A file is picked from the library's sounds
 *  (the opened XML's mod folder, added ones), 찾아보기… or typed; ▶ previews its source. A registered sound is a
 *  plugin and form, which play only in the game. `row` lays out one labelled line the way its container does. */
export function SoundSourceFields({
  values,
  setMany,
  row,
}: {
  values: Record<string, string>;
  setMany: (patch: Record<string, string | undefined>) => void;
  row: (label: string, control: ReactNode, key: string) => ReactNode;
}) {
  const ctx = useContext(SoundSourceContext);
  const playing = useSoundPreview();
  const registered = !values.file && (values.plugin !== undefined || values.form !== undefined);
  const [mode, setMode] = useState<'file' | 'registered'>(registered ? 'registered' : 'file');
  const [typing, setTyping] = useState(false);
  const sounds = ctx?.sounds ?? [];
  const file = values.file ?? '';
  const entry = sounds.find(s => assetKey(s.file) === assetKey(file));
  const source = entry?.localPath ?? '';
  const choose = (next: 'file' | 'registered') => {
    setMode(next);
    if (next === 'file') setMany({plugin: undefined, form: undefined});
    else setMany({file: undefined});
  };
  const browse = async () => {
    try {
      const picked = await io.pickSound();
      if (!picked) return;
      setMany({file: picked.file});
      ctx?.remember(picked.file, picked.path);
    } catch (e) {
      ctx?.status(String(e));
    }
  };
  const play = (
    <button
      type="button"
      className={'sound-preview' + (source && playing.path === source ? ' on' : '')}
      aria-label={source && playing.path === source ? tr('정지') : tr('재생')}
      disabled={!source || !previewable(source)}
      title={!source ? tr('원본 미지정') : previewable(source) ? undefined : tr('xwm은 미리듣기를 할 수 없습니다')}
      onClick={() => toggleSound(source).catch(e => ctx?.status(String(e)))}
    >
      {source && playing.path === source ? '■' : '▶'}
    </button>
  );
  const fileControl =
    typing || !sounds.length ? (
      <span className="sound-file-typed">
        <SoundFileInput value={file} change={v => setMany({file: v || undefined})} />
        {sounds.length > 0 && (
          <button type="button" onClick={() => setTyping(false)}>
            {tr('목록')}
          </button>
        )}
      </span>
    ) : (
      <span className="sound-file">
        <select
          aria-label={tr('소리 파일')}
          value={file ? (entry?.file ?? file) : ''}
          onChange={e => {
            const v = e.target.value;
            if (v === BROWSE) void browse();
            else if (v === TYPE) setTyping(true);
            else setMany({file: v || undefined});
          }}
        >
          {!file && <option value="">{tr('소리 파일을 고르세요')}</option>}
          {file && !entry && <option value={file}>{file}</option>}
          {/* The name only; its folder when another sound has the same name. */}
          {sounds.map(s => (
            <option key={s.file} value={s.file} title={s.file}>
              {s.name}
              {sounds.some(o => o !== s && o.name.toLowerCase() === s.name.toLowerCase())
                ? ' — ' + folderOf(s.file)
                : ''}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value={BROWSE}>{tr('찾아보기…')}</option>
          <option value={TYPE}>{tr('경로 직접 입력…')}</option>
        </select>
        {play}
      </span>
    );
  return (
    <>
      {row(
        tr('출처'),
        <span className="moment-seg" role="group" aria-label={tr('출처')}>
          <button type="button" aria-pressed={mode === 'file'} onClick={() => mode !== 'file' && choose('file')}>
            {tr('파일')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'registered'}
            onClick={() => mode !== 'registered' && choose('registered')}
          >
            {tr('등록 사운드')}
          </button>
        </span>,
        'source'
      )}
      {mode === 'file'
        ? row(tr('파일'), fileControl, 'file')
        : [
            row(
              tr('플러그인'),
              <input
                type="text"
                aria-label={tr('플러그인')}
                value={values.plugin ?? ''}
                onChange={e => setMany({plugin: e.target.value || undefined})}
              />,
              'plugin'
            ),
            row(
              'Form ID',
              <input
                type="text"
                aria-label="Form ID"
                placeholder={tr('16진수')}
                value={values.form ?? ''}
                onChange={e => setMany({form: e.target.value || undefined})}
              />,
              'form'
            ),
          ]}
    </>
  );
}
