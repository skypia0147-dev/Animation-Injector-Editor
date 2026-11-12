import {HelpTip} from '../HelpTip.tsx';
import type {Mark} from '../../model.ts';
import {EventPicker} from './EventPicker.tsx';
import {t} from '../../i18n/index.ts';
import {NumberInput} from './NumberInput.tsx';
import {tr} from '../../i18n/korean.ts';
import {DetailRow} from './DetailRow.tsx';
export function TimeField({
  value,
  change,
  label,
  bases = ['seconds', 'event'],
  events = [],
  rows = false,
}: {
  value: Mark;
  change: (m: Mark) => void;
  label: string;
  bases?: Mark['basis'][];
  events?: string[];
  /** A named row for each control (시점 · 이벤트) instead of two unnamed ones under the row above (11-12 audit). */
  rows?: boolean;
}) {
  // An event moment waits for its event only (runtime 0.12.278): no time for when it does not come.
  if (rows)
    return (
      <>
        <DetailRow label={tr('시점')}>
          <div className="time-main">
            {value.basis !== 'event' && (
              <NumberInput
                aria-label={label + ' · ' + t('time.seconds')}
                min={0}
                max={600}
                step={0.05}
                value={value.seconds}
                change={seconds => change({...value, seconds})}
              />
            )}
            <select
              aria-label={label + ' · ' + t('detail.mode')}
              value={value.basis}
              onChange={e => change({...value, basis: e.target.value as Mark['basis'], fallback: false})}
            >
              {bases.map(b => (
                <option key={b} value={b}>
                  {t(b === 'seconds' ? 'time.afterStart' : b === 'end' ? 'time.beforeEnd' : 'time.marker')}
                </option>
              ))}
            </select>
          </div>
        </DetailRow>
        {value.basis === 'event' && (
          <DetailRow label={tr('이벤트')} hint={t('time.eventHelp')}>
            <EventPicker
              label={label + ' · ' + t('row.marker')}
              value={value.event}
              events={events}
              change={event => change({...value, event})}
            />
          </DetailRow>
        )}
      </>
    );
  return (
    <div className="time-field">
      <div className="time-main">
        {value.basis !== 'event' && (
          <NumberInput
            aria-label={label + ' · ' + t('time.seconds')}
            min={0}
            max={600}
            step={0.05}
            value={value.seconds}
            change={seconds => change({...value, seconds})}
          />
        )}
        <select
          aria-label={label + ' · ' + t('detail.mode')}
          value={value.basis}
          onChange={e => change({...value, basis: e.target.value as Mark['basis'], fallback: false})}
        >
          {bases.map(b => (
            <option key={b} value={b}>
              {t(b === 'seconds' ? 'time.afterStart' : b === 'end' ? 'time.beforeEnd' : 'time.marker')}
            </option>
          ))}
        </select>
      </div>
      {value.basis === 'event' && (
        <>
          <HelpTip label={label + tr(' 이벤트')} help={t('time.eventHelp')} block className="time-event-input">
            <EventPicker
              label={label + ' · ' + t('row.marker')}
              value={value.event}
              events={events}
              change={event => change({...value, event})}
            />
          </HelpTip>
        </>
      )}
    </div>
  );
}
