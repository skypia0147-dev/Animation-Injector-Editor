import {gripChoices, settingLabels} from '../../eventRegistry.ts';
import {tr} from '../../i18n/korean.ts';
import {DetailRow} from './DetailRow.tsx';

/** A grip's hands and views (runtime 1.0.9, docs/mockup-grip-hold): one segmented choice each, as a sound's 출처.
 *  The hand is always written (unchosen '' shows none pressed); the view's third person is the default and is left
 *  unset. */
export function GripField({
  name,
  values,
  set,
}: {
  name: 'hand' | 'view';
  values: Record<string, string>;
  set: (key: string, value: string | undefined) => void;
}) {
  const label = settingLabels[name];
  const current = name === 'view' ? (values.view ?? 'third') : values.hand;
  return (
    <DetailRow
      label={label}
      hint={
        name === 'hand'
          ? tr('오른손은 Weapon 뼈, 왼손은 Shield 뼈입니다. 왼손은 Left Hand Equipment Overhaul 2.0 이상이 필요합니다.')
          : tr('유지할 시점입니다. 동작이 재생된 시점에서 잡은 값을 다른 시점에 옮겨 쓰므로 1인칭 HKX가 없어도 됩니다.')
      }
    >
      <span className="moment-seg" role="group" aria-label={label}>
        {gripChoices[name]().map(([value, text]) => (
          <button
            key={value}
            type="button"
            aria-pressed={current === value}
            onClick={() => set(name, name === 'view' && value === 'third' ? undefined : value)}
          >
            {text}
          </button>
        ))}
      </span>
    </DetailRow>
  );
}
