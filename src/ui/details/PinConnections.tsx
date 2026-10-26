import {useMemo} from 'react';
import type {Workspace} from '../../workspace.ts';
import {DetailCategory, DetailRow} from './DetailRow.tsx';
import {PinMenu} from '../../graph/PinMenu.tsx';
import {connectPin, createdLink, pinRows} from '../../graph/pinTargets.ts';
import {checklistModel, checklistProjection} from '../../graph/checklist.ts';
import {renderedChecklist} from '../../graph/renderCache.ts';
import {tr} from '../../i18n/korean.ts';
import {useLanguage} from '../../i18n/index.ts';

// The shown document's view comes from the render cache; an edit's copy is projected on its own.
const view = (w: Workspace) => checklistProjection(w, renderedChecklist(w)),
  fresh = (w: Workspace) => checklistProjection(w, checklistModel(w));

/** "연결": each routing output pin of the selected node with its destination list (graph/pinTargets.ts). */
export function PinConnections({
  w,
  id,
  edit,
  status,
  select,
}: {
  w: Workspace;
  id: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  select: (id: string) => void;
}) {
  // The rows hold translated labels: rebuilt on a language switch.
  const language = useLanguage();
  const rows = useMemo(() => pinRows(w, view(w), id), [w, id, language]);
  if (!rows.length) return null;
  return (
    <DetailCategory title={tr('연결')} initialOpen>
      {rows.map(r => (
        <DetailRow key={r.pin} label={r.label + ' →'}>
          <PinMenu
            className="pin-menu-field"
            label={(r.currentLabel || (r.clearable ? tr('연결 안 함') : tr('고르세요'))) + ' ▾'}
            title={r.label + tr(' 연결 대상 고르기')}
            load={() => r}
            pick={target => {
              let made = '';
              try {
                edit(next => {
                  const after = connectPin(next, fresh(next), id, r.pin, target);
                  made = createdLink(next, after);
                  return after;
                });
              } catch (e) {
                status(String(e));
              }
              if (made) select(made);
            }}
          />
        </DetailRow>
      ))}
    </DetailCategory>
  );
}
