// Every call to the Rust backend goes through invoke() here: the backend writes its messages in Korean, and an
// error it returns is shown in the UI language (backendText.ts). Fields of results that hold messages are
// translated where they are read (io.ts).
import {invoke as tauriInvoke} from '@tauri-apps/api/core';
import {backendText} from './backendText.ts';
import {runtimeText} from './runtimeText.ts';

export {isTauri} from '@tauri-apps/api/core';
export {backendText, runtimeText};

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // A save the runtime check refuses carries the checker's own words after the backend's (runtimeText.ts).
    throw typeof error === 'string' ? runtimeText(backendText(error)) : error;
  }
}
