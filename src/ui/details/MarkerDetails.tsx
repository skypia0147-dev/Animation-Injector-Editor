import {HelpNote} from '../HelpTip.tsx';
import {DetailRow} from './DetailRow.tsx';
import type {Workspace} from '../../workspace.ts';
import {useEffect, useState} from 'react';
import {DetailPanel, DetailCategory} from './DetailRow.tsx';
import {renameMarker, removeMarker, markerUses, markerNames} from './markerCatalog.ts';
import {tr} from '../../i18n/korean.ts';

export function MarkerDetails({
  w,
  name,
  edit,
  select,
  status,
}: {
  w: Workspace;
  name: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  select: (s: string) => void;
  status: (s: string) => void;
}) {
  const [draft, setDraft] = useState(name),
    [error, setError] = useState('');
  useEffect(() => {
    setDraft(name);
    setError('');
  }, [name]);
  const uses = markerUses(w, name),
    exists = markerNames(w).includes(name);
  const apply = () => {
    try {
      const next = renameMarker(w, name, draft);
      edit(() => next);
      select(draft);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <DetailPanel>
      <DetailCategory title={tr('이벤트 설정')} initialOpen>
        {exists ? (
          <>
            <DetailRow label={tr('이름')}>
              <input
                aria-label={tr('이벤트 이름')}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    apply();
                  }
                }}
              />
            </DetailRow>
            <div className="row-actions">
              <button disabled={draft === name} onClick={apply}>
                {tr('이름 변경 적용')}
              </button>
              <button
                disabled={uses.length > 0}
                title={uses.length ? tr('아래 사용 위치를 변경한 뒤 삭제하세요.') : tr('미사용 이벤트 삭제')}
                onClick={() => {
                  try {
                    const next = removeMarker(w, name);
                    edit(() => next);
                    select('');
                    status(tr('이벤트를 삭제했습니다.'));
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                {tr('이벤트 삭제')}
              </button>
            </div>
            {error && <p role="alert">{error}</p>}
            <HelpNote label={tr('이벤트 사용 방법')}>
              {tr(
                '프로젝트의 연결·감지 설정에 사용하는 이름입니다. 변경하면 참조에도 반영됩니다. HKX 안의 주석은 수정하지 않으므로 같은 이름으로 따로 작성해야 합니다. 감지 구간에서 ‘HKX 주석 이벤트’를 선택해 지정하세요. 비활성·보관 설정도 참조에 포함됩니다.'
              )}
            </HelpNote>
            <strong>{tr('사용 위치 {n}개', {n: uses.length})}</strong>
            {uses.length ? (
              <ul>
                {uses.map((use, i) => (
                  <li key={i}>{use}</li>
                ))}
              </ul>
            ) : (
              <HelpNote label={tr('미사용')}>
                {tr('삭제하거나 그래프로 드래그해 이벤트 수신 카드를 만들 수 있습니다.')}
              </HelpNote>
            )}
          </>
        ) : (
          <p>{tr('왼쪽 이벤트 목록에서 선택하거나 ＋ 버튼으로 추가하세요.')}</p>
        )}
      </DetailCategory>
    </DetailPanel>
  );
}
