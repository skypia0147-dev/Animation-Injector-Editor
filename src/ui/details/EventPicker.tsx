import {useState} from 'react';
import {tr} from '../../i18n/korean.ts';

/**
 * An event name field: picks one of the project's events (the event registry's rows), or a new
 * name, which then appears in the registry as an event of this project.
 */
export function EventPicker({
  value,
  events,
  change,
  label,
  empty,
}: {
  value: string;
  events: string[];
  change: (name: string) => void;
  label: string;
  /** An optional field: the label of choosing no event (''). */
  empty?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const names = [...new Set([...(value ? [value] : []), ...events])].sort((a, b) => a.localeCompare(b));
  if (draft !== null) {
    const commit = () => {
      const name = draft.trim();
      if (name) change(name);
      setDraft(null);
    };
    return (
      <input
        aria-label={label + tr(' · 새 이벤트 이름')}
        autoFocus
        placeholder={tr('새 이벤트 이름')}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => {
        if (e.target.value === '\u0000new') setDraft('');
        else change(e.target.value);
      }}
    >
      {(empty !== undefined || !value) && <option value="">{empty ?? tr('이벤트 선택…')}</option>}
      {names.map(n => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={'\u0000new'}>{tr('＋ 새 이벤트 등록…')}</option>
    </select>
  );
}
