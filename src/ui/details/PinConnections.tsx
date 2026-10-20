import {useMemo} from 'react';
import type {Workspace} from '../../workspace.ts';
import {DetailCategory, DetailRow} from './DetailRow.tsx';
import {PinMenu} from '../../graph/PinMenu.tsx';
import {connectPin, createdLink, pinRows, shareRow} from '../../graph/pinTargets.ts';
import {shareCondition} from '../../graph/reuseConnection.ts';
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
  const share = useMemo(() => shareRow(w, view(w), id), [w, id, language]);
  if (!rows.length && !share) return null;
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
      {share && (
        <DetailRow
          label={tr('공유 →')}
          hint={tr(
            '고른 동작도 이 조건을 통과해야 시작합니다. 조건 설정은 두 동작이 함께 씁니다(한쪽을 바꾸면 둘 다 바뀝니다).'
          )}
        >
          <PinMenu
            className="pin-menu-field"
            label={tr('동작 고르기 ▾')}
            title={tr('이 조건을 공유할 동작 고르기')}
            openOn={id + '|share'}
            load={() => share}
            pick={target => {
              const action = view(w).nodes.find(n => n.id === target)?.action;
              try {
                if (action) edit(next => shareCondition(next, id, action));
              } catch (e) {
                status(String(e));
              }
            }}
          />
        </DetailRow>
      )}
    </DetailCategory>
  );
}
