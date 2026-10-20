import {setBranchTarget, deleteCondition} from './conditionCommands.ts';
import {useState, useEffect} from 'react';
import type {Workspace} from '../workspace.ts';
import type {BranchTarget} from './conditions.ts';
import {tableRows, linearRows, addTableRow, removeTableRow, reorderRow} from './conditionTables.ts';
import {ConditionDetails} from './ConditionDetails.tsx';
import {tr} from '../i18n/korean.ts';
const names: Record<string, string> = {
  get air() {
    return tr('공중');
  },
  get weaponDrawn() {
    return tr('무기 뽑음');
  },
  get combat() {
    return tr('전투 중');
  },
  get alive() {
    return tr('살아 있음');
  },
  get stamina() {
    return tr('스태미나');
  },
  get magicka() {
    return tr('매지카');
  },
  get space() {
    return tr('공간 확보');
  },
  get ground() {
    return tr('지면 확보');
  },
  get equippedType() {
    return tr('장착 종류');
  },
  get attackState() {
    return tr('공격 상태');
  },
  get sneaking() {
    return tr('은신 중');
  },
  get female() {
    return tr('여성');
  },
  get unarmedRight() {
    return tr('오른손 맨손');
  },
  get magicEffect() {
    return tr('마법 효과');
  },
  get global() {
    return tr('전역 값');
  },
  get all() {
    return tr('모두 충족');
  },
  get any() {
    return tr('하나 이상 충족');
  },
  get not() {
    return tr('반대');
  },
};
export function ConditionTableDetails({
  w,
  owner,
  edit,
  status,
  embedded = false,
  focus,
}: {
  w: Workspace;
  owner: string;
  edit: (f: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  embedded?: boolean;
  focus?: string;
}) {
  const [selected, setSelected] = useState(''),
    a = w.actions.find(a => a.uid === owner),
    f = a?.flow;
  useEffect(() => {
    if (focus?.startsWith(`flow:${owner}:`)) setSelected(focus.split(':')[2]);
  }, [focus, owner]);
  if (!a || !f) return null;
  const rows = tableRows(f),
    linear = linearRows(f),
    chosen = f.tests.find(t => t.id === selected);
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      status(String(e));
    }
  };
  const setTarget = (id: string, p: 'pass' | 'fail', value: string) =>
    attempt(() =>
      edit(w => {
        const [type, ...rest] = value.split(':');
        return setBranchTarget(
          w,
          owner,
          id,
          p,
          !value ? undefined : type === 'node' ? {node: rest.join(':')} : {action: rest.join(':')}
        );
      })
    );
  const target = (id: string, p: 'pass' | 'fail', end?: BranchTarget) => (
    <select
      aria-label={id + ' ' + p}
      value={end ? ('node' in end ? 'node:' + end.node : 'action:' + end.action) : ''}
      onChange={e => setTarget(id, p, e.target.value)}
    >
      <option value="">{tr('실행하지 않음')}</option>
      <optgroup label={tr('다음 검사')}>
        {rows
          .filter(r => r.id !== id)
          .map(r => (
            <option key={r.id} value={'node:' + r.id}>
              {r.id}
            </option>
          ))}
      </optgroup>
      <optgroup label={tr('HKX 재생')}>
        {w.actions
          .filter(b => (!b.flow || b.uid === owner) && (a.pair || !b.pair))
          .map(b => (
            <option key={b.uid} value={'action:' + b.uid}>
              {b.config.name}
            </option>
          ))}
      </optgroup>
    </select>
  );
  if (embedded)
    return (
      <section className="checklist-condition-rules">
        <small>{linear ? tr('위에서부터 검사 · 첫 통과 동작 실행') : tr('연결된 통과·실패 경로 순서로 검사')}</small>
        {rows.map((r, i) => (
          <div className="checklist-row" key={r.id}>
            <button
              className="checklist-summary"
              aria-expanded={selected === r.id}
              onClick={() => setSelected(selected === r.id ? '' : r.id)}
            >
              {selected === r.id ? '▾' : '▸'} {i + 1}. {r.label || r.id}
              {r.negate ? ' · NOT' : ''}
            </button>
            {selected === r.id && (
              <div className="checklist-fields">
                <ConditionDetails w={w} id={'flow:' + owner + ':' + r.id} edit={edit} />
                <label>
                  {tr('통과')} {target(r.id, 'pass', r.pass)}
                </label>
                <label>
                  {tr('실패')} {target(r.id, 'fail', r.fail)}
                </label>
                <div className="checklist-row-actions">
                  <button
                    disabled={!linear || i === 0}
                    onClick={() => attempt(() => edit(w => reorderRow(w, owner, r.id, -1)))}
                  >
                    {tr('위로')}
                  </button>
                  <button
                    disabled={!linear || i === rows.length - 1}
                    onClick={() => attempt(() => edit(w => reorderRow(w, owner, r.id, 1)))}
                  >
                    {tr('아래로')}
                  </button>
                  <button onClick={() => attempt(() => edit(w => removeTableRow(w, owner, r.id)))}>
                    {tr('건너뛰기')}
                  </button>
                  <button onClick={() => attempt(() => edit(w => deleteCondition(w, owner, r.id)))}>
                    {tr('삭제')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button onClick={() => edit(w => addTableRow(w, owner))}>{tr('+ 규칙')}</button>
      </section>
    );
  return (
    <section className="spell-rules">
      <div className="spell-rule-tools">
        <b>{linear ? tr('우선순위 선택') : tr('복합 경로 선택')}</b>
        <span
          title={
            linear
              ? tr('위에서부터 검사하고 처음 통과한 규칙의 동작을 사용합니다. 마지막 실패 경로가 기본 동작입니다.')
              : tr('기존 통과·실패 경로를 그대로 따릅니다. 표의 행 순서를 바꾸어도 되는 단순 목록과 구분합니다.')
          }
        >
          ⓘ
        </span>
        <button
          onClick={() =>
            edit(w => {
              w.conditionTables = w.conditionTables?.filter(x => x !== owner);
              return w;
            })
          }
        >
          {tr('조건 분기 펼치기')}
        </button>
      </div>
      <div className="spell-rule-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr('순서 / 규칙')}</th>
              <th>{tr('조건')}</th>
              <th>{tr('통과')}</th>
              <th>{tr('실패 / 기본')}</th>
              <th>{tr('편집')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>
                  {i + 1} · {r.id}
                  {f.entry === r.id ? tr(' · 시작') : ''}
                  <div>
                    <button
                      disabled={!linear || i === 0}
                      title={tr('검사 우선순위 올리기. 복합 경로는 통과·실패 연결로 순서를 변경하세요.')}
                      onClick={() => attempt(() => edit(w => reorderRow(w, owner, r.id, -1)))}
                    >
                      ↑
                    </button>
                    <button
                      disabled={!linear || i === rows.length - 1}
                      title={tr('검사 우선순위 내리기')}
                      onClick={() => attempt(() => edit(w => reorderRow(w, owner, r.id, 1)))}
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td>
                  <button onClick={() => setSelected(r.id)}>
                    {r.negate ? 'NOT · ' : ''}
                    {names[r.kind]}
                    {r.operands?.length ? ' · ' + r.operands.length + tr('항목') : ''}
                  </button>
                </td>
                <td>{target(r.id, 'pass', r.pass)}</td>
                <td>{target(r.id, 'fail', r.fail)}</td>
                <td>
                  <button onClick={() => setSelected(r.id)}>{tr('설정')}</button>
                  <button
                    title={tr('이 규칙을 건너뛰고 실패 경로로 연결합니다.')}
                    onClick={() => attempt(() => edit(w => removeTableRow(w, owner, r.id)))}
                  >
                    {tr('건너뛰기')}
                  </button>
                  <button
                    title={tr('이 규칙과 연결만 제거합니다. 다른 경로에 자동 연결하지 않습니다.')}
                    onClick={() => attempt(() => edit(w => deleteCondition(w, owner, r.id)))}
                  >
                    {tr('삭제')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => edit(w => addTableRow(w, owner))}>{tr('＋ 규칙 추가')}</button>
      {f.tests.some(t => !rows.some(r => r.id === t.id) && !f.tests.some(p => p.operands?.includes(t.id))) && (
        <details>
          <summary>{tr('미사용 조건')}</summary>
          {f.tests
            .filter(t => !rows.some(r => r.id === t.id) && !f.tests.some(p => p.operands?.includes(t.id)))
            .map(t => (
              <button key={t.id} onClick={() => setSelected(t.id)}>
                {t.label || t.id} · {t.negate ? 'NOT · ' : ''}
                {names[t.kind]}
              </button>
            ))}
        </details>
      )}
      {chosen && (
        <details open>
          <summary>
            {tr('조건 설정 ·')} {chosen.id}
          </summary>
          <ConditionDetails w={w} id={'flow:' + owner + ':' + chosen.id} edit={edit} />
        </details>
      )}
    </section>
  );
}
