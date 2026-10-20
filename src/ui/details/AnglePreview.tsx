import {t} from '../../i18n/index.ts';
export function AnglePreview({angle}: {angle: number}) {
  const degrees = Math.max(0, Math.min(360, Number.isFinite(angle) ? angle : 0));
  const half = (degrees * Math.PI) / 360,
    x = 32 * Math.sin(half),
    y = -32 * Math.cos(half);
  return (
    <svg width="82" height="82" viewBox="-41 -41 82 82" role="img" aria-label={t('row.angle') + ' ' + degrees + '°'}>
      <circle r="32" fill="none" stroke="var(--ue-line2)" />
      {degrees >= 360 ? (
        <circle r="32" fill="var(--ue-select)" opacity=".3" />
      ) : (
        <path
          d={`M0 0 L${-x} ${y} A32 32 0 ${degrees > 180 ? 1 : 0} 1 ${x} ${y} Z`}
          fill="var(--ue-select)"
          opacity=".3"
        />
      )}
      <path d="M0 8V-24 M-4-18L0-24 4-18" fill="none" stroke="var(--ue-select)" />
      <circle r="3" fill="var(--ue-text)" />
    </svg>
  );
}
