import {useEffect, useState} from 'react';
import {Handle, Position, useUpdateNodeInternals} from '@xyflow/react';
import type {Workspace} from '../workspace.ts';
import type {ConditionCard} from '../cards.ts';
import {refCard} from '../cards.ts';
import {NestedDetailPanel} from '../ui/details/DetailRow.tsx';
import {ConditionFields} from './ConditionDetails.tsx';
import {conditionNames, editExpression, patchTest} from './conditionExpression.ts';
import {extensionSummary} from './conditionExtensions.ts';
import {addCondition, addRow, moveRow, removeCondition, removeRow, setTrue, type CardPlace} from './cardCommands.ts';
import {routeDestination} from './pinTargets.ts';
import {rowPin} from './flat.ts';
import {tr} from '../i18n/korean.ts';
import './conditionCard.css';

// A condition card on the canvas (docs/mockup-card-layout): its common conditions as chips, then a line per row (its
// conditions, where it goes), True and False the same way. No row numbers, no icons: rows read top to bottom. A
// part opens in its own box: its conditions one per line, the picked one's fields under it, text actions at the foot.

type Edit = (f: (w: Workspace) => Workspace) => void;
type Props = {
  w: Workspace;
  uid: string;
  node: string;
  edit: Edit;
  status: (s: string) => void;
  /** The card is the choice. In the summary view (`foldWhenLeft`) its open parts close once something else is
   *  chosen, as an HKX card folds. */
  chosen?: boolean;
  foldWhenLeft?: boolean;
  /** A route's destination list, opened from the destination itself (its label is where the route goes). */
  menu: (pin: string, label: string, className: string) => React.ReactNode;
};

/** A condition as [name, value]: what it checks, then its value (the partner's marked). */
export function conditionParts(c: Pick<ConditionCard, 'tests'>, id: string, depth = 0): [string, string] {
  const t = c.tests.find(t => t.id === id);
  if (!t || depth > 20) return ['', ''];
  if (t.kind === 'all' || t.kind === 'any') {
    const members = (t.operands ?? []).map(o => chipText(c, o, depth + 1));
    return [
      t.label || (t.kind === 'any' ? tr('또는') : tr('모두')),
      members.join(t.kind === 'all' ? ' · ' : ' / ') || tr('빈 그룹'),
    ];
  }
  const who = t.subject === 'partner' ? tr('상대') + ' ' : '';
  const ext = extensionSummary(t as never);
  if (ext) {
    const [, name = '', ...rest] = ext.split(' / ');
    return [who + name, rest.join(' ')];
  }
  const name = who + (t.label || conditionNames[t.kind] || t.kind);
  if (t.kind === 'equippedType')
    return [name, (t.hand === 'right' ? tr('오른손') : tr('왼손')) + ' ' + (t.equipmentType ?? 'bow')];
  if (t.kind === 'attackState') return [name, t.attackState ?? ''];
  if (t.kind === 'stamina' || t.kind === 'magicka') return [name, String(t.minimum ?? '')];
  if ((t.kind === 'space' || t.kind === 'ground') && t.space) return [name, String(t.space.distance)];
  return [name, ''];
}
/** A condition in a few words, as its chip shows it. */
export function chipText(c: Pick<ConditionCard, 'tests'>, id: string, depth = 0): string {
  const [name, value] = conditionParts(c, id, depth);
  return value ? `${name} ${value}` : name;
}
function Chips({c, ids}: {c: ConditionCard; ids: string[]}) {
  return (
    <span className="cond-chips">
      {ids.map(id => {
        const t = c.tests.find(t => t.id === id);
        if (!t) return null;
        const [name, value] = conditionParts(c, id);
        const group = t.kind === 'all' || t.kind === 'any';
        return (
          <span key={id} className={'cond-chip' + (group ? ' group' : '') + (t.negate ? ' not' : '')}>
            {t.negate && <b>NOT</b>}
            {name}
            {value && <em>{value}</em>}
          </span>
        );
      })}
    </span>
  );
}

type Attempt = (f: (w: Workspace) => Workspace) => void;
/** The list with `id` added, or without it when it was there. */
const flip = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
type ListProps = {
  w: Workspace;
  c: ConditionCard;
  uid: string;
  ids: string[];
  picked: string[];
  pick: (id: string) => void;
  remove: (id: string) => (w: Workspace) => Workspace;
  edit: Edit;
  attempt: Attempt;
};
/** Conditions one per line [name · value · NOT · ×]; each picked one shows its fields (a group its own list), several
 *  at once as an HKX card's rows. */
function CondList({w, c, uid, ids, picked, pick, remove, edit, attempt}: ListProps) {
  if (!ids.length) return null;
  return (
    <div className="cond-list">
      {ids.map(id => {
        const t = c.tests.find(t => t.id === id);
        if (!t) return null;
        const [name, value] = conditionParts(c, id),
          group = t.kind === 'all' || t.kind === 'any',
          on = picked.includes(id);
        return (
          <div key={id} className={'cond-item' + (on ? ' picked' : '')}>
            <div className="cond-item-line" onClick={() => pick(id)}>
              <span className="cond-item-name">
                {group && <i>{tr('그룹')}</i>}
                {name}
              </span>
              <span className="cond-item-value">{value}</span>
              <button
                type="button"
                className={'cond-not' + (t.negate ? ' on' : '')}
                aria-pressed={!!t.negate}
                title={tr('참·거짓을 반전합니다. 검사 불능은 반전하지 않습니다.')}
                onClick={e => {
                  e.stopPropagation();
                  attempt(w => patchTest(w, uid, id, {negate: !t.negate}));
                }}
              >
                NOT
              </button>
              <button
                type="button"
                className="cond-x"
                aria-label={tr('조건 삭제')}
                onClick={e => {
                  e.stopPropagation();
                  attempt(remove(id));
                }}
              >
                ×
              </button>
            </div>
            {on && (
              <div className="cond-item-fields">
                {group ? (
                  <GroupFields w={w} c={c} uid={uid} id={id} edit={edit} attempt={attempt} />
                ) : (
                  <NestedDetailPanel.Provider value={true}>
                    <ConditionFields w={w} owner={uid} id={id} edit={edit} embedded />
                  </NestedDetailPanel.Provider>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
/** A group: how its members combine (all or one of them), its members as a list, then adding to it. */
function GroupFields({
  w,
  c,
  uid,
  id,
  edit,
  attempt,
}: {
  w: Workspace;
  c: ConditionCard;
  uid: string;
  id: string;
  edit: Edit;
  attempt: Attempt;
}) {
  const t = c.tests.find(t => t.id === id)!,
    members = t.operands ?? [];
  const [picked, setPicked] = useState<string[]>(members[0] ? [members[0]] : []);
  const add = (group: boolean) => {
    let made = '';
    attempt(w => {
      const next = editExpression(w, uid, {type: 'add', parent: id, group});
      made =
        next.cards
          .find(x => x.uid === uid)
          ?.tests.find(x => x.id === id)
          ?.operands?.at(-1) ?? '';
      return next;
    });
    if (made) setPicked(p => [...p, made]);
  };
  return (
    <div className="cond-group">
      <div className="cond-join">
        <span>{tr('조합')}</span>
        {(['all', 'any'] as const).map(kind => (
          <button
            key={kind}
            type="button"
            className={'cond-act' + (t.kind === kind ? ' on' : '')}
            aria-pressed={t.kind === kind}
            onClick={() => attempt(w => patchTest(w, uid, id, {kind}))}
          >
            {kind === 'all' ? tr('모두') : tr('또는')}
          </button>
        ))}
      </div>
      <CondList
        w={w}
        c={c}
        uid={uid}
        ids={members}
        picked={picked}
        pick={m => setPicked(p => flip(p, m))}
        remove={m => w => editExpression(w, uid, {type: 'remove', parent: id, id: m})}
        edit={edit}
        attempt={attempt}
      />
      {!members.length && <p className="cond-empty">{tr('조건을 추가하세요. 빈 그룹은 사용할 수 없습니다.')}</p>}
      <div className="cond-foot">
        <button type="button" className="cond-act" onClick={() => add(false)}>
          {tr('＋ 조건')}
        </button>
        <button type="button" className="cond-act" onClick={() => add(true)}>
          {tr('＋ 그룹')}
        </button>
      </div>
    </div>
  );
}

export function ConditionCardFace({w, uid, node, edit, status, chosen = false, foldWhenLeft = false, menu}: Props) {
  const c = w.cards.find(c => c.uid === uid);
  // Parts and conditions open independently: several stay open at once, as an HKX card's rows.
  const [open, setOpen] = useState<string[]>([]),
    [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (foldWhenLeft && !chosen) {
      setOpen([]);
      setPicked([]);
    }
  }, [chosen, foldWhenLeft]);
  const isOpen = (part: string) => open.includes(part),
    close = (part: string) => setOpen(o => o.filter(x => x !== part));
  const update = useUpdateNodeInternals();
  // Opening a part moves the rows under it: their pins are measured again.
  useEffect(() => update(node), [open, picked, c?.rows.length, c?.true === undefined, node, update]);
  if (!c) return null;
  const attempt = (f: (w: Workspace) => Workspace) => {
    try {
      edit(f);
    } catch (e) {
      status(String(e));
    }
  };
  /** Open a part with its first condition picked (others stay as they are); an open part closes. */
  const toggle = (part: string, ids: string[]) => {
    if (isOpen(part)) return close(part);
    setOpen(o => [...o, part]);
    if (ids[0]) setPicked(p => (p.includes(ids[0]) ? p : [...p, ids[0]]));
  };
  /** A part's editor: its conditions one per line, the picked one's fields under it, then its actions. */
  const editor = (place: CardPlace, ids: string[], tools?: React.ReactNode) => (
    <div className="cond-edit nodrag nopan" onClick={e => e.stopPropagation()}>
      <CondList
        w={w}
        c={c}
        uid={uid}
        ids={ids}
        picked={picked}
        pick={id => setPicked(p => flip(p, id))}
        remove={id => w => removeCondition(w, uid, place, id)}
        edit={edit}
        attempt={attempt}
      />
      <div className="cond-foot">
        <button
          type="button"
          className="cond-act"
          onClick={() => {
            let id = '';
            attempt(w => {
              const r = addCondition(w, uid, place);
              id = r.id;
              return r.workspace;
            });
            if (id) setPicked(p => [...p, id]);
          }}
        >
          {tr('＋ 조건')}
        </button>
        <button
          type="button"
          className="cond-act"
          onClick={() => {
            let id = '';
            attempt(w => {
              const r = addCondition(w, uid, place, true);
              id = r.id;
              return r.workspace;
            });
            if (id) setPicked(p => [...p, id]);
          }}
        >
          {tr('＋ 그룹')}
        </button>
        {tools}
      </div>
    </div>
  );
  /** One line: its badge (True/False), its conditions or their count while open, where it goes, its pin. */
  const line = (pin: string, kind: 'row' | 'true' | 'false', ids: string[], part: string) => {
    const to = routeDestination(w, node, pin),
      ref = kind === 'true' ? c.true : kind === 'false' ? c.false : c.rows.find(r => rowPin(r.id) === pin)?.to;
    const target = !to ? ' none' : refCard(ref ?? null) ? ' card' : ' hkx';
    const opened = isOpen(part);
    return (
      <div
        className={'cond-line' + (kind === 'row' ? '' : ' ' + kind)}
        onClick={() => kind === 'row' && toggle(part, ids)}
      >
        {kind !== 'row' && <span className={'cond-tf ' + kind}>{kind === 'true' ? 'True' : 'False'}</span>}
        {kind === 'row' &&
          (opened ? (
            <span className="cond-sum">
              {ids.length > 1 ? tr('조건 {n}개 · 모두 맞으면', {n: ids.length}) : tr('조건 {n}개', {n: ids.length})}
            </span>
          ) : (
            <Chips c={c} ids={ids} />
          ))}
        {kind !== 'row' && <span />}
        <span className="cond-to-wrap nodrag" onClick={e => e.stopPropagation()}>
          {menu(pin, to || tr('없음'), 'cond-to' + target)}
        </span>
        <Handle id={pin} type="source" position={Position.Right} />
      </div>
    );
  };
  const guardsOpen = isOpen('guards');
  return (
    <div className="cond-face">
      <div
        className={'cond-box cond-guard' + (guardsOpen ? ' open' : '')}
        onClick={() => !guardsOpen && toggle('guards', c.guards)}
      >
        <div
          className="cond-cap"
          onClick={e => {
            if (!guardsOpen) return;
            e.stopPropagation();
            close('guards');
          }}
        >
          {tr('공통 조건 · 모두')}
        </div>
        {!guardsOpen &&
          (c.guards.length ? (
            <Chips c={c} ids={c.guards} />
          ) : (
            <span className="cond-chips">
              <span className="cond-chip add">{tr('＋ 공통 조건')}</span>
            </span>
          ))}
        {guardsOpen &&
          editor(
            'guards',
            c.guards,
            c.true === undefined && c.rows.length <= 1 && c.guards.length > 0 ? (
              <>
                <span className="cond-gap" />
                <button type="button" className="cond-act" onClick={() => attempt(w => setTrue(w, uid, true))}>
                  {tr('True로 (공통 조건만)')}
                </button>
              </>
            ) : undefined
          )}
      </div>
      {c.true !== undefined ? (
        <div className={'cond-box' + (isOpen('true') ? ' open' : '')}>
          <div onClick={() => toggle('true', [])}>{line('true', 'true', [], 'true')}</div>
          {isOpen('true') && (
            <div className="cond-edit nodrag nopan" onClick={e => e.stopPropagation()}>
              <div className="cond-foot">
                <button type="button" className="cond-act" onClick={() => attempt(w => setTrue(w, uid, false))}>
                  {tr('행으로 바꾸기')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        c.rows.map((r, i) => {
          const part = 'row:' + r.id;
          return (
            <div key={r.id} className={'cond-box' + (isOpen(part) ? ' open' : '')}>
              {line(rowPin(r.id), 'row', r.guards, part)}
              {isOpen(part) &&
                editor(
                  `row:${r.id}`,
                  r.guards,
                  <>
                    <span className="cond-gap" />
                    <button
                      type="button"
                      className="cond-act"
                      disabled={i === 0}
                      onClick={() => attempt(w => moveRow(w, uid, r.id, i - 1))}
                    >
                      {tr('위로')}
                    </button>
                    <button
                      type="button"
                      className="cond-act"
                      disabled={i === c.rows.length - 1}
                      onClick={() => attempt(w => moveRow(w, uid, r.id, i + 1))}
                    >
                      {tr('아래로')}
                    </button>
                    <button
                      type="button"
                      className="cond-act danger"
                      onClick={() => {
                        close(part);
                        attempt(w => removeRow(w, uid, r.id));
                      }}
                    >
                      {tr('삭제')}
                    </button>
                  </>
                )}
            </div>
          );
        })
      )}
      <div className="cond-box">{line('false', 'false', [], 'false')}</div>
      {c.true === undefined && (
        <button
          type="button"
          className="cond-add nodrag"
          onClick={() => {
            let id = '',
              first = '';
            attempt(w => {
              const r = addRow(w, uid);
              const made = r.workspace.cards.find(x => x.uid === uid)!.rows.at(-1)!;
              id = made.id;
              first = made.guards[0] ?? '';
              return r.workspace;
            });
            if (id) {
              setOpen(o => [...o, 'row:' + id]);
              if (first) setPicked(p => [...p, first]);
            }
          }}
        >
          {tr('＋ 행 추가')}
        </button>
      )}
    </div>
  );
}
