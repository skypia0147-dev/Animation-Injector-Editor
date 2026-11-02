import {addFlat} from '../src/graph/flat.ts';
import {defaultSequence} from '../src/qte.ts';

/** A QTE added as the user does, then given what the editor once chose by itself (11-02: a new QTE chooses nothing
 *  for the user): the circle, the E key, the centre and a four-key sequence. */
export function addChosenQte(w, action, position) {
  const added = addFlat(w, action, 'qte', position);
  const q = added.workspace.qtes.at(-1);
  Object.assign(q, {type: 'splitArc', key: 'E', anchor: 'center', sequence: defaultSequence()});
  return added;
}
