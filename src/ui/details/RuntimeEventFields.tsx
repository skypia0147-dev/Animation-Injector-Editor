import {eventListError, type Suppression} from '../../runtimeExtensions.ts';
import {DetailRow} from './DetailRow.tsx';
import {t} from '../../i18n/index.ts';
export function RuntimeEventFields({
  events,
  change,
  suppression,
  changeWhen,
}: {
  events: string[];
  change: (v: string[]) => void;
  suppression?: Suppression['when'];
  changeWhen?: (v: Suppression['when']) => void;
}) {
  const error = eventListError(events);
  return (
    <>
      <DetailRow label={t('ext.eventNames')} hint={t(suppression ? 'ext.suppressHint' : 'ext.extraEventsHint')}>
        <textarea
          aria-label={t('ext.eventNames')}
          rows={4}
          spellCheck={false}
          value={events.join('\n')}
          onChange={e => change(e.target.value.split(/\r?\n|,/))}
        />
      </DetailRow>
      {suppression && (
        <DetailRow label={t('ext.suppressWhen')} hint={t('ext.suppressWhenHint')}>
          <select value={suppression} onChange={e => changeWhen?.(e.target.value as Suppression['when'])}>
            {(['startable', 'active', 'both'] as const).map(v => (
              <option key={v} value={v}>
                {t('ext.' + v)}
              </option>
            ))}
          </select>
        </DetailRow>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
