import {memo} from 'react';
import type {Action, Workspace} from '../../workspace.ts';
import type {Issue} from '../../model.ts';
import {DetailCategory, DetailPanel, DetailRow} from './DetailRow.tsx';
import {PinConnections} from './PinConnections.tsx';
import {tr} from '../../i18n/korean.ts';
import {useLanguage} from '../../i18n/index.ts';

type Props = {
  w: Workspace;
  action: Action;
  stepId?: string;
  node: string;
  issues: Issue[];
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (text: string) => void;
  select: (id: string) => void;
  reveal: () => void;
};

/** Details of a chosen HKX card (2026-10-19): what the card does not show. The card on the canvas is where its
 * settings and features are edited (AGENTS: HKX features are edited inside the card), so the panel no longer draws
 * the same editor a second time; it shows this action's problems, its connections and its file. */
function HkxCardInfoPanel({w, action, stepId, node, issues, edit, status, select, reveal}: Props) {
  useLanguage();
  const step = action.config.steps.find(s => s.id === stepId) ?? action.config.steps[0];
  const own = issues.filter(i => i.node === action.uid);
  return (
    <DetailPanel>
      <div className="card-info-note">
        <p>{tr('이 HKX의 설정과 기능은 캔버스의 카드에서 편집합니다.')}</p>
        <button type="button" onClick={reveal}>
          {tr('카드로 이동')}
        </button>
      </div>
      <DetailCategory title={tr('문제 · {n}', {n: own.length})} initialOpen>
        {own.length ? (
          <ul className="card-info-issues">
            {own.map((issue, i) => (
              <li key={i} className={issue.level}>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="card-info-ok">{tr('이 동작에는 문제가 없습니다.')}</p>
        )}
      </DetailCategory>
      <PinConnections w={w} id={node} edit={edit} status={status} select={select} />
      {step && (
        <DetailCategory title={tr('HKX 파일')} initialOpen>
          <DetailRow label={tr('게임 경로')}>
            <span className="card-info-path">{step.clip || tr('파일 미지정')}</span>
          </DetailRow>
          <DetailRow label={tr('원본 파일')}>
            <span className="card-info-path">{step.localPath || tr('원본 미지정')}</span>
          </DetailRow>
        </DetailCategory>
      )}
    </DetailPanel>
  );
}
// Memoized: the app shell re-renders for state this panel does not use.
export const HkxCardInfo = memo(HkxCardInfoPanel);
