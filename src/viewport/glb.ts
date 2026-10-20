import {tr} from '../i18n/korean.ts';
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** Reject every authored external URI. Embedded BIN chunks, bufferViews and data URIs remain supported. */
export function validateGlbResources(bytes: Uint8Array): void {
  if (bytes.byteLength < 20) throw new Error(tr('GLB 헤더가 너무 짧습니다.'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2)
    throw new Error(tr('GLB v2 파일이 아닙니다.'));
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error(tr('GLB 선언 길이가 실제 바이트와 다릅니다.'));
  let offset = 12,
    json: unknown;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true),
      kind = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength) throw new Error(tr('GLB 청크 길이가 범위를 벗어났습니다.'));
    if (kind === JSON_CHUNK && json === undefined) {
      const text = new TextDecoder().decode(bytes.subarray(offset, offset + length)).replace(/[\u0000\u0020]+$/g, '');
      json = JSON.parse(text);
    }
    offset += length;
  }
  if (offset !== bytes.byteLength || json === undefined) throw new Error(tr('GLB JSON 청크를 찾지 못했습니다.'));
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'uri' && (typeof item !== 'string' || !item.startsWith('data:')))
        throw new Error(tr('GLB 외부 리소스 URI는 지원하지 않습니다. bufferView 또는 data URI를 사용하세요.'));
      visit(item);
    }
  };
  visit(json);
}

export const safeLoaderUrl = (url: string): string => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  throw new Error(tr('GLB 로더의 외부 URL 요청을 차단했습니다.'));
};
