import type {Workspace} from '../workspace.ts';
import type {FlatNode} from './flat.ts';
import {animId, blendNodes, blendBinding, type BlendNode} from './blends.ts';
import {shareNodeSettings} from './sharing.ts';

// A shared node owns seconds; each binding still owns its execution endpoints.
export function reuseBlend(w: Workspace, id: string, play: FlatNode, outgoing: boolean): Workspace | undefined {
  const b = blendNodes(w).find(b => b.id === id)!;
  if (outgoing ? b.source === play.id : b.target === play.id) return w;
  const n = structuredClone(w);
  n.blends = structuredClone(blendNodes(w));
  const a = n.actions.find(a => a.uid === play.action)!;
  const candidates: Array<{source: string; target: string}> = [];
  if (!b.source || !b.target) {
    if (outgoing && b.source && !b.target) candidates.push({source: play.id, target: ''});
    else if (!outgoing && b.target && !b.source) candidates.push({source: '', target: play.id});
    else return;
  } else {
    const donor = blendBinding(w, b);
    if (outgoing && donor.kind === 'link') {
      for (const link of n.links.filter(l => l.from === a.uid)) {
        const dest = n.actions.find(a => a.uid === link.to)!;
        candidates.push({
          source: `link:${link.id}|${link.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
          target: animId(dest.uid, 'clip_' + dest.config.entry),
        });
      }
    } else if (!outgoing) {
      for (const link of n.links.filter(l => l.to === a.uid))
        candidates.push({
          source: `link:${link.id}|${link.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
          target: play.id,
        });
      if (a.config.start.mode !== 'none')
        candidates.push({
          source: `start:${a.uid}|${a.config.start.mode === 'event' ? 'markerReceive' : 'keyInput'}`,
          target: play.id,
        });
    }
    if (!candidates.length)
      candidates.push(
        outgoing ? {source: play.id, target: animId(a.uid, 'outputPose')} : {source: 'entry', target: play.id}
      );
  }
  let result = n;
  for (const endpoints of candidates) {
    const probe: BlendNode = {id: 'probe', ...endpoints, seconds: b.seconds};
    const role = probe.source && probe.target ? blendBinding(result, probe) : undefined;
    const same = result.blends!.filter(other => {
      if (other.id === id) return false;
      if (other.source === probe.source && other.target === probe.target) return true;
      if (!role || !other.source || !other.target) return false;
      try {
        return blendBinding(result, other).key === role.key;
      } catch {
        return false;
      }
    });
    if (!same.length) {
      let i = 1;
      while (result.blends!.some(b => b.id === 'sharedBlend' + i)) i++;
      const binding = {...probe, id: 'sharedBlend' + i};
      result.blends!.push(binding);
      same.push(binding);
    }
    for (const binding of same) result = shareNodeSettings(result, id, binding.id);
    if (role?.kind === 'exit') result.sharedOutputPose = true;
  }
  return result;
}
