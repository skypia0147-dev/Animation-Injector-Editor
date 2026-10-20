import {HelpNote} from '../ui/HelpTip.tsx';
import {ConditionTableDetails} from './ConditionTableDetails.tsx';
import type {Workspace} from '../workspace.ts';
import {draftScope, draftWorkspace} from './drafts.ts';
import {GraphDetails} from './GraphDetails.tsx';
import {NotifyDetails} from '../timeline/Details.tsx';
import {rows} from '../timeline/model.ts';
import {tr} from '../i18n/korean.ts';
export function DraftDetails({
  w,
  id,
  edit,
  status,
}: {
  w: Workspace;
  id: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
}) {
  const d = w.drafts?.find(d => d.id === id);
  if (!d) return null;
  const temp = draftWorkspace(w, d);
  const change = (f: (w: Workspace) => Workspace) =>
    edit(w => {
      const current = w.drafts!.find(x => x.id === id)!;
      const edited = f(draftWorkspace(w, current));
      const value = edited.actions[0];
      if (current.notify && !rows(edited, value).some(r => r.id === current.notify))
        return {...w, drafts: w.drafts!.filter(x => x.id !== id)};
      return {...w, drafts: w.drafts!.map(x => (x.id === id ? {...x, value} : x))};
    });
  if (d.kind === 'conditionTable')
    return <ConditionTableDetails w={temp} owner={d.value.uid} edit={change} status={status} />;
  return (
    <>
      <HelpNote label={tr('연결 대기')}>
        {d.kind === 'keyInput'
          ? tr(
              '시작 입력은 HKX 재생 카드에 직접 연결하세요. 전환 키는 출발 HKX → 키 입력 → 도착 HKX로 연결하세요. 여러 키를 같은 도착 HKX에 연결할 수 있습니다.'
            )
          : tr('아직 연결되지 않은 카드입니다. 설정 후 동작 카드에 연결하면 적용됩니다.')}
      </HelpNote>
      {d.notify ? (
        <NotifyDetails w={temp} action={d.value} id={d.notify} edit={change} />
      ) : (
        <GraphDetails
          w={temp}
          graph={draftScope(d)}
          node={d.local}
          edit={change}
          status={status}
          open={() => {}}
          selectedAsset=""
          onGlobalSettings={() => status(tr('공통 설정은 프로젝트에서 변경하세요.'))}
        />
      )}
    </>
  );
}
