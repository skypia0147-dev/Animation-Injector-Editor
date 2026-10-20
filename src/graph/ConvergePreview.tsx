import {useId} from 'react';
import type {QteNode, Outcome} from '../qte.ts';
import {
  ashCount,
  ashOf,
  clamp01,
  convergeFocus,
  convergeHead,
  convergeTiming,
  convergeUi,
  easeIn,
  easeOut,
  easeOut5,
  fly,
  glowGain,
  hash,
  keyColor,
  quality,
  sparkCount,
  sparkOf,
} from '../qteConverge.ts';
// The converging lines as the game draws them (runtime 0.12.246 ui/QteMenu.cpp DrawConverge), in drawing units:
// pixels at 1080 lines, the middle at 0. Lights are added onto what lies beneath (the game's additive layer).
const warm = '#FFF0D7',
  gold = '#FFD08C';
type Props = {
  q: QteNode;
  /** Seconds since the run began, and since the result. */
  elapsed: number;
  sinceResult: number;
  outcome: Outcome | null;
  session: number;
  reach: number;
  /** The screen's edges around the middle: left, top, right, bottom. */
  bounds: [number, number, number, number];
  keyLabel: string;
  keyScale: number;
};
type Band = {x0: number; x1: number; y: number; h: number; stops: [number, string, number][]};
export function ConvergePreview({
  q,
  elapsed,
  sinceResult: rt,
  outcome,
  session,
  reach,
  bounds,
  keyLabel,
  keyScale,
}: Props) {
  const id = useId().replace(/:/g, '');
  const ui = convergeUi(q, outcome, rt),
    focus = convergeFocus(q, outcome, rt, elapsed),
    timing = convergeTiming(q),
    head = convergeHead(q, elapsed);
  const [left, top, right, bottom] = bounds;
  const bands: Band[] = [],
    glows: {x: number; y: number; r: number; color: string; alpha: number}[] = [],
    lines: {d: string; color: string; alpha: number; width: number}[] = [],
    dots: {x: number; y: number; r: number; color: string; alpha: number}[] = [];
  const diamond = (r: number, width: number, color: string, alpha: number) =>
    alpha > 0.002 && lines.push({d: `M${-r} 0 L0 ${-r} L${r} 0 L0 ${r} Z`, color, alpha, width});
  const tail = (xe: number, xh: number, a: number) => {
    const dir = xh >= xe ? 1 : -1,
      len = Math.abs(xh - xe);
    if (len < 2 || a <= 0) return;
    const x0 = len > 1000 ? xh - dir * 1000 : xe;
    bands.push({
      x0,
      x1: xh,
      y: 0,
      h: 1.2,
      stops: [
        [0, warm, 0],
        [0.75, warm, 0.18 * a],
        [1, warm, 0.55 * a],
      ],
    });
    bands.push({
      x0: xh - dir * Math.min(len, 190),
      x1: xh,
      y: 0,
      h: 2.6,
      stops: [
        [0, warm, 0],
        [1, warm, a],
      ],
    });
    for (const oy of [-6, 6])
      bands.push({
        x0: xh - dir * Math.min(len, 420),
        x1: xh - dir * Math.min(len, 30),
        y: oy,
        h: 1,
        stops: [
          [0, warm, 0],
          [1, warm, 0.13 * a],
        ],
      });
    glows.push({x: xh, y: 0, r: 24, color: warm, alpha: 0.45 * a});
    dots.push({x: xh, y: 0, r: 2.4, color: '#FFFFFF', alpha: a});
  };
  if (ui > 0) {
    bands.push({
      x0: -reach,
      x1: 0,
      y: 0,
      h: 1,
      stops: [
        [0, warm, 0],
        [1, warm, 0.07 * ui],
      ],
    });
    bands.push({
      x0: 0,
      x1: reach,
      y: 0,
      h: 1,
      stops: [
        [0, warm, 0.07 * ui],
        [1, warm, 0],
      ],
    });
    if (!outcome) {
      const wp = (reach * timing.perfect) / timing.approach,
        wg = (reach * timing.success) / timing.approach;
      for (const side of [-1, 1]) {
        if (wp > 0) lines.push({d: `M${side * wp} -7 V7`, color: warm, alpha: 0.38 * ui, width: 1});
        lines.push({d: `M${side * wg} -3.5 V3.5`, color: warm, alpha: 0.16 * ui, width: 1});
      }
      if (head > 0) {
        const a = 0.55 + 0.45 * easeIn(head);
        tail(-reach, -reach * (1 - head), a);
        tail(reach, reach * (1 - head), a);
      }
      diamond(38, 1.3, warm, 0.75 * ui);
      if (head > 0) diamond(Math.max(4, 38 + 130 * (1 - head)), 1, warm, 0.5 * easeIn(head));
    } else if (outcome !== 'failure') {
      const k = quality(outcome),
        fl = Math.exp(-rt * 3.2) * k,
        hl = reach * easeOut5(rt / 0.16);
      if (hl > 1) {
        bands.push({
          x0: -hl,
          x1: hl,
          y: 0,
          h: 2.4,
          stops: [
            [0, gold, 0],
            [0.5, '#FFFAF0', fl],
            [1, gold, 0],
          ],
        });
        bands.push({
          x0: -hl,
          x1: hl,
          y: 0,
          h: 20,
          stops: [
            [0, gold, 0],
            [0.5, '#FFFAF0', fl * 0.16],
            [1, gold, 0],
          ],
        });
      }
      glows.push({x: 0, y: 0, r: 110, color: gold, alpha: 0.8 * k * Math.exp(-rt * 5)});
      glows.push({x: 0, y: 0, r: 28, color: '#FFFFFF', alpha: k * Math.exp(-rt * 7)});
      const vs = 120 * k * Math.exp(-rt * 6);
      if (vs > 0.5) lines.push({d: `M0 ${-vs} V${vs}`, color: '#FFF8EB', alpha: Math.exp(-rt * 6), width: 1.4});
      for (let i = 0; i < sparkCount(outcome); i++) {
        const s = sparkOf(session, i, outcome);
        if (rt >= s.life) continue;
        const p = fly(0, 0, s.vx, s.vy, 3.2, 60, rt);
        lines.push({
          d: `M${p.x} ${p.y} L${p.x - p.vx * 0.025} ${p.y - p.vy * 0.025}`,
          color: gold,
          alpha: 1 - rt / s.life,
          width: 1.3,
        });
      }
      const e = easeOut(rt / 0.55);
      diamond(38 * (1 + 1.7 * e), 1.5, gold, (1 - e) * k);
      diamond(38, 1.3, gold, 0.85 * ui);
    } else {
      const xl = -reach * (1 - head),
        xr = reach * (1 - head);
      const flicker = rt < 0.2 ? (hash(9, Math.floor(rt * 50)) > 0.45 ? 1 : 0.25) : 1,
        a = flicker * (1 - easeOut((rt - 0.12) / 0.45));
      tail(-reach, xl, a);
      tail(reach, xr, a);
      if (rt > 0.12) {
        const age = rt - 0.12,
          span = Math.min(800, reach * head);
        for (let i = 0; i < ashCount; i++) {
          const f = ashOf(session, i);
          if (age >= f.life) continue;
          const back = f.back * span,
            alpha = clamp01((age - (back / 800) * 0.35) * 6) * (1 - age / f.life) * 0.75;
          if (alpha <= 0) continue;
          const p = fly(f.side > 0 ? xl - back : xr + back, f.y, f.vx, f.vy, 0.6, -6, age);
          dots.push({x: p.x + Math.sin(rt * 2 + f.wobble) * 3, y: p.y, r: 0.85, color: '#CDC3B4', alpha});
        }
      }
      const sp = 9 * easeOut(rt / 0.4),
        da = ui * (1 - easeOut((rt - 0.25) / 1));
      if (da > 0.002)
        for (const side of [-1, 1])
          lines.push({
            d: `M${-38 - sp * 0.3} ${side * sp} L0 ${side * (38 + sp)} L${38 + sp * 0.3} ${side * sp}`,
            color: rt < 0.35 ? '#E68C78' : '#AAA096',
            alpha: 0.8 * da,
            width: 1.3,
          });
    }
  }
  return (
    <g>
      <defs>
        <radialGradient id={id + 'f'} cx={0} cy={-60} r={1250} fx={0} fy={-60} gradientUnits="userSpaceOnUse">
          <stop offset={0.2} stopColor="#000" stopOpacity={0} />
          <stop offset={1} stopColor="#000" stopOpacity={0.85 * focus} />
        </radialGradient>
        <linearGradient id={id + 'b'} x1={0} y1={-190} x2={0} y2={190} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#000" stopOpacity={0} />
          <stop offset={0.5} stopColor="#000" stopOpacity={0.42 * focus} />
          <stop offset={1} stopColor="#000" stopOpacity={0} />
        </linearGradient>
        {bands.map((b, i) => (
          <linearGradient key={i} id={id + 'l' + i} x1={b.x0} x2={b.x1} y1={0} y2={0} gradientUnits="userSpaceOnUse">
            {b.stops.map(([at, color, alpha], j) => (
              <stop key={j} offset={at} stopColor={color} stopOpacity={clamp01(alpha)} />
            ))}
          </linearGradient>
        ))}
        {glows.map((g, i) => (
          <radialGradient key={i} id={id + 'g' + i}>
            <stop offset={0} stopColor={g.color} stopOpacity={clamp01(g.alpha * glowGain)} />
            <stop offset={1} stopColor={g.color} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {focus > 0.002 && (
        <>
          <rect x={left} y={top} width={right - left} height={bottom - top} fill={`url(#${id}f)`} />
          <rect x={left} y={-190} width={right - left} height={380} fill={`url(#${id}b)`} />
        </>
      )}
      <g style={{mixBlendMode: 'plus-lighter'}}>
        {bands.map((b, i) => (
          <rect
            key={i}
            x={Math.min(b.x0, b.x1)}
            y={b.y - b.h / 2}
            width={Math.abs(b.x1 - b.x0)}
            height={b.h}
            fill={`url(#${id}l${i})`}
          />
        ))}
        {glows.map((g, i) => g.alpha > 0.002 && <circle key={i} cx={g.x} cy={g.y} r={g.r} fill={`url(#${id}g${i})`} />)}
        {lines.map((l, i) => (
          <path
            key={i}
            d={l.d}
            fill="none"
            stroke={l.color}
            strokeOpacity={clamp01(l.alpha)}
            strokeWidth={l.width}
            strokeLinecap="round"
          />
        ))}
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} fillOpacity={clamp01(d.alpha)} />
        ))}
      </g>
      {ui > 0 && (
        <text
          y={10}
          textAnchor="middle"
          fill={keyColor(outcome)}
          fillOpacity={ui}
          fontSize={30}
          fontWeight={600}
          transform={`scale(${keyScale})`}
          style={{fontFamily: "'Arial Narrow', sans-serif"}}
        >
          {keyLabel}
        </text>
      )}
    </g>
  );
}
