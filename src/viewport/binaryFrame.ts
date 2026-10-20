// Binary IPC frames from the Rust side (src-tauri/src/ipc_binary.rs):
// [u32 LE header length][UTF-8 JSON header][zero padding to a 4-byte boundary][payload].
import type {SkinBinary, ViewerData} from './types.ts';
import {tr} from '../i18n/korean.ts';

function split(buffer: ArrayBuffer): {header: any; offset: number} {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4)
    throw new Error(tr('바이너리 응답 형식이 올바르지 않습니다.'));
  const length = new DataView(buffer).getUint32(0, true);
  if (4 + length > buffer.byteLength) throw new Error(tr('바이너리 응답 머리글 길이가 올바르지 않습니다.'));
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
  if (!header || typeof header !== 'object') throw new Error(tr('바이너리 응답 머리글이 올바르지 않습니다.'));
  return {header, offset: (4 + length + 3) & ~3};
}

/** Viewer frames: each actor's `matrixCount` f32 values follow in actor order (views, no copy). */
export function decodeViewerFrames(buffer: ArrayBuffer): ViewerData {
  const {header, offset: start} = split(buffer);
  let offset = start;
  for (const actor of Array.isArray(header.actors) ? header.actors : []) {
    const count = actor?.matrixCount;
    if (!Number.isInteger(count) || count < 0 || offset + count * 4 > buffer.byteLength)
      throw new Error(tr('HKX 행렬 길이가 응답과 맞지 않습니다.'));
    actor.matrices = new Float32Array(buffer, offset, count);
    delete actor.matrixCount;
    offset += count * 4;
  }
  if (offset !== buffer.byteLength) throw new Error(tr('HKX 행렬 뒤에 남는 데이터가 있습니다.'));
  return header as ViewerData;
}

/** GLB skin: {path, name} header followed by the file bytes. */
export function decodeSkin(buffer: ArrayBuffer): SkinBinary {
  const {header, offset} = split(buffer);
  return {path: header.path, name: header.name, bytes: new Uint8Array(buffer, offset)};
}
