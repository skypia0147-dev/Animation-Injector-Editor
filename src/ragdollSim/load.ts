import type {RagdollData} from './data.ts';
import {ragdollFromJson} from './data.ts';

// The bundled rig ragdolls (rigs/<id>.json), one code chunk each, loaded when a rig is first simulated. Not fetched:
// the desktop app's CSP allows no connect-src to its own files. Kept apart from data.ts, which the node tests import.
const rigs = import.meta.glob('./rigs/*.json', {import: 'default'});
const cache = new Map<string, Promise<RagdollData>>();
export function loadRagdollData(rig: string): Promise<RagdollData> {
  let request = cache.get(rig);
  if (!request) {
    const load = rigs[`./rigs/${rig}.json`];
    request = load ? load().then(ragdollFromJson) : Promise.reject(new Error(rig));
    request.catch(() => cache.delete(rig));
    cache.set(rig, request);
  }
  return request;
}
