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
/** The title of the card item these details fill: a category of the same name is the item itself and shows no
 *  second title of its own (docs/mockup-layout-fixes ③). */
export const ItemTitle = createContext('');
/** The item a row sits in: a row named as its item draws no second name, only its field
 *  (docs/mockup-layout-audit ⑩). */
const RowOwner = createContext('');
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
}: {
  id?: LabelId;
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  useLanguage();
  const name = label ?? (id ? labelText(id) : ''),
    help = hint ?? (id ? labelHelp(id) : '');
  const uid = useId(),
    query = useContext(DetailSearch),
    owner = useContext(RowOwner);
  if (query && !`${name} ${help}`.toLocaleLowerCase().includes(query)) return null;
  // A lone checkbox reads as "☑ name" in the control column (docs/mockup-layout-audit ⑩).
  const check = Children.toArray(children).some(
    c => isValidElement(c) && c.type === 'input' && (c.props as {type?: string}).type === 'checkbox'
  );
  const className = 'detail-row' + (owner && name === owner ? ' repeats-title' : '') + (check ? ' is-check' : '');
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
    </>
  );
  // The row's help shows when the pointer rests on the row (no "?" button).
  return help ? (
    <HelpTip label={name} help={help} block className={className}>
      {row}
    </HelpTip>
  ) : (
    <div className={className}>{row}</div>
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
  const item = useContext(ItemTitle);
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
  // The item already says what this is and folds it: its fields only, categories inside it keep their titles.
  if (item && (title === item || title.startsWith(item + ' ')) && !rows)
    return (
      <ItemTitle.Provider value="">
        <RowOwner.Provider value={title}>
          <section className="detail-category bare" data-category={title} data-section={sectionId}>
            {body}
          </section>
        </RowOwner.Provider>
      </ItemTitle.Provider>
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
            <RowOwner.Provider value={title}>{body}</RowOwner.Provider>
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
