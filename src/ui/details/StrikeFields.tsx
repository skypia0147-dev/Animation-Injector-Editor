import type {ReactNode} from 'react';
import {
  strikeAreaKeys,
  strikeChoices,
  strikeExtras,
  strikePush,
  strikeStagger,
  settingDefault,
  settingLabels,
  settingRange,
} from '../../eventRegistry.ts';
import {DetailRow} from './DetailRow.tsx';
import {NumberInput} from './NumberInput.tsx';
import {tr} from '../../i18n/korean.ts';

/** The strike's area seen from above (mockup ⑦): the actor facing up, the wedge its angle (360 = the whole circle)
 *  and its size the radius, growing up to 600 and drawn full beyond. */
export function StrikeAreaShape({angle, radius}: {angle: number; radius: number}) {
  const cx = 32,
    cy = 34,
    full = 27;
  const r = 8 + (full - 8) * Math.min(1, Math.sqrt(Math.max(0, radius) / 600));
  const a = Math.min(360, Math.max(1, angle));
  const point = (deg: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
  };
  const wedge =
    a >= 360
      ? undefined
      : `M${cx} ${cy} L${point(-a / 2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 ${a > 180 ? 1 : 0} 1 ${point(a / 2)} Z`;
  return (
    <svg
      className="strike-area-shape"
      width="64"
      height="64"
      viewBox="0 0 64 64"
      role="img"
      aria-label={tr('범위를 위에서 본 모양: 반경 {radius}, 각 {angle}°', {radius: String(radius), angle: String(a)})}
    >
      <circle cx={cx} cy={cy} r={full} fill="none" className="outline" />
      {wedge ? <path d={wedge} className="area" /> : <circle cx={cx} cy={cy} r={r} className="area" />}
      <circle cx={cx} cy={cy} r={3.5} className="actor" />
      <path d={`M${cx} ${cy - 3.5} V${cy - 10}`} className="facing" />
    </svg>
  );
}

/** A strike's settings (runtime 0.12.293, docs/mockup-strike): whom it hits, how much, and for how long, each
 *  group a few rows. `kinds` shows whom and how (the registry's part), `numbers` the numbers (a node's part); a
 *  clip-time strike shows both. Values are strings like the XML; a default is left unset. */
export function StrikeFields({
  values: v,
  set,
  setMany,
  kinds,
  numbers,
}: {
  values: Record<string, string>;
  set: (key: string, value: string | undefined) => void;
  setMany: (patch: Record<string, string | undefined>) => void;
  kinds: boolean;
  numbers: boolean;
}) {
  const area = (v.pick ?? 'combatTarget') === 'area',
    fixed = v.amount !== undefined && v.amount !== '';
  const seg = (key: string) => {
    const choices = strikeChoices[key](),
      current = v[key] ?? choices[0][0];
    const pick = (value: string) => {
      const first = value === choices[0][0];
      // Leaving the area drops its own settings; another reaction its strength or force.
      if (key === 'pick' && value !== 'area')
        setMany({pick: first ? undefined : value, ...Object.fromEntries(strikeAreaKeys.map(k => [k, undefined]))});
      else if (key === 'reaction')
        setMany({reaction: first ? undefined : value, strength: undefined, force: undefined});
      else set(key, first ? undefined : value);
    };
    // Three or more choices are a list (mockup ⑦): a row of buttons would run past the card.
    if (choices.length > 2)
      return (
        <select aria-label={settingLabels[key]} value={current} onChange={e => pick(e.target.value)}>
          {choices.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      );
    return (
      <span className="moment-seg" role="group" aria-label={settingLabels[key]}>
        {choices.map(([value, text]) => (
          <button key={value} type="button" aria-pressed={current === value} onClick={() => pick(value)}>
            {text}
          </button>
        ))}
      </span>
    );
  };
  // A number box; `scale` shows a fraction as a percent (ratio 1.2 = 120%).
  const num = (key: string, scale = 1) => {
    const [min, max] = settingRange(key) ?? [0, 600],
      def = Number(settingDefault[key] ?? 0);
    const value = v[key] === undefined || v[key] === '' ? def : Number(v[key]);
    return (
      <NumberInput
        aria-label={settingLabels[key]}
        className="strike-number"
        min={min * scale}
        max={max * scale}
        step={scale === 1 ? 10 : 5}
        value={Math.round(value * scale * 100) / 100}
        change={next => {
          const stored = Math.min(max, Math.max(min, next / scale));
          set(key, stored === def ? undefined : String(Math.round(stored * 10000) / 10000));
        }}
      />
    );
  };
  const group = (title: string, rows: ReactNode[]) =>
    rows.some(Boolean) && (
      <>
        <div className="strike-gap" role="separator" aria-label={title} />
        {rows}
      </>
    );
  return (
    <>
      {group(tr('누구에게'), [
        kinds && (
          <DetailRow key="pick" label={settingLabels.pick}>
            {seg('pick')}
          </DetailRow>
        ),
        // The area (mockup ⑦): its shape from above on the left, radius·angle and up·down in two lines on the right.
        numbers && area && (
          <div key="area" className="strike-area">
            <StrikeAreaShape
              angle={Number(v.angle ?? settingDefault.angle)}
              radius={Number(v.radius ?? settingDefault.radius)}
            />
            <span className="strike-pair">
              <span>{tr('반경')}</span>
              {num('radius')}
              <span title={tr('각은 바라보는 방향 기준 전체 폭입니다. 360이면 원입니다.')}>{tr('각')}</span>
              {num('angle')}
              <span>°</span>
              <span title={tr('공격자의 발 높이를 0으로, 대상의 발 높이로 잽니다.')}>{tr('위')}</span>
              {num('up')}
              <span title={tr('공격자의 발 높이를 0으로, 대상의 발 높이로 잽니다.')}>{tr('아래')}</span>
              {num('down')}
              <span />
            </span>
          </div>
        ),
        kinds && area && (
          <DetailRow key="hit" label={settingLabels.hit}>
            {seg('hit')}
          </DetailRow>
        ),
      ])}
      {group(tr('얼마나'), [
        numbers && (
          <DetailRow
            key="damage"
            label={tr('피해')}
            hint={tr('무기 데미지는 엔진이 그 무기로 때릴 때의 피해(기술·특성·대상 방어구 포함)에 곱합니다.')}
          >
            <span className="strike-inline">
              <span className="moment-seg" role="group" aria-label={tr('피해 기준')}>
                <button
                  type="button"
                  aria-pressed={!fixed}
                  onClick={() => fixed && setMany({amount: undefined, ratio: undefined})}
                >
                  {tr('무기 데미지')}
                </button>
                <button
                  type="button"
                  aria-pressed={fixed}
                  onClick={() => !fixed && setMany({amount: settingDefault.amount, ratio: undefined})}
                >
                  {tr('고정값')}
                </button>
              </span>
              {fixed ? num('amount') : <>{num('ratio', 100)}%</>}
            </span>
          </DetailRow>
        ),
        kinds && !(numbers && fixed) && (
          <DetailRow key="hand" label={settingLabels.hand}>
            {seg('hand')}
          </DetailRow>
        ),
        numbers && area && (
          <DetailRow
            key="edge"
            label={tr('감쇠')}
            hint={tr('반경 끝에서 남는 비율입니다. 피해와 반응 세기에 함께 적용합니다.')}
          >
            <span className="strike-inline">
              {tr('가장자리')} {num('edge', 100)}% <small>{tr('피해·반응')}</small>
            </span>
          </DetailRow>
        ),
        kinds && !(numbers && fixed) && (
          <DetailRow key="block" label={settingLabels.block}>
            {seg('block')}
          </DetailRow>
        ),
      ])}
      {group(tr('맞은 뒤'), [
        kinds && (
          <DetailRow key="reaction" label={settingLabels.reaction}>
            {seg('reaction')}
          </DetailRow>
        ),
        numbers && v.reaction === 'stagger' && (
          <DetailRow
            key="strength"
            label={tr('경직 세기')}
            hint={tr('0은 작은 경직, 1은 큰 경직입니다. 감쇠가 곱해집니다.')}
          >
            <NumberInput
              aria-label={tr('경직 세기')}
              className="strike-number"
              min={0}
              max={1}
              step={0.1}
              value={v.strength === undefined || v.strength === '' ? strikeStagger : Number(v.strength)}
              change={next => {
                const value = Math.min(1, Math.max(0, next));
                set('strength', value === strikeStagger ? undefined : String(value));
              }}
            />
          </DetailRow>
        ),
        numbers && v.reaction === 'push' && (
          <DetailRow
            key="force"
            label={tr('밀쳐내는 힘')}
            hint={tr('래그돌과 같은 힘(0~20)입니다. 감쇠가 곱해집니다.')}
          >
            <NumberInput
              aria-label={tr('밀쳐내는 힘')}
              className="strike-number"
              min={0}
              max={20}
              step={0.5}
              value={v.force === undefined || v.force === '' ? strikePush : Number(v.force)}
              change={next => {
                const value = Math.min(20, Math.max(0, next));
                set('force', value === strikePush ? undefined : String(value));
              }}
            />
          </DetailRow>
        ),
        kinds && (
          <DetailRow
            key="without"
            label={settingLabels.without}
            hint={tr(
              '진짜 타격처럼 함께 일어나는 것입니다. 마법부여·독·특성 효과는 무기 데미지 방식에서만 일어납니다.'
            )}
          >
            <span className="strike-extras">
              {strikeExtras().map(([key, text]) => {
                const off = new Set((v.without ?? '').split(',').filter(Boolean));
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={!off.has(key)}
                      onChange={e => {
                        if (e.target.checked) off.delete(key);
                        else off.add(key);
                        const list = strikeExtras()
                          .map(([k]) => k)
                          .filter(k => off.has(k))
                          .join(',');
                        set('without', list || undefined);
                      }}
                    />
                    {text}
                  </label>
                );
              })}
            </span>
          </DetailRow>
        ),
      ])}
      {group(tr('때'), [
        numbers && (
          <DetailRow
            key="duration"
            label={tr('구간')}
            hint={tr('0이면 한 순간입니다. 0보다 크면 그동안 범위에 들어온 대상을 한 명당 한 번씩 맞힙니다.')}
          >
            <span className="strike-inline">
              <NumberInput
                aria-label={tr('구간')}
                className="strike-number"
                min={0}
                max={30}
                step={0.05}
                value={Number(v.duration ?? 0)}
                change={next => set('duration', next > 0 ? String(Math.min(30, next)) : undefined)}
              />
              {tr('초')}
            </span>
          </DetailRow>
        ),
      ])}
    </>
  );
}
