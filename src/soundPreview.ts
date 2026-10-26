// One sound plays at a time for preview (the browser's ▶ and a sound function's ▶): its bytes come from the backend
// (modpack.rs sound_bytes, .wav only — the webview cannot decode xWMA) and play from a blob URL.
import {useSyncExternalStore} from 'react';
import {invoke, isTauri} from './backend.ts';
import {t} from './i18n/index.ts';
import {tr} from './i18n/korean.ts';
import {errorText} from './errorText.ts';

type State = {path: string; time: number; duration: number};
let state: State = {path: '', time: 0, duration: 0};
let audio: HTMLAudioElement | undefined;
let url = '';
const listeners = new Set<() => void>();
const publish = (next: State) => {
  state = next;
  listeners.forEach(fn => fn());
};

/** Whether a file can be previewed here. */
export const previewable = (path: string) => /\.wav$/i.test(path);

export function stopSound() {
  audio?.pause();
  audio = undefined;
  if (url) URL.revokeObjectURL(url);
  url = '';
  if (state.path) publish({path: '', time: 0, duration: 0});
}

/** Plays `path`, or stops it when it is the one playing. */
export async function toggleSound(path: string) {
  const again = state.path === path;
  stopSound();
  if (again || !path) return;
  if (!isTauri()) throw new Error(t('export.desktop'));
  const bytes = await invoke<ArrayBuffer>('sound_bytes', {path});
  url = URL.createObjectURL(new Blob([bytes], {type: 'audio/wav'}));
  const player = new Audio(url);
  audio = player;
  publish({path, time: 0, duration: 0});
  player.ontimeupdate = () =>
    audio === player && publish({path, time: player.currentTime, duration: player.duration || 0});
  player.onended = () => audio === player && stopSound();
  try {
    await player.play();
  } catch (e) {
    // A file that will not play leaves no ■ behind (the app's CSP allows blob: media since 10-26).
    if (audio === player) stopSound();
    throw new Error(tr('소리를 재생하지 못했습니다: {error}', {error: errorText(e)}));
  }
}

export function useSoundPreview(): State {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state
  );
}
