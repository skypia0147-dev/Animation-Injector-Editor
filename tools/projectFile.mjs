// The project a saved XML holds, for tools: the editor's block in the XML (editorBlock.ts). The .aiproj file was
// retired on 10-03; File > Save writes the runtime XML with the whole project in that block.
import {readFileSync} from 'node:fs';
import {savedProject} from '../src/editorBlock.ts';

/** An installed Grapple mod's XML (AIE_GRAPPLE_XML): the largest real project, the default for the measuring tools. */
export const GRAPPLE_XML = process.env.AIE_GRAPPLE_XML || '';

/** The project JSON in `file`'s editor block. Throws for an XML without one or edited outside the editor since. */
export function projectText(file) {
  const saved = savedProject(readFileSync(file, 'utf8'));
  if (saved.project) return saved.project;
  throw new Error(`${file}: ${saved.stale ? 'edited outside the editor since it was saved' : 'no editor block'}`);
}
