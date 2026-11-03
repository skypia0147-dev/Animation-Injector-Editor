import {useEffect, useId, useRef, useState} from 'react';
import type {BoneOption} from '../../carry.ts';
import {useDismiss} from '../useDismiss.ts';

/**
 * A bone name field: the rig's bones open as a list when the field is entered, and typing edits the name and narrows
 * the list to the bones whose name or label holds what was typed. A name outside the list stays as typed (custom
 * rigs). `empty` adds a first entry choosing no bone ('').
 */
export function BonePicker({
  value,
  change,
  options,
  label,
  empty,
}: {
  value: string;
  change: (name: string) => void;
  options: BoneOption[];
  label: string;
  empty?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    list = useRef<HTMLUListElement>(null),
    id = useId(),
    [open, setOpen] = useState(false),
    // What was typed since the list opened: the list shows every bone until the name is edited.
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1);
  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(-1);
  };
  useDismiss(open, ref, close);
  const q = query.trim().toLocaleLowerCase(),
    shown = [...(empty === undefined ? [] : [{name: '', label: empty}]), ...options].filter(
      o => !q || o.name.toLocaleLowerCase().includes(q) || !!o.label?.toLocaleLowerCase().includes(q)
    );
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({block: 'nearest'});
  }, [active]);
  const pick = (name: string) => {
    change(name);
    close();
  };
  const current = options.find(o => o.name === value);
  return (
    <div className="bone-picker" ref={ref}>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        title={current?.label}
        value={value}
        placeholder={empty}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => {
          change(e.target.value);
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive(i => (shown.length ? (i + step + shown.length) % shown.length : -1));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (shown[active]) pick(shown[active].name);
            else close();
          } else if (e.key === 'Tab') close();
        }}
      />
      {open && shown.length > 0 && (
        <ul id={id} role="listbox" ref={list} className="bone-picker-list nodrag nopan nowheel">
          {shown.map((o, i) => (
            <li
              key={o.name || '\u0000'}
              role="option"
              aria-selected={i === active}
              className={o.name === value ? 'current' : undefined}
              onPointerDown={e => {
                e.preventDefault();
                pick(o.name);
              }}
              onPointerEnter={() => setActive(i)}
            >
              {o.label && <span>{o.label}</span>}
              {o.name && <code>{o.name}</code>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
