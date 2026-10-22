import {HelpTip} from '../HelpTip.tsx';
import {Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useState} from 'react';
import type {ReactElement, ReactNode} from 'react';
import {t, useLanguage} from '../../i18n/index.ts';
import {labelHelp, labelText} from '../../labels.ts';
import type {LabelId} from '../../labels.ts';

export const DetailSearch = createContext('');
export const DetailFocus = createContext('');
export type InspectorGroup = 'playback' | 'features' | 'info';
export const InspectorLayout = createContext<InspectorGroup | ''>('');
export const NestedDetailPanel = createContext(false);
/** Categories drawn as the HKX card's item rows (재생 설정, docs/mockup-playback-settings): name, summary and ▸ on
 *  one line, opening in place. Each starts closed; allOpen opens or closes all of them (전체 펼치기). */
export const CategoryRows = createContext<{allOpen?: boolean} | null>(null);
export function DetailPanel({children}: {children: ReactNode}) {
  useLanguage();
  const [query, setQuery] = useState('');
  const nested = useContext(NestedDetailPanel);
  if (nested) return <>{children}</>;
  return (
    <div className="detail-panel">
      <input
        className="detail-search"
        aria-label={t('detail.search')}
        placeholder={t('detail.search')}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <DetailSearch.Provider value={query.trim().toLocaleLowerCase()}>
        <NestedDetailPanel.Provider value={true}>{children}</NestedDetailPanel.Provider>
      </DetailSearch.Provider>
    </div>
  );
}
export function DetailRow({
  id,
  label,
  hint,
  children,
  reset,
  changed = false,
}: {
  id?: LabelId;
  label?: string;
  hint?: string;
  children: ReactNode;
  reset?: () => void;
  changed?: boolean;
}) {
  useLanguage();
  const name = label ?? (id ? labelText(id) : ''),
    help = hint ?? (id ? labelHelp(id) : '');
  const uid = useId(),
    query = useContext(DetailSearch);
  if (query && !`${name} ${help}`.toLocaleLowerCase().includes(query)) return null;
  const row = (
    <>
      <div className="detail-label-help">
        <label id={uid} htmlFor={uid + '-value'} className={'detail-name' + (help ? ' has-help' : '')}>
          {name}
        </label>
      </div>
      <div className="detail-value">
        {Children.map(children, c =>
          isValidElement(c) && ['input', 'select', 'textarea'].includes(c.type as string)
            ? cloneElement(c as ReactElement<any>, {id: uid + '-value', 'aria-labelledby': uid})
            : c
        )}
      </div>
      <span className="detail-reset">
        {reset && changed && (
          <button aria-label={`${name} · ${t('row.reset')}`} title={t('row.reset')} onClick={reset}>
            ↺
          </button>
        )}
      </span>
    </>
  );
  // The row's help shows when the pointer rests on the row (no "?" button).
  return help ? (
    <HelpTip label={name} help={help} block className="detail-row">
      {row}
    </HelpTip>
  ) : (
    <div className="detail-row">{row}</div>
  );
}
export function DetailCategory({
  sectionId,
  group = 'features',
  summary,
  title,
  children,
  advanced,
  initialOpen = false,
}: {
  sectionId?: string;
  group?: InspectorGroup;
  summary?: string;
  title: string;
  children?: ReactNode;
  advanced?: ReactNode;
  initialOpen?: boolean;
}) {
  const rows = useContext(CategoryRows);
  const query = useContext(DetailSearch),
    [open, setOpen] = useState(rows ? false : initialOpen),
    [more, setMore] = useState(true),
    id = useId();
  useEffect(() => {
    if (rows?.allOpen !== undefined) setOpen(rows.allOpen);
  }, [rows?.allOpen]);
  const focus = useContext(DetailFocus);
  const layout = useContext(InspectorLayout);
  if (layout && !query && group !== layout) return null;
  if (focus && title !== focus && !title.startsWith(focus + ' ·')) return null;
  const expanded = !!query || open || (!!focus && !layout);
  const body = (
    <DetailSearch.Provider value={query && title.toLocaleLowerCase().includes(query) ? '' : query}>
      {children}
      {advanced && (
        <>
          <button className="detail-advanced" aria-expanded={!!query || more} onClick={() => setMore(!more)}>
            {more || query ? '▾' : '▸'} {t('row.advanced')}
          </button>
          {(more || query) && advanced}
        </>
      )}
    </DetailSearch.Provider>
  );
  if (rows)
    return (
      <div className="checklist-row" data-category={title} data-section={sectionId}>
        <div className="checklist-row-heading">
          <button aria-expanded={expanded} aria-controls={id} onClick={() => setOpen(!open)}>
            <span>{title}</span>
            <small title={summary}>{summary === title ? '' : summary}</small>
            <span>{expanded ? '▾' : '▸'}</span>
          </button>
        </div>
        {expanded && (
          <div id={id} className="checklist-fields">
            {body}
          </div>
        )}
      </div>
    );
  return (
    <section className="detail-category" data-category={title} data-section={sectionId}>
      <button
        className="detail-category-title"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>
          {expanded ? '▾' : '▸'} {title}
        </span>
        {summary && (
          <small className="detail-category-summary" title={summary}>
            {summary}
          </small>
        )}
      </button>
      {expanded && <div id={id}>{body}</div>}
    </section>
  );
}
