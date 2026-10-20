import {extensionSummary} from './conditionExtensions.ts';
import {useState, useEffect} from 'react';
import type {Workspace} from '../workspace.ts';
import type {BranchTest} from './conditions.ts';
import {ConditionFields} from './ConditionDetails.tsx';
import {conditionNames, editExpression, readExpression, expressionSummary} from './conditionExpression.ts';
import type {Expression, ExpressionCommand} from './conditionExpression.ts';
import './conditionEditor.css';
import {tr} from '../i18n/korean.ts';

let copied: Expression | undefined;
/** Where a condition's route goes, in words: an action's name, the next condition or nothing. */
export function routeTarget(w: Workspace, test: BranchTest, p: 'pass' | 'fail') {
  const to = test[p];
  return to
    ? 'action' in to
      ? (w.actions.find(a => a.uid === (to as {action: string}).action)?.config.name ?? tr('대상 없음'))
      : tr('다음 조건')
    : tr('실행하지 않음');
}
export function ConditionExpressionEditor({
  w,
  id,
  edit,
  embedded = false,
  focus,
}: {
  w: Workspace;
  id: string;
  edit: (fn: (w: Workspace) => Workspace) => void;
  embedded?: boolean;
  focus?: string;
}) {
  const [, owner, root] = id.split(':'),
    a = w.actions.find(a => a.uid === owner),
    f = a?.flow;
  const [selected, setSelected] = useState(embedded ? '' : root),
    [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{parent: string; id: string}>();
  useEffect(() => {
    if (focus?.startsWith(`flow:${owner}:`)) {
      setSelected(focus.split(':')[2]);
      setCollapsed(new Set());
    }
  }, [focus, owner]);
  if (!f || !f.tests.some(t => t.id === root)) return null;
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const command = (c: ExpressionCommand) => attempt(() => edit(w => editExpression(w, owner, c)));
  const patch = (id: string, p: Partial<BranchTest>) =>
    edit(w => {
      const n = structuredClone(w);
      Object.assign(
        n.actions.find(a => a.uid === owner)!.flow!.tests.find(t => t.id === id)!,
        p
      );
      return n;
    });
  const row = (key: string, parent?: string, depth = 0): React.ReactNode => {
    const t = f.tests.find(t => t.id === key);
    if (!t || depth > 80) return null;
    const group = ['all', 'any'].includes(t.kind),
      children = t.operands ?? [],
      folded = collapsed.has(key);
    const summary =
      extensionSummary(t) ??
      (t.kind === 'equippedType'
        ? `${t.subject === 'partner' ? tr('상대') : tr('본인')} / ${t.hand === 'right' ? tr('오른손') : tr('왼손')} / ${t.equipmentType ?? 'bow'}`
        : `${t.subject === 'partner' ? tr('상대 · ') : t.kind === 'global' ? '' : tr('본인 · ')}${conditionNames[t.kind]}`);
    return (
      <div
        key={key}
        className={'condition-expression-row' + (t.enabled === false ? ' is-disabled' : '')}
        data-condition={key}
      >
        <div
          className="condition-expression-heading"
          draggable={!!parent}
          onDragStart={e => {
            e.stopPropagation();
            setDrag(parent ? {parent, id: key} : undefined);
            e.dataTransfer.setData('application/x-ai-condition', key);
          }}
          onDragOver={e => {
            if (group && drag) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onDrop={e => {
            if (group && drag) {
              e.preventDefault();
              e.stopPropagation();
              command({type: 'move', ...drag, to: key, index: children.length});
              setDrag(undefined);
            }
          }}
          onDragEnd={() => setDrag(undefined)}
        >
          {group && (
            <button
              aria-label={folded ? tr('그룹 펼치기') : tr('그룹 접기')}
              onClick={() =>
                setCollapsed(v => {
                  const n = new Set(v);
                  n.has(key) ? n.delete(key) : n.add(key);
                  return n;
                })
              }
            >
              {folded ? '▸' : '▾'}
            </button>
          )}
          {parent && (
            <input
              type="checkbox"
              aria-label={tr('조건 활성화')}
              checked={t.enabled !== false}
              onChange={e => patch(key, {enabled: e.target.checked})}
            />
          )}
          {group ? (
            <select
              aria-label={tr('조건 조합')}
              value={t.kind}
              onChange={e => patch(key, {kind: e.target.value as 'all' | 'any'})}
            >
              <option value="all">AND</option>
              <option value="any">OR</option>
            </select>
          ) : (
            <button
              className="condition-name"
              title={summary}
              aria-pressed={selected === key}
              onClick={() => setSelected(selected === key ? '' : key)}
            >
              {summary}
            </button>
          )}
          <label title={tr('참·거짓을 반전합니다. 검사 불능은 반전하지 않습니다.')}>
            <input type="checkbox" checked={!!t.negate} onChange={e => patch(key, {negate: e.target.checked})} />
            NOT
          </label>
          <details className="condition-row-menu">
            <summary title={tr('복사·복제·이동')}>⋮</summary>
            <div>
              <button
                onClick={() => {
                  copied = readExpression(f, key);
                  setError(tr('조건을 복사했습니다.'));
                }}
              >
                {tr('복사')}
              </button>
              {parent && (
                <>
                  <button onClick={() => command({type: 'add', parent, expression: readExpression(f, key)})}>
                    {tr('복제')}
                  </button>
                  <button
                    onClick={() =>
                      command({
                        type: 'move',
                        parent,
                        id: key,
                        to: parent,
                        index: Math.max(0, (f.tests.find(t => t.id === parent)?.operands ?? []).indexOf(key) - 1),
                      })
                    }
                  >
                    {tr('위로')}
                  </button>
                  <button
                    onClick={() =>
                      command({
                        type: 'move',
                        parent,
                        id: key,
                        to: parent,
                        index: (f.tests.find(t => t.id === parent)?.operands ?? []).indexOf(key) + 1,
                      })
                    }
                  >
                    {tr('아래로')}
                  </button>
                </>
              )}
              {parent && (
                <select
                  aria-label={tr('다른 그룹으로 이동')}
                  value=""
                  onChange={e => {
                    if (e.target.value) command({type: 'move', parent, id: key, to: e.target.value, index: 999});
                  }}
                >
                  <option value="">{tr('그룹으로 이동…')}</option>
                  {f.tests
                    .filter(g => ['all', 'any'].includes(g.kind) && g.id !== parent && g.id !== key)
                    .map(g => (
                      <option key={g.id} value={g.id}>
                        {g.label || conditionNames[g.kind] + ' · ' + g.id}
                      </option>
                    ))}
                </select>
              )}
              {!group && (
                <button onClick={() => command({type: 'wrap', id: key, mode: 'all'})}>
                  {tr('AND 그룹으로 감싸기')}
                </button>
              )}
              {group && (
                <button
                  onClick={() =>
                    copied
                      ? command({type: 'add', parent: key, expression: copied})
                      : setError(tr('복사한 조건이 없습니다.'))
                  }
                >
                  {tr('조건 붙여넣기')}
                </button>
              )}
            </div>
          </details>
          {parent && (
            <button
              title={tr('이 항목을 삭제합니다. 그룹은 자식도 함께 삭제합니다. Ctrl+Z로 복원합니다.')}
              aria-label={tr('조건 삭제')}
              onClick={() => command({type: 'remove', parent, id: key})}
            >
              ×
            </button>
          )}
        </div>
        {group && !folded && (
          <div className="condition-expression-children">
            {children.map(c => row(c, key, depth + 1))}
            {!children.length && <p role="alert">{tr('조건을 추가하세요. 빈 그룹은 사용할 수 없습니다.')}</p>}
            <div className="condition-expression-tools">
              <button onClick={() => command({type: 'add', parent: key})}>{tr('＋ 조건')}</button>
              <button onClick={() => command({type: 'add', parent: key, group: true})}>{tr('＋ 그룹')}</button>
            </div>
          </div>
        )}
        {!group && selected === key && (
          <div className="condition-expression-fields">
            <ConditionFields w={w} id={`flow:${owner}:${key}`} edit={edit} embedded />
          </div>
        )}
      </div>
    );
  };
  const test = f.tests.find(t => t.id === root)!;
  return (
    <section className="condition-expression-editor" aria-label={tr('복합조건 편집')}>
      {error && <p role="status">{error}</p>}
      <small>{expressionSummary(f, root)}</small>
      {row(root)}
      {!['all', 'any'].includes(test.kind) && (
        <div className="condition-expression-tools">
          <button onClick={() => command({type: 'wrap', id: root, mode: 'all'})}>{tr('＋ 조건 그룹')}</button>
        </div>
      )}
      {/* On the canvas the card's route rows show where each route goes (FlatGraph BranchRoutes). */}
      {!embedded && (
        <div className="condition-expression-routes">
          {(['pass', 'fail'] as const).map(p => (
            <span key={p}>
              {p === 'pass' ? tr('통과') : tr('실패')}: {routeTarget(w, test, p)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
