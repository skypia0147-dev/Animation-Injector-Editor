import {HelpTip} from '../HelpTip.tsx';
import type {Mark} from '../../model.ts';
import {EventPicker} from './EventPicker.tsx';
import {t} from '../../i18n/index.ts';
import {NumberInput} from './NumberInput.tsx';
import {tr} from '../../i18n/korean.ts';
export function TimeField({
  value,
  change,
  label,
  bases = ['seconds', 'event'],
  fallback = 'seconds',
  allowFallback = true,
  events = [],
}: {
  value: Mark;
  change: (m: Mark) => void;
  label: string;
  bases?: Mark['basis'][];
  /** The fallback's basis; 'either' lets the author choose (a transition closes before the end or at a time). */
  fallback?: Mark['fallbackBasis'] | 'either';
  allowFallback?: boolean;
  events?: string[];
}) {
  const fallbackBasis = fallback === 'either' ? value.fallbackBasis : fallback;
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
          onChange={e => change({...value, basis: e.target.value as Mark['basis'], fallbackBasis})}
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
          {allowFallback && (
            <div className="time-fallback">
              <HelpTip
                label={label + tr(' 대체 시각')}
                help={t(value.fallback ? 'time.fallbackHelp' : 'time.eventOnlyHelp')}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={value.fallback}
                    onChange={e => change({...value, fallback: e.target.checked, fallbackBasis})}
                  />
                  <span className="help-tip-label">{t('time.fallback')}</span>
                </label>
              </HelpTip>
              {value.fallback && (
                <>
                  <NumberInput
                    aria-label={label + ' · ' + t('time.fallback')}
                    min={0}
                    max={600}
                    step={0.05}
                    value={value.seconds}
                    change={seconds => change({...value, seconds})}
                  />
                  {fallback === 'either' ? (
                    <select
                      aria-label={label + ' · ' + t('time.fallbackBasis')}
                      value={value.fallbackBasis}
                      onChange={e => change({...value, fallbackBasis: e.target.value as Mark['fallbackBasis']})}
                    >
                      <option value="seconds">{t('time.afterStart')}</option>
                      <option value="end">{t('time.beforeEnd')}</option>
                    </select>
                  ) : (
                    <span>{t(fallback === 'end' ? 'time.beforeEnd' : 'time.afterStart')}</span>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
