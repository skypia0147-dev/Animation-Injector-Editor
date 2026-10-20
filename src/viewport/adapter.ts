import {invoke, isTauri} from '../backend.ts';
import {useEffect, useState} from 'react';
import type {SkinBinary, ViewerData, ViewerRequest} from './types.ts';
import {validateViewerData} from './types.ts';
import {decodeSkin, decodeViewerFrames} from './binaryFrame.ts';
import {tr} from '../i18n/korean.ts';

declare global {
  interface Window {
    __AIE_P5_VIEWER_FIXTURE__?: ViewerData | ((request: ViewerRequest) => ViewerData | Promise<ViewerData>);
    __AIE_P5_SKIN_FIXTURE__?: SkinBinary | ((path: string) => SkinBinary | Promise<SkinBinary>);
    __AIE_P5_FORCE_WEBGL_ERROR__?: boolean;
  }
}

export async function loadViewerData(request: ViewerRequest): Promise<ViewerData> {
  const fixture = import.meta.env.DEV ? globalThis.window?.__AIE_P5_VIEWER_FIXTURE__ : undefined;
  if (fixture) return validateViewerData(typeof fixture === 'function' ? await fixture(request) : fixture);
  if (!isTauri()) throw new Error(tr('HKX 프레임은 데스크톱 편집기에서 읽습니다.'));
  return validateViewerData(decodeViewerFrames(await invoke<ArrayBuffer>('hkx_frames', {request})));
}

export async function loadSkin(path: string): Promise<SkinBinary> {
  const fixture = import.meta.env.DEV ? globalThis.window?.__AIE_P5_SKIN_FIXTURE__ : undefined;
  const value = fixture
    ? typeof fixture === 'function'
      ? await fixture(path)
      : fixture
    : decodeSkin(await invoke<ArrayBuffer>('hkx_skin', {path}));
  if (
    !value ||
    typeof value.path !== 'string' ||
    typeof value.name !== 'string' ||
    !(
      value.bytes instanceof Uint8Array ||
      (Array.isArray(value.bytes) && value.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255))
    )
  )
    throw new Error(tr('GLB 응답 형식이 올바르지 않습니다.'));
  return value;
}

export async function pickViewerAsset(kind: 'skeleton' | 'skin'): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('pick_viewer_asset', {kind});
}

export type ViewerLoadState = {key: string; loading: boolean; data?: ViewerData; error?: string};

export function useViewerData(request: ViewerRequest | null, revision = 0): ViewerLoadState {
  const key = request ? JSON.stringify(request) + ':' + revision : '';
  const [state, setState] = useState<ViewerLoadState>({key: '', loading: false});
  useEffect(() => {
    let cancelled = false;
    if (!request) {
      setState({key, loading: false});
      return;
    }
    setState({key, loading: true});
    loadViewerData(request)
      .then(data => {
        if (!cancelled) setState({key, loading: false, data});
      })
      .catch(error => {
        if (!cancelled) setState({key, loading: false, error: String(error)});
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state.key === key ? state : {key, loading: !!request};
}
