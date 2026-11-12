import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useDragToCard} from './dragToCard.tsx';
import {useDismiss} from '../ui/useDismiss.ts';
import {DetailPanel, NestedDetailPanel} from '../ui/details/DetailRow.tsx';
import {tr} from '../i18n/korean.ts';
import './cardSettings.css';

// A card's settings as a condition card's parts (docs/mockup unify ⑨ ⑩, 10-27): what is set shows, the rest is one
// 「＋ 설정」 away. A setting opens in place to its fields; one set back to its default goes from the card again.
export type Setting = {
  id: string;
  label: string;
  /** The closed setting's value: text or chips. */
  value: ReactNode;
  /** Set to something other than its default: shown. */
  set: boolean;
  /** Always shown (the card's trigger, its file): never in the add menu, no way back to a default. */
  fixed?: boolean;
  /** Whether the setting applies to this card at all (a pair's partner, a blend between ordinary actions). */
  applies?: boolean;
  fields: () => ReactNode;
  /** Back to the default: the setting leaves the card. */
  reset?: () => void;
  /** Picked from 「＋ 설정」: what it starts as (nothing: its fields open on the default). */
  add?: () => void;
  /** Its chip dragged onto another HKX card (that card's node id): moved there, or copied with Ctrl. */
  drag?: (card: string, copy: boolean) => void;
};
export type Settings = ReturnType<typeof useSettings>;
/** Which settings show, which is open, and the add menu's. `fold`: the card is left in the summary view, and its
 *  open setting closes (as a condition card's parts fold, ConditionCardFace). */
export function useSettings(all: Setting[], fold = false) {
  const items = all.filter(s => s.applies !== false);
  const [open, setOpen] = useState(''),
    [added, setAdded] = useState<string[]>([]);
  const shown = items.filter(s => s.fixed || s.set || added.includes(s.id) || open === s.id);
  const close = () => {
    // A setting added and left at its default goes again when it closes.
    setAdded(list => list.filter(id => id !== open || !!items.find(s => s.id === id)?.set));
    setOpen('');
  };
  useEffect(() => {
    if (fold && open) close();
    // Only the card being left folds it, not every edit while it is.
  }, [fold]);
  return {
    shown,
    hidden: items.filter(s => !shown.includes(s)),
    open,
    toggle: (id: string) => (open === id ? close() : (close(), setOpen(id))),
    add: (s: Setting) => {
      s.add?.();
      setAdded(list => [...list, s.id]);
      setOpen(s.id);
    },
    reset: (s: Setting) => {
      s.reset?.();
      setAdded(list => list.filter(id => id !== s.id));
      setOpen('');
    },
  };
}
/** An open setting's fields, with the way back to its default (its trash). */
function Fields({s, settings}: {s: Setting; settings: Settings}) {
  const removable = !!s.reset && !s.fixed;
  return (
    <div className={'set-edit nodrag nopan' + (removable ? ' removable' : '')} onClick={e => e.stopPropagation()}>
      {/* A card's panel: no search line of its own (as an HKX card's rows). */}
      <NestedDetailPanel.Provider value={true}>
        <DetailPanel>{s.fields()}</DetailPanel>
      </NestedDetailPanel.Provider>
      {/* The same trash as a feature row's, at the first row's end (11-11 audit ⑨): back at its default, the setting
          is off the card. */}
      {removable && (
        <button
          type="button"
          className="set-remove danger"
          aria-label={tr('삭제 · 기본값으로')}
          title={tr('삭제 · 기본값으로')}
          onClick={() => settings.reset(s)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
          </svg>
        </button>
      )}
    </div>
  );
}
/** Each shown setting a box (start and transition cards): its name and value; open, its fields under them. `after`
 *  goes below the settings (the card's routes), before 「＋ 설정」. */
export function SettingRows({settings, after}: {settings: Settings; after?: ReactNode}) {
  return (
    <div className="set-face">
      {settings.shown.map(s => (
        <div key={s.id} className={'set-box' + (settings.open === s.id ? ' open' : '')}>
          <div className="set-line" onClick={() => settings.toggle(s.id)}>
            <span className="set-label">{s.label}</span>
            <span className="set-value">{s.value}</span>
          </div>
          {settings.open === s.id && <Fields s={s} settings={settings} />}
        </div>
      ))}
      {after}
      <AddSetting settings={settings} />
    </div>
  );
}
/** The shown settings as chips (an HKX card's playback, `owner` its node id), 「＋ 설정」 after them: one opens its
 *  fields under the chips;
 *  one that can be, dragged onto another HKX card, moves there or is copied with Ctrl (graph/dragToCard). */
export function SettingChips({settings, owner}: {settings: Settings; owner: string}) {
  const chips = settings.shown.filter(s => !s.fixed);
  const open = chips.find(s => s.id === settings.open);
  if (!chips.length && !settings.hidden.length) return null;
  return (
    <div className="set-chips-box">
      <span className="cond-chips">
        {chips.map(s => (
          <SettingChip key={s.id} s={s} settings={settings} owner={owner} />
        ))}
        {/* What adds a chip sits where the chips are (11-11 audit ⑩). */}
        <AddSetting settings={settings} className="inline" />
      </span>
      {open && <Fields s={open} settings={settings} />}
    </div>
  );
}
function SettingChip({s, settings, owner}: {s: Setting; settings: Settings; owner: string}) {
  const drag = useDragToCard(owner, (card, copy) => s.drag?.(card, copy));
  return (
    <>
      {drag.ghostView(s.label)}
      <button
        type="button"
        className={'cond-chip set-chip nodrag' + (s.id === settings.open ? ' on' : '')}
        onClick={() => settings.toggle(s.id)}
        onPointerDown={s.drag ? drag.begin : undefined}
      >
        {s.label}
        {s.value !== '' && <em>{s.value}</em>}
      </button>
    </>
  );
}
/** 「＋ 설정」 and its menu of the settings not shown. */
export function AddSetting({settings, className = ''}: {settings: Settings; className?: string}) {
  const [menu, setMenu] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useDismiss(menu, ref, () => setMenu(false));
  if (!settings.hidden.length) return null;
  return (
    <div className={'set-add-wrap ' + className} ref={ref}>
      <button type="button" className="set-add nodrag" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        {tr('＋ 설정')}
      </button>
      {menu && (
        <div className="set-menu nodrag nopan nowheel" role="menu">
          {settings.hidden.map(s => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                settings.add(s);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
