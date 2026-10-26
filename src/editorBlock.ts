import {XML_FORMAT_VERSION} from './xmlFormat.ts';

/** The editor's own data kept inside the runtime XML (2026-10-03, the user's decision: one file, no .aiproj).
 *
 * The XML a document saves is the runtime's body followed by one comment the runtime skips:
 *   <!-- AnimationInjectorEditor {"version":1,"body":"<hash>","project":{…}} -->
 * `project` is the whole project (what a .aiproj held: layout, shared settings, cut lines, display names, drafts),
 * and `body` the hash of the runtime body it was saved with. Opening the XML restores the project when the body is
 * still that one; a body edited outside the editor is opened from the XML itself and the block is set aside (a
 * stale project would hide those edits, as a .aiproj older than its XML did for Dynamic Sprint Stop).
 *
 * A comment may not hold "--": the JSON writes it as "--" inside its strings (the only place it can occur), and
 * JSON.parse reads it back. */
const MARK = '<!-- AnimationInjectorEditor ';
export const EDITOR_BLOCK_VERSION = 1;

export type EditorBlock = {version: number; body: string; project: unknown};

/** The runtime body as compared: line ends and trailing space do not count (git and editors change them). */
const normalized = (body: string) => body.replace(/\r\n?/g, '\n').trimEnd();

/** FNV-1a (32 bit) of the normalized body: enough to tell an edited body from the saved one. */
export function bodyHash(body: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(normalized(body))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The file to write: `body` (the runtime XML) and the block holding `project` (a project's JSON). */
export function withEditorBlock(body: string, project: string): string {
  const block: EditorBlock = {version: EDITOR_BLOCK_VERSION, body: bodyHash(body), project: JSON.parse(project)};
  const json = JSON.stringify(block).replaceAll('--', '-\\u002d');
  return normalized(body) + '\n' + MARK + json + ' -->\n';
}

/** The runtime body of a saved XML and its editor block, if it has one (a broken block counts as none). */
export function readEditorBlock(text: string): {body: string; block?: EditorBlock} {
  const at = text.lastIndexOf(MARK);
  if (at < 0) return {body: text};
  const end = text.indexOf('-->', at);
  if (end < 0 || text.slice(end + 3).trim()) return {body: text};
  const body = text.slice(0, at);
  try {
    const block = JSON.parse(text.slice(at + MARK.length, end)) as EditorBlock;
    if (!block || typeof block !== 'object' || typeof block.body !== 'string' || !block.project) return {body};
    if (block.version !== EDITOR_BLOCK_VERSION) return {body};
    return {body, block};
  } catch {
    return {body};
  }
}

/** The block's project when the body is still the one it was saved with; otherwise none (open from the XML). */
export function savedProject(text: string): {body: string; project?: string; stale: boolean} {
  const {body, block} = readEditorBlock(text);
  if (!block) return {body, stale: false};
  if (block.body !== bodyHash(body)) return {body, stale: true};
  return {body, project: JSON.stringify(block.project), stale: false};
}

/** A draft's runtime body (work saved while the project has errors): an empty set the plugin skips as a whole, so
 * the game plays nothing from the file until it is saved without errors. The backend writes this exact body
 * without the runtime check (main.rs draft_body). */
export function draftBody(id: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<AnimationSet version="${XML_FORMAT_VERSION}" id="${/^[A-Za-z0-9_]{1,64}$/.test(id) ? id : 'Draft'}"/>`;
}
/** A draft's body. */
export const isDraftBody = (body: string) =>
  /^<\?xml[^>]*\?>\s*<AnimationSet version="6" id="[A-Za-z0-9_]{1,64}"\/>$/.test(body.trim());
