import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {extensionKinds, definition} from './conditionExtensions.ts';
import {t} from '../i18n/index.ts';
import {tr} from '../i18n/korean.ts';
import './conditionEditor.css';

/** The condition kinds by category (10-20, docs/mockup-ux-polish ⑪): the extension kinds keep their own category,
 *  the built-in ones get one here. A function so a language change reads the labels again. */
function kindList(withGroups: boolean) {
  const base: [string, string, string][] = [
    ['air', tr('공중'), tr('상태')],
    ['weaponDrawn', tr('무기 뽑음'), tr('상태')],
    ['combat', tr('전투 중'), tr('상태')],
    ['alive', tr('살아 있음'), tr('상태')],
    ['attackState', t('ext.attackState'), tr('상태')],
    ['sneaking', t('ext.sneaking'), tr('상태')],
    ['female', tr('여성'), tr('대상')],
    ['space', tr('공간 확보'), tr('공간')],
    ['ground', tr('지면 확보'), tr('공간')],
    ['magicEffect', tr('마법 효과 보유'), tr('장비·능력')],
    ['equippedType', t('ext.equippedType'), tr('장비·능력')],
    ['global', tr('전역 값 비교'), tr('기타')],
  ];
  const groups: [string, string, string][] = withGroups
    ? [
        ['all', tr('모두 충족 (AND)'), tr('묶음')],
        ['any', tr('하나 이상 충족 (OR)'), tr('묶음')],
      ]
    : [];
  const ext = extensionKinds.map(k => [k, definition(k)!.label, definition(k)!.category] as [string, string, string]);
  const order = [tr('상태'), tr('수치'), tr('대상'), tr('관계'), tr('공간'), tr('장비·능력'), tr('환경'), tr('입력')];
  const all = [...base, ...ext, ...groups];
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length + (c === tr('묶음') ? 1 : 0));
  // Stable within a category: the order they were listed in.
  return all
    .map((item, i) => ({kind: item[0], label: item[1], category: item[2], i}))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.i - b.i);
}

const RECENT_KEY = 'aieditor-condition-recent';
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function remember(kind: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([kind, ...readRecent().filter(k => k !== kind)].slice(0, 5)));
  } catch {}
}

/** "검사 항목": a button showing the kind; it opens a list with a search field, the recent picks and the kinds by
 *  category. Up/Down move, Enter picks, Escape closes. The search matches the name, the category or the XML kind. */
export function ConditionKindPicker({
  value,
  withGroups,
  onChange,
}: {
  value: string;
  withGroups: boolean;
  onChange: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    [point, setPoint] = useState({left: 0, top: 0, maxHeight: 420});
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const kinds = useMemo(() => kindList(withGroups), [withGroups, open]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return kinds;
    const hits = kinds.filter(
      k => k.label.toLowerCase().includes(q) || k.category.toLowerCase().includes(q) || k.kind.toLowerCase().includes(q)
    );
    // The kind typed in full first (what the XML says), then the rest as listed.
    return [...hits.filter(k => k.kind.toLowerCase() === q), ...hits.filter(k => k.kind.toLowerCase() !== q)];
  }, [kinds, q]);
  const recent = useMemo(() => (open ? readRecent().filter(k => kinds.some(x => x.kind === k)) : []), [open, kinds]);
  const close = (focus = true) => {
    setOpen(false);
    setQuery('');
    if (focus) trigger.current?.focus();
  };
  const pick = (kind: string) => {
    remember(kind);
    close();
    if (kind !== value) onChange(kind);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const width = 340,
        below = window.innerHeight - r.bottom - 12,
        above = r.top - 12;
      const down = below >= 260 || below >= above;
      const maxHeight = Math.min(440, down ? below : above);
      setPoint({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        top: down ? r.bottom + 4 : r.top - 4 - Math.min(maxHeight, popup.current?.offsetHeight ?? maxHeight),
        maxHeight,
      });
    };
    place();
    search.current?.focus();
    const away = (e: PointerEvent) => {
      if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('pointerdown', away, true);
    };
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({block: 'nearest'});
  }, [active]);
  let lastCategory = '';
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="condition-kind-trigger"
        value={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{kinds.find(k => k.kind === value)?.label ?? value}</span>
        <i aria-hidden="true">▾</i>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="condition-kind-popup nodrag nopan nowheel"
            style={{left: point.left, top: point.top, maxHeight: point.maxHeight}}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(i => Math.min(shown.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(i => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && shown[active]) {
                e.preventDefault();
                pick(shown[active].kind);
              }
            }}
          >
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={tr('조건 검색 · 이름이나 분류')}
              aria-label={tr('조건 검색')}
              onChange={e => setQuery(e.target.value)}
            />
            {!q && recent.length > 0 && (
              <div className="condition-kind-recent">
                <b>{tr('최근')}</b>
                {recent.map(k => (
                  <button key={k} type="button" onClick={() => pick(k)}>
                    {kinds.find(x => x.kind === k)?.label}
                  </button>
                ))}
              </div>
            )}
            <div className="condition-kind-list" role="listbox" aria-label={tr('검사 항목')}>
              {shown.map((k, i) => {
                const head = !q && k.category !== lastCategory;
                lastCategory = k.category;
                return [
                  head && (
                    <h5 key={'h:' + k.category}>
                      {k.category} · {kinds.filter(x => x.category === k.category).length}
                    </h5>
                  ),
                  <div
                    key={k.kind}
                    role="option"
                    aria-selected={k.kind === value}
                    data-active={i === active}
                    title={q ? k.category : undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(k.kind)}
                  >
                    {k.label}
                  </div>,
                ];
              })}
              {!shown.length && <p>{tr('맞는 조건이 없습니다.')}</p>}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
