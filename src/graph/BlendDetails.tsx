import type {Workspace} from '../workspace.ts';
import {blendNodes, editBlend} from './blends.ts';
import {ClipBar} from './ClipBar.tsx';
import {tr} from '../i18n/korean.ts';

// A blend item's fields in the card (docs/mockup-card-cleanup ②): its time, typed in place. Where it plays (start or
// end) is the item's name, so its cards, connection help and inner title are gone.
export function BlendDetails({
  w,
  id,
  edit,
}: {
  w: Workspace;
  id: string;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status?: (s: string) => void;
}) {
  const b = blendNodes(w).find(b => b.id === id);
  if (!b) return null;
  return (
    <div className="moment-fields">
      {/* A length, not a moment on the clip: no bar, the value only (0~5 s). */}
      <ClipBar
        label={tr('시간')}
        length={undefined}
        at={b.seconds}
        onAt={t => typeof t === 'number' && edit(w => editBlend(w, id, {seconds: Math.min(5, t)}))}
      />
    </div>
  );
}
