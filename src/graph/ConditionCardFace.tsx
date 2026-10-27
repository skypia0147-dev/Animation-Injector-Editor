import {createContext, useContext, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Handle, Position, useUpdateNodeInternals} from '@xyflow/react';
import type {Workspace} from '../workspace.ts';
import type {ConditionCard} from '../cards.ts';
import {refCard} from '../cards.ts';
import {NestedDetailPanel} from '../ui/details/DetailRow.tsx';
import {ConditionFields} from './ConditionDetails.tsx';
import {conditionNames, editExpression, patchTest} from './conditionExpression.ts';
import {extensionSummary} from './conditionExtensions.ts';
import {equippedTypeLabels, valuesOf} from './multiValue.ts';
import {groupSummary, partText} from './groupSummary.ts';
import {
  addCondition,
  addRow,
  transferCondition,
  mergeCondition,
  removeCondition,
  removeRow,
  rowIntoList,
  setGroupJoin,
  setRowJoin,
  setTrue,
  tidyCardIn,
  transferRow,
  type CardPlace,
  type CondList,
} from './cardCommands.ts';
import {routeDestination} from './pinTargets.ts';
import {rowPin} from './flat.ts';
import {tr} from '../i18n/korean.ts';
import './conditionCard.css';
import {errorText} from '../errorText.ts';

// A condition card on the canvas (docs/mockup-card-layout): its common conditions as chips with True and False under
// them in the same box (10-27, user request: at the bottom they read as the rows' results), each saying when it is
// taken; then a line per row (its conditions, where it goes). No row numbers, no icons: rows read top to bottom. A
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
    return [
      name,
      (t.hand === 'right' ? tr('오른손') : tr('왼손')) +
        ' ' +
        valuesOf(t.equipmentType ?? 'bow')
          .map(v => equippedTypeLabels()[v as keyof ReturnType<typeof equippedTypeLabels>] ?? v)
          .join('·'),
    ];
  if (t.kind === 'attackState') return [name, valuesOf(t.attackState).join('·')];
  if (t.kind === 'stamina' || t.kind === 'magicka') return [name, String(t.minimum ?? '')];
  if ((t.kind === 'space' || t.kind === 'ground') && t.space) return [name, String(t.space.distance)];
  return [name, ''];
}
/** A condition in a few words, as its chip shows it. */
export function chipText(c: Pick<ConditionCard, 'tests'>, id: string, depth = 0): string {
  const [name, value] = conditionParts(c, id, depth);
  return value ? `${name} ${value}` : name;
}
// Dragging a condition (10-26): from any list on the card (common conditions, a row's, a group's) to another list, a
// place among its conditions, into a group, or out into a new row (the card's bottom 「＋ 조건 추가」). Pointer events,
// not HTML drag and drop: the desktop window takes drags for dropped files (Tauri dragDropEnabled), so the page never
// sees dragover or drop there. A whole row drags too (by its line), between the other rows: the gaps between the
// card's parts, which also take a condition as a new row there.
type Drag = {from: CondList; id: string; row?: boolean; group?: boolean};
// `merge`: let go on the middle of that condition, the two become a group (one level: not inside a group, not a
// group dragged).
type Target = {key: string; to: CondList | 'newRow'; index: number; merge?: string};
// A condition also drags to another card (Ctrl held when letting go: a copy). One drag at a time on the canvas: every
// condition card reads which card and place are under the pointer from here, and widens its gaps while a condition
// is dragged (a row drags only on its own card).
type Hover = {source: string; row: boolean; card: string; key: string};
let hover: Hover | null = null;
const watchers = new Set<() => void>();
function setHover(h: Hover | null) {
  if (h === hover || (h && hover && h.source === hover.source && h.card === hover.card && h.key === hover.key)) return;
  hover = h;
  watchers.forEach(f => f());
}
const watchHover = (f: () => void) => {
  watchers.add(f);
  return () => {
    watchers.delete(f);
  };
};
type DragKit = {
  drag: Drag | null;
  /** The drop place under the pointer: `<list>|<index>`, `into:<group id>`, `box:<list>` or `newRow`. */
  over: string;
  begin: (e: React.PointerEvent, d: Drag) => void;
};
const DragContext = createContext<DragKit | null>(null);
/** Attributes making an element a place a condition can be let go: it goes to `index` of `to`. */
const dropZone = (key: string, to: CondList | 'newRow', index: number) => ({
  'data-drop-key': key,
  'data-drop-to': to,
  'data-drop-index': index,
});
/** Where a condition dragged to (x, y) lands on the card `face` (`own`: the card it comes from): a line's upper quarter
 *  before it, its lower quarter after it, its middle into the group (a group's line) or a group with it (a
 *  condition's); inside a group, or for a group dragged, halves only; else the part, group or new-row button under the
 *  pointer. */
function targetAt(face: HTMLElement, x: number, y: number, d: Drag, own: boolean): Target | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || !face.contains(el) || (own && el.closest(`[data-cond-item="${CSS.escape(d.id)}"]`))) return null;
  // A row (with its destination) goes between parts, on this card or another; let go on the common conditions or
  // another row, its conditions join them (as a group of its operator when theirs is the other).
  if (d.row) {
    const gap = el.closest<HTMLElement>('[data-drop-key^="gap:"], [data-drop-key="true"]');
    if (gap) return {key: gap.dataset.dropKey!, to: 'newRow', index: Number(gap.dataset.dropIndex)};
    const list =
      el.closest<HTMLElement>('[data-cond-line]')?.dataset.list ??
      el.closest<HTMLElement>('[data-drop-key^="box:"]')?.dataset.dropTo;
    if (!list || list === 'newRow' || list.startsWith('group:') || (own && list === d.from)) return null;
    return {key: 'box:' + list, to: list as CondList, index: 0};
  }
  const line = el.closest<HTMLElement>('[data-cond-line]');
  if (line) {
    const r = line.getBoundingClientRect(),
      f = (y - r.top) / r.height,
      list = line.dataset.list as CondList,
      i = Number(line.dataset.index);
    const middle = f > 0.25 && f < 0.75 && !d.group;
    if (middle && line.dataset.members !== undefined)
      return {
        key: 'into:' + line.dataset.condLine,
        to: `group:${line.dataset.condLine}`,
        index: Number(line.dataset.members),
      };
    if (middle && !list.startsWith('group:'))
      return {key: 'merge:' + line.dataset.condLine, to: list, index: i, merge: line.dataset.condLine};
    const index = f < 0.5 ? i : i + 1;
    return {key: `${list}|${index}`, to: list, index};
  }
  const zone = el.closest<HTMLElement>('[data-drop-key]');
  return zone
    ? {key: zone.dataset.dropKey!, to: zone.dataset.dropTo as Target['to'], index: Number(zone.dataset.dropIndex)}
    : null;
}
function Chips({c, ids, list}: {c: ConditionCard; ids: string[]; list: CondList}) {
  const kit = useContext(DragContext);
  return (
    <span className="cond-chips">
      {ids.map(id => {
        const t = c.tests.find(t => t.id === id);
        if (!t) return null;
        const [name, value] = conditionParts(c, id);
        const group = t.kind === 'all' || t.kind === 'any';
        const summary = group
          ? groupSummary(
              (t.operands ?? []).map(m => {
                const [name, value] = conditionParts(c, m);
                return {name, value, not: c.tests.find(x => x.id === m)?.negate};
              })
            )
          : undefined;
        return (
          <span
            key={id}
            className={'cond-chip nodrag' + (group ? ' group' : '') + (t.negate ? ' not' : '')}
            data-cond-item={id}
            title={summary && summary.more ? summary.parts.map(partText).join(' · ') : undefined}
            onPointerDown={e => kit?.begin(e, {from: list, id, group})}
          >
            {t.negate && <b>NOT</b>}
            {summary ? (
              <>
                <JoinBadge kind={t.kind as 'all' | 'any'} small />
                {summary.first && (
                  <span className="cond-group-text">
                    {summary.first.not && <b>NOT</b>}
                    {summary.first.name}
                    {summary.first.value && <em>{summary.first.value}</em>}
                    {summary.more > 0 && <i>{tr('외 {n}', {n: summary.more})}</i>}
                  </span>
                )}
              </>
            ) : (
              <>
                {name}
                {value && <em>{value}</em>}
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** AND or OR, as True and False are shown (docs/mockup-condition-groups ②). */
function JoinBadge({kind, small = false}: {kind: 'all' | 'any'; small?: boolean}) {
  return (
    <span className={'cond-join-badge ' + (kind === 'any' ? 'or' : 'and') + (small ? ' small' : '')}>
      {kind === 'any' ? 'OR' : 'AND'}
    </span>
  );
}
/** The two operators as badges, the chosen one filled. */
function JoinToggle({kind, change}: {kind: 'all' | 'any'; change: (kind: 'all' | 'any') => void}) {
  return (
    <span className="cond-join-toggle" role="group" aria-label={tr('묶는 방법')}>
      {(['all', 'any'] as const).map(k => (
        <button
          key={k}
          type="button"
          className={'cond-join-badge ' + (k === 'any' ? 'or' : 'and') + (kind === k ? '' : ' off')}
          aria-pressed={kind === k}
          title={k === 'any' ? tr('하나라도 맞으면') : tr('모두 맞으면')}
          onClick={e => {
            e.stopPropagation();
            if (kind !== k) change(k);
          }}
        >
          {k === 'any' ? 'OR' : 'AND'}
        </button>
      ))}
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
  /** The list these conditions are, for dragging them. */
  list: CondList;
  ids: string[];
  picked: string[];
  pick: (id: string) => void;
  remove: (id: string) => (w: Workspace) => Workspace;
  edit: Edit;
  attempt: Attempt;
};
/** Conditions one per line [name · value · NOT · ×]; each picked one shows its fields (a group its own list), several
 *  at once as an HKX card's rows. */
function CondList({w, c, uid, list, ids, picked, pick, remove, edit, attempt}: ListProps) {
  const kit = useContext(DragContext);
  if (!ids.length) return null;
  return (
    <div className="cond-list">
      {ids.map((id, i) => {
        const t = c.tests.find(t => t.id === id);
        if (!t) return null;
        const [name, value] = conditionParts(c, id),
          group = t.kind === 'all' || t.kind === 'any',
          on = picked.includes(id);
        // Over a line: its upper half puts the condition before it, the lower half after it, a group's middle into it.
        const mark =
          kit?.over === `${list}|${i}`
            ? ' drop-before'
            : kit?.over === `${list}|${i + 1}` && i === ids.length - 1
              ? ' drop-after'
              : kit?.over === 'into:' + id || kit?.over === 'merge:' + id
                ? ' drop-into'
                : '';
        return (
          <div
            key={id}
            className={'cond-item' + (on ? ' picked' : '') + (kit?.drag?.id === id ? ' dragged' : '') + mark}
            data-cond-item={id}
          >
            <div
              className="cond-item-line"
              data-cond-line={id}
              data-list={list}
              data-index={i}
              {...(group ? {'data-members': (t.operands ?? []).length} : {})}
              onClick={() => pick(id)}
              onPointerDown={e => {
                if (!(e.target as HTMLElement).closest('button')) kit?.begin(e, {from: list, id, group});
              }}
            >
              <span className="cond-item-name">
                {group ? <JoinBadge kind={t.kind as 'all' | 'any'} small /> : name}
              </span>
              <span className="cond-item-value">
                {group ? tr('묶음 · 조건 {n}개', {n: (t.operands ?? []).length}) : value}
              </span>
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
                  <GroupFields w={w} c={c} uid={uid} id={id} holder={list} edit={edit} attempt={attempt} />
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
  holder,
  edit,
  attempt,
}: {
  w: Workspace;
  c: ConditionCard;
  uid: string;
  id: string;
  /** The list holding the group (a row's or the common conditions). */
  holder: CondList;
  edit: Edit;
  attempt: Attempt;
}) {
  const t = c.tests.find(t => t.id === id)!,
    members = t.operands ?? [];
  const [picked, setPicked] = useState<string[]>(members[0] ? [members[0]] : []);
  const kit = useContext(DragContext),
    list: CondList = `group:${id}`;
  const add = () => {
    let made = '';
    attempt(w => {
      const next = tidyCardIn(editExpression(w, uid, {type: 'add', parent: id}), uid);
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
    <div
      className={'cond-group' + (kit?.over === 'box:' + list ? ' drop-into' : '')}
      {...dropZone('box:' + list, list, members.length)}
    >
      <div className="cond-join">
        <JoinToggle
          kind={t.kind as 'all' | 'any'}
          change={kind => attempt(w => setGroupJoin(w, uid, holder as CardPlace, id, kind))}
        />
        <span>{tr('같은 연산자를 고르면 묶음이 풀립니다')}</span>
      </div>
      <CondList
        w={w}
        c={c}
        uid={uid}
        list={list}
        ids={members}
        picked={picked}
        pick={m => setPicked(p => flip(p, m))}
        remove={m => w => tidyCardIn(editExpression(w, uid, {type: 'remove', parent: id, id: m}), uid)}
        edit={edit}
        attempt={attempt}
      />
      <div className="cond-foot">
        <button type="button" className="cond-act" onClick={add}>
          {tr('＋ 조건')}
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
  const [drag, setDrag] = useState<Drag | null>(null),
    [pointer, setPointer] = useState({x: 0, y: 0, copy: false});
  const face = useRef<HTMLDivElement>(null);
  const shared = useSyncExternalStore(watchHover, () => hover),
    over = shared?.card === uid ? shared.key : '',
    dragging = !!shared;
  const isOpen = (part: string) => open.includes(part),
    close = (part: string) => setOpen(o => o.filter(x => x !== part));
  const update = useUpdateNodeInternals();
  // Opening a part moves the rows under it: their pins are measured again.
  // A drag widens the gaps between parts (where rows land).
  useEffect(() => update(node), [open, picked, c?.rows.length, c?.true === undefined, dragging, node, update]);
  if (!c) return null;
  const attempt = (f: (w: Workspace) => Workspace) => {
    try {
      edit(f);
      return true;
    } catch (e) {
      status(errorText(e));
      return false;
    }
  };
  const drop = (d: Drag, t: Target, card: string, copy: boolean) => {
    if (d.row) {
      if (t.to === 'newRow') attempt(w => transferRow(w, uid, d.id, card, t.index, copy));
      // The last row's destination stays with the True that comes back; any other row's goes with it.
      else if (attempt(w => rowIntoList(w, uid, d.id, card, t.to as CardPlace, copy)) && !copy && c.rows.length > 1)
        status(tr('행의 조건을 옮기고 원래 행(목적지 포함)은 지웠습니다. Ctrl+Z로 되돌립니다.'));
      return;
    }
    // The row's last condition leaving takes the row (and where it went) with it.
    const lone =
      !copy && (card !== uid || d.from !== t.to) && c.rows.find(r => 'row:' + r.id === d.from)?.guards.length === 1;
    const moved = t.merge
      ? attempt(w => mergeCondition(w, uid, d.from, d.id, card, t.to as CardPlace, t.merge!, copy))
      : attempt(w => transferCondition(w, uid, d.from, d.id, card, t.to, t.index, copy));
    if (moved && lone) status(tr('조건이 남지 않은 행을 지웠습니다. Ctrl+Z로 되돌립니다.'));
  };
  // A press becomes a drag once the pointer moves 5 px; letting go drops it where targetAt says, and the click that
  // follows the release is swallowed (it would open or pick what was under the pointer).
  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    const x0 = e.clientX,
      y0 = e.clientY;
    let moving = false,
      target: Target | null = null,
      card = '';
    const move = (ev: PointerEvent) => {
      if (!moving) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        moving = true;
        setDrag(d);
        document.body.classList.add('cond-dragging');
      }
      // The card under the pointer: this one or another (its face names it).
      const under = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '.cond-face[data-card]'
      );
      card = under?.dataset.card ?? '';
      target = under ? targetAt(under, ev.clientX, ev.clientY, d, card === uid) : null;
      setHover({source: uid, row: !!d.row, card: target ? card : '', key: target?.key ?? ''});
      setPointer({x: ev.clientX, y: ev.clientY, copy: ev.ctrlKey});
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!moving) return;
      document.body.classList.remove('cond-dragging');
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => removeEventListener('click', swallow, {capture: true}), 0);
      setDrag(null);
      setHover(null);
      if (target && ev.type === 'pointerup') drop(d, target, card, ev.ctrlKey);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  const kit: DragKit = {drag, over, begin};
  /** A part as a drop place: let go on it (not on one of its conditions) and the condition goes to its end. */
  const box = (list: CondList, length: number) => ({
    ...dropZone('box:' + list, list, length),
    className: over === 'box:' + list ? ' drop-into' : '',
  });
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
        list={place}
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
        {tools}
      </div>
    </div>
  );
  /** One line: its badge (True/False) and when it is taken (`why`), or a row's conditions or their count while open;
   *  where it goes, its pin. */
  const line = (pin: string, kind: 'row' | 'true' | 'false', ids: string[], part: string, why = '') => {
    const to = routeDestination(w, node, pin),
      ref = kind === 'true' ? c.true : kind === 'false' ? c.false : c.rows.find(r => rowPin(r.id) === pin)?.to;
    const target = !to ? ' none' : refCard(ref ?? null) ? ' card' : ' hkx';
    const opened = isOpen(part),
      rowAny = kind === 'row' && !!c.rows.find(r => rowPin(r.id) === pin)?.any;
    return (
      <div
        className={
          'cond-line' + (kind === 'row' ? ' nodrag' + (!opened && ids.length > 1 ? ' joined' : '') : ' ' + kind)
        }
        onClick={() => kind === 'row' && toggle(part, ids)}
        onPointerDown={e => {
          // The row's own line (not a condition chip, its destination or its pin) drags the whole row.
          if (kind !== 'row' || (e.target as HTMLElement).closest('.cond-chip, .cond-to-wrap, .react-flow__handle'))
            return;
          begin(e, {from: part as CardPlace, id: part.slice(4), row: true});
        }}
      >
        {kind !== 'row' && <span className={'cond-tf ' + kind}>{kind === 'true' ? 'True' : 'False'}</span>}
        {/* Two or more conditions: AND or OR in the column True and False use. */}
        {kind === 'row' && !opened && ids.length > 1 && <JoinBadge kind={rowAny ? 'any' : 'all'} />}
        {kind === 'row' &&
          (opened ? (
            <span className="cond-sum">
              {ids.length > 1 && (
                <JoinToggle
                  kind={rowAny ? 'any' : 'all'}
                  change={k => attempt(w => setRowJoin(w, uid, part.slice(4), k === 'any'))}
                />
              )}
              {tr('조건 {n}개', {n: ids.length})}
            </span>
          ) : (
            <Chips c={c} ids={ids} list={part as CardPlace} />
          ))}
        {kind !== 'row' && (
          <span className="cond-why" title={why}>
            {to ? why : tr('{why} → 재생 안 함', {why})}
          </span>
        )}
        <span className="cond-to-wrap nodrag" onClick={e => e.stopPropagation()}>
          {menu(pin, to || tr('없음'), 'cond-to' + target)}
        </span>
        <Handle id={pin} type="source" position={Position.Right} />
      </div>
    );
  };
  /** While dragging, the gap above a row (or above False: `index` = the row count) takes a condition as a new row
   *  there, or a dragged row. */
  const gap = (index: number) =>
    dragging && (
      <div
        className={'cond-gap-drop' + (over === 'gap:' + index ? ' on' : '')}
        {...dropZone('gap:' + index, 'newRow', index)}
      />
    );
  const guardsOpen = isOpen('guards'),
    guardDrop = box('guards', c.guards.length),
    hasRows = c.true === undefined && c.rows.length > 0,
    many = c.guards.length > 1;
  // When False is taken: the common conditions failing and, with rows, none of them holding; with neither True nor a
  // row it always is.
  const falseWhy =
    c.true !== undefined
      ? many
        ? tr('하나라도 거짓')
        : tr('거짓')
      : !hasRows
        ? tr('항상')
        : c.guards.length
          ? tr('공통 거짓 · 맞는 행 없음')
          : tr('맞는 행 없음');
  return (
    <DragContext.Provider value={kit}>
      {drag &&
        createPortal(
          <div
            className={'cond-drag-ghost' + (pointer.copy ? ' copy' : '')}
            style={{left: pointer.x + 12, top: pointer.y + 10}}
          >
            {pointer.copy && <b>{tr('복사')}</b>}
            {drag.row
              ? (c.rows.find(r => r.id === drag.id)?.guards ?? []).map(id => chipText(c, id)).join(' · ')
              : chipText(c, drag.id)}
          </div>,
          document.body
        )}
      <div className={'cond-face' + (dragging ? ' dragging' : '')} ref={face} data-card={uid}>
        <div
          {...guardDrop}
          className={'cond-box cond-guard' + (guardsOpen ? ' open' : '') + guardDrop.className}
          onClick={() => !guardsOpen && toggle('guards', c.guards)}
        >
          {/* Its name on its border (docs/mockup-condition-groups ⑦ C), open or not; open, the name closes it. */}
          <span
            className="cond-legend"
            onClick={e => {
              if (!guardsOpen) return;
              e.stopPropagation();
              close('guards');
            }}
          >
            {tr('공통 조건')}
          </span>
          {!guardsOpen &&
            (c.guards.length > 1 ? (
              <span className="cond-joined">
                <JoinBadge kind="all" />
                <Chips c={c} ids={c.guards} list="guards" />
              </span>
            ) : c.guards.length ? (
              <Chips c={c} ids={c.guards} list="guards" />
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
                  <button type="button" className="cond-act" onClick={() => attempt(w => setTrue(w, uid))}>
                    {tr('True로 (공통 조건만)')}
                  </button>
                </>
              ) : undefined
            )}
          {/* True and False under the common conditions, whose results they are. They sit inside the box's border, so a
              click on a line's plain part opens the common conditions too (10-28 rebuild: the middle of the box did
              nothing); its destination, buttons and pins keep their clicks. */}
          <div
            className="cond-results"
            onClick={e => {
              e.stopPropagation();
              if (!guardsOpen && !(e.target as HTMLElement).closest('button, .cond-to-wrap, .react-flow__handle'))
                toggle('guards', c.guards);
            }}
          >
            {c.true !== undefined && (
              // True: the card's common conditions alone. A condition or row let go on it becomes the card's first
              // row, which takes True's destination; True comes back once no row is left.
              <div className={'cond-result' + (over === 'true' ? ' drop-into' : '')} {...dropZone('true', 'newRow', 0)}>
                {line('true', 'true', [], 'true', many ? tr('모두 참') : tr('참'))}
              </div>
            )}
            <div className="cond-result">{line('false', 'false', [], 'false', falseWhy)}</div>
          </div>
        </div>
        {hasRows && (
          <div className="cond-flow">
            {c.guards.length ? tr('공통 참 → 위에서부터 처음 맞는 행 하나') : tr('위에서부터 처음 맞는 행 하나')}
          </div>
        )}
        {c.true === undefined &&
          c.rows.map((r, i) => {
            const part = 'row:' + r.id,
              rowDrop = box(`row:${r.id}`, r.guards.length);
            return (
              <div
                key={r.id}
                {...rowDrop}
                className={
                  'cond-box' +
                  (isOpen(part) ? ' open' : '') +
                  (drag?.row && drag.id === r.id ? ' dragged' : '') +
                  rowDrop.className
                }
              >
                {gap(i)}
                {line(rowPin(r.id), 'row', r.guards, part)}
                {isOpen(part) &&
                  editor(
                    `row:${r.id}`,
                    r.guards,
                    <>
                      <span className="cond-gap" />
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
          })}
        <div className="cond-tail">
          {gap(c.rows.length)}
          <button
            type="button"
            className={'cond-add nodrag' + (over === 'newRow' ? ' drop-into' : '')}
            title={tr('조건을 끌어 놓으면 그 조건으로 새 행을 만듭니다.')}
            {...dropZone('newRow', 'newRow', c.rows.length)}
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
            {tr('＋ 조건 추가')}
          </button>
        </div>
      </div>
    </DragContext.Provider>
  );
}
