import type {QteDesign, QteType} from '../qte.ts';

// A small picture of a QTE's look (10-18, docs/mockup-qte-redesign): the card's face and the type tiles.
// Only a sign of the type, not the preview: QtePreview draws the real thing.
export function QteGlyph({
  type = 'splitArc',
  design,
  pressCount = 10,
  label = '',
  size = 48,
}: {
  type?: QteType;
  design?: QteDesign;
  pressCount?: number;
  label?: string;
  size?: number;
}) {
  const ink = '#f0f1df',
    green = '#a1c8ad',
    gold = '#f2d795',
    dim = '#f0f1df66';
  const text = label && (
    <text
      x="50"
      y={type === 'timingBar' ? 82 : 51}
      textAnchor="middle"
      dominantBaseline="middle"
      fill={ink}
      fontSize={label.length > 2 ? 17 : 22}
      fontWeight="600"
    >
      {label}
    </text>
  );
  let body;
  if (type === 'splitArc' && design === 'converge')
    body = (
      <>
        <path d="M50 14 L86 50 L50 86 L14 50 Z" fill="none" stroke={ink} strokeWidth="3" />
        <path d="M2 50 H24 M76 50 H98" stroke={dim} strokeWidth="2.5" />
        {text}
      </>
    );
  else if (type === 'splitArc')
    body = (
      <>
        <circle cx="50" cy="50" r="44" fill="none" stroke={dim} strokeWidth="3" />
        <circle cx="50" cy="50" r="32" fill="none" stroke={green} strokeWidth="3.5" />
        {text}
      </>
    );
  else if (type === 'timingBar')
    body = (
      <>
        <rect x="6" y="34" width="88" height="16" rx="3" fill="#2b3030" />
        <rect x="56" y="34" width="18" height="16" fill="#4c6b54" />
        <rect x="40" y="27" width="3.5" height="30" fill={ink} />
        {text}
      </>
    );
  else if (type === 'rotatingNeedle')
    body = (
      <>
        <circle cx="50" cy="50" r="40" fill="none" stroke={dim} strokeWidth="3" />
        <path d="M86 34 A40 40 0 0 1 88 62" fill="none" stroke={green} strokeWidth="6" />
        <path d="M50 50 L82 30" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
        {text && <g transform="translate(0 28) scale(0.8) translate(12 0)">{text}</g>}
      </>
    );
  else if (type === 'holdRelease')
    body = (
      <>
        <circle cx="50" cy="50" r="40" fill="none" stroke={dim} strokeWidth="3" />
        <path d="M50 10 A40 40 0 1 1 14 66" fill="none" stroke={gold} strokeWidth="5" />
        {text}
      </>
    );
  else if (type === 'rapidPress' && pressCount === 1)
    body = (
      <>
        <rect x="18" y="28" width="64" height="44" rx="8" fill="#2b3030" stroke={ink} strokeWidth="3" />
        {text}
      </>
    );
  else if (type === 'rapidPress')
    body = (
      <>
        {[44, 36, 28].map((r, i) => (
          <circle
            key={r}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={ink}
            strokeOpacity={0.3 + i * 0.25}
            strokeWidth="3"
          />
        ))}
        {text}
      </>
    );
  else
    body = (
      <>
        {[6, 38, 70].map((x, i) => (
          <rect
            key={x}
            x={x}
            y="34"
            width="24"
            height="30"
            rx="4"
            fill="#2b3030"
            stroke={i === 0 ? green : dim}
            strokeWidth="3"
          />
        ))}
      </>
    );
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{flex: 'none'}}>
      {body}
    </svg>
  );
}
