import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {QteNode} from '../qte.ts';
import {qteBoundsOf, qteKeyWidth, qteLayout} from '../qteLayout.ts';
import {gamepadButtons} from '../ui/details/KeyField.tsx';
import {QteGamepad} from '../qteGamepad.ts';
import {gameControlDefaults, gameControlLabel, gamepadNames} from '../keys.ts';
import {qteFaceMode, qteLook, singleScale, pressSeconds, qteKeyName} from '../qteFace.ts';
import {convergeFlash, convergeReach, hash, quality} from '../qteConverge.ts';
import {ConvergePreview} from './ConvergePreview.tsx';
import {
  previewInitial,
  previewAdvance,
  previewInput,
  previewProgress,
  previewGauge,
  qteTarget,
  type QtePreviewState,
} from '../qtePreview.ts';
import {tr} from '../i18n/korean.ts';
const tau = Math.PI * 2,
  clamp = (v: number) => Math.max(0, Math.min(1, v));
const arc = (r: number, a: number, b: number) => {
  const pts = Array.from({length: 65}, (_, i) => {
    const t = a + ((b - a) * i) / 64;
    return `${i ? 'L' : 'M'} ${r * Math.cos(t)} ${r * Math.sin(t)}`;
  });
  return pts.join(' ');
};
function KeyGlyph({
  label,
  scale,
  color,
  alpha,
  flash,
}: {
  label: string;
  scale: number;
  color: string;
  alpha: number;
  flash: number;
}) {
  if (alpha <= 0) return null;
  // A mouse button is a keycap named LMB, RMB or MMB like any key (runtime 0.12.258).
  const w = qteKeyWidth(label);
  return (
    <g transform={`scale(${scale})`} opacity={alpha}>
      <rect
        x={-w / 2}
        y={-15}
        width={w}
        height={30}
        rx={label.startsWith('Pad') || label === 'RT' ? 12 : 5}
        fill={color}
        fillOpacity={0.06}
        stroke={color}
        strokeWidth={2}
      />
      {flash > 0 && <rect x={-w / 2} y={-15} width={w} height={30} rx={5} fill="#F0F1DF" fillOpacity={flash} />}
      <text y={5} textAnchor="middle" fill={color} fontSize={15} fontWeight={600}>
        {label}
      </text>
    </g>
  );
}
// `move` lets the QTE be dragged on the screen (10-18, docs/mockup-qte-redesign): it gets the new x and y of the QTE's
// anchor once the drag ends (the drawing follows the pointer meanwhile).
export function QtePreview({q, move}: {q: QteNode; move?: (x: number, y: number) => void}) {
  const [expanded, setExpanded] = useState(false);
  const [dragged, setDragged] = useState<{x: number; y: number}>();
  const [padPreview, setPadPreview] = useState(false),
    [padConnected, setPadConnected] = useState(false);
  const width = 1920,
    height = 1080;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
  }, [expanded]);
  const [state, setState] = useState(previewInitial),
    [play, setPlay] = useState(false),
    [sinceResult, setSinceResult] = useState(0),
    ref = useRef<QtePreviewState>(state),
    last = useRef(0),
    session = useRef(1);
  // A one-press QTE plays its press once pressed; any other plays its result while the game shows it (runtime Qte.cpp
  // hides it after max(feedback, delay)).
  const resultSeconds = qteFaceMode(q) === 'single' ? pressSeconds : Math.max(q.feedback ?? 1.35, q.delay ?? 0);
  const update = (s: QtePreviewState) => {
    const fresh = s.outcome && !ref.current.outcome;
    ref.current = s;
    setState(s);
    if (s.outcome) setPlay(false);
    // Frames until the result has gone.
    if (fresh) {
      const start = performance.now();
      const step = () => {
        const t = (performance.now() - start) / 1000;
        setSinceResult(t);
        if (t < resultSeconds + 0.05) requestAnimationFrame(step);
      };
      setSinceResult(0);
      requestAnimationFrame(step);
    }
  };
  const advance = () => {
    const now = performance.now(),
      s = previewAdvance(ref.current, (now - last.current) / 1000, q);
    last.current = now;
    return s;
  };
  useEffect(() => {
    setPlay(false);
    ref.current = previewInitial();
    setState(ref.current);
  }, [q]);
  useEffect(() => {
    if (!play) return;
    let frame = 0;
    const tick = () => {
      update(advance());
      if (!ref.current.outcome) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [play, q]);
  const input = (up = false, expected = true) => {
    if (play) update(previewInput(advance(), q, up, expected));
  };
  useEffect(() => {
    if (!play) return;
    const tracker = new QteGamepad();
    let frame = 0,
      holding = '';
    const tick = () => {
      const sample = tracker.poll(navigator.getGamepads?.() ?? []);
      setPadConnected(sample.connected);
      if (sample.disconnected && holding) {
        setPlay(false);
        return;
      }
      for (const e of sample.edges) {
        const binding = q.control ? (gamepadNames[gameControlDefaults[q.control].pad] ?? 0) : q.gamepad,
          sequence = q.type === 'keySequence';
        if (sequence ? !(q.sequence ?? []).some(k => k.gamepad === e.code) : e.code !== binding) continue;
        const token = e.pad + ':' + e.code;
        if (e.up) {
          if (q.type === 'holdRelease' && holding === token) {
            holding = '';
            input(true);
          }
          continue;
        }
        setPadPreview(true);
        if (q.type === 'holdRelease') {
          if (holding) continue;
          holding = token;
        }
        input(false, !sequence || q.sequence?.[ref.current.completed]?.gamepad === e.code);
        if (ref.current.outcome) break;
      }
      if (!ref.current.outcome) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [play, q]);
  const p = clamp(previewProgress(state, q)),
    g = clamp(previewGauge(state, q)),
    type = q.type ?? 'splitArc',
    t = qteTarget;
  const green = '#A1C8AD',
    gold = '#F2D795',
    white = '#F0F1DF',
    dim = '#59615F',
    c =
      state.outcome === 'failure'
        ? '#EF9590'
        : state.outcome === 'perfect'
          ? gold
          : state.outcome === 'success'
            ? green
            : white;
  // The converging lines: how far they start, the screen's edges around the middle, the camera's shake and the flash.
  const converge = qteFaceMode(q) === 'converge',
    rt = state.outcome ? sinceResult : 0,
    shake =
      !converge || !state.outcome || q.reducedMotion
        ? 0
        : state.outcome === 'failure'
          ? 7 * Math.exp(-rt * 9)
          : 6 * quality(state.outcome) * Math.exp(-rt * 14),
    frame = Math.floor(rt * 60),
    shakeX = shake > 0.05 ? (hash(11, frame) - 0.5) * shake * 2 : 0,
    shakeY = shake > 0.05 ? (hash(12, frame) - 0.5) * shake * 2 : 0;
  const padName = (code: number) =>
    code ? 'Pad ' + (gamepadButtons.find(([, value]) => value === code)?.[0] ?? code) : '';
  // Keys as the game names them (Mouse1 is LMB, runtime KeyLabel).
  const keyLabel = (key: string, code: number) => (padPreview ? padName(code) || '—' : qteKeyName(key) || '—');
  const status = state.outcome
    ? {success: 'SUCCESS', failure: 'FAILED', perfect: 'PERFECT'}[state.outcome]
    : type === 'holdRelease'
      ? state.holding
        ? 'RELEASE IN TARGET'
        : 'HOLD, THEN RELEASE'
      : type === 'rapidPress'
        ? `TAP REPEATEDLY ${state.completed} / ${q.pressCount ?? 10}`
        : type === 'keySequence'
          ? `PRESS IN ORDER ${state.completed} / ${q.sequence?.length ?? 0}`
          : 'PRESS IN TARGET';
  const n = q.sequence?.length ?? 0,
    angle = p * tau - tau / 4;
  // The result as the game draws it (runtime QteMenu.cpp Draw, 10-19: the preview showed only the colour): the
  // circle's ring spreads out and fades over 85% of the result time, a perfect adds an inner ring, and every other
  // type fades out over the result time.
  const feedback = Math.max(0.001, q.feedback ?? 1.35),
    fade = state.outcome ? 1 - clamp(rt / feedback) : 1,
    spread = q.reducedMotion ? 0.28 : clamp(rt / (feedback * 0.85)),
    eased = 1 - (1 - spread) ** 3;
  // The circle shows its key in the middle and no text; a one-press QTE is its key alone (qteFace.ts).
  const face = qteFaceMode(q),
    look = qteLook(q, state.outcome, sinceResult),
    keyFace = q.control
      ? padPreview
        ? gameControlDefaults[q.control].pad || '—'
        : qteKeyName(gameControlDefaults[q.control].key) || '—'
      : padPreview
        ? padName(q.gamepad) || '—'
        : qteKeyName(q.key) || '—';
  // Placed by what this QTE draws, its key included (runtime QteLayout::BoundsOf).
  const placement = qteLayout(
    width,
    height,
    q.scale,
    dragged?.x ?? q.x,
    dragged?.y ?? q.y,
    q.anchor ?? 'screen',
    qteBoundsOf(face, type, q.sequence?.length ?? 0, qteKeyWidth(keyFace))
  );
  const content = (
    <>
      {q.hidden && (
        <p className="qte-preview-hidden">
          {tr('게임에서는 화면에 표시되지 않습니다. 미리보기는 입력 확인용으로 흐리게 보여 줍니다.')}
        </p>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          opacity: q.hidden ? 0.35 : undefined,
          display: 'block',
          width: expanded ? `min(100%, ${(width / height) * 60}vh)` : '100%',
          height: 'auto',
          aspectRatio: `${width} / ${height}`,
          margin: '0 auto',
          background: '#111415',
          border: '1px solid var(--ue-line2)',
        }}
        aria-label={tr('QTE 유형·위치·크기 미리보기')}
        className={move ? 'qte-preview-screen movable' : 'qte-preview-screen'}
        onPointerDown={e => {
          if (!move || e.button !== 0) return;
          const svg = e.currentTarget,
            rect = svg.getBoundingClientRect(),
            perPixel = width / rect.width,
            anchor = q.anchor ?? 'screen',
            start = {x: e.clientX, y: e.clientY, qx: q.x, qy: q.y};
          // A corner holds its near edge: moving toward the screen's inside is positive (qteLayout).
          const signX = anchor === 'topRight' || anchor === 'bottomRight' ? -1 : 1,
            signY = anchor === 'bottomLeft' || anchor === 'bottomRight' ? -1 : 1;
          const at = (ev: PointerEvent) => {
            const dx = (ev.clientX - start.x) * perPixel,
              dy = (ev.clientY - start.y) * perPixel;
            const round = (v: number) => Math.round(v * 1000) / 1000;
            return anchor === 'screen'
              ? {x: round(clamp(start.qx + dx / width)), y: round(clamp(start.qy + dy / height))}
              : {
                  x: round(Math.max(-1, Math.min(1, start.qx + (signX * dx) / height))),
                  y: round(Math.max(-1, Math.min(1, start.qy + (signY * dy) / height))),
                };
          };
          let last: {x: number; y: number} | undefined;
          const moved = (ev: PointerEvent) => {
            last = at(ev);
            setDragged(last);
          };
          const done = () => {
            window.removeEventListener('pointermove', moved);
            window.removeEventListener('pointerup', done);
            window.removeEventListener('pointercancel', done);
            setDragged(undefined);
            if (last) move(last.x, last.y);
          };
          window.addEventListener('pointermove', moved);
          window.addEventListener('pointerup', done);
          window.addEventListener('pointercancel', done);
        }}
      >
        <g
          transform={`translate(${placement.x + shakeX} ${placement.y + shakeY}) scale(${placement.unit})`}
          fill="none"
        >
          {converge && (
            <>
              <ConvergePreview
                q={q}
                elapsed={state.elapsed}
                sinceResult={rt}
                outcome={state.outcome}
                session={session.current}
                reach={convergeReach(width, placement.x, placement.unit)}
                bounds={[
                  -placement.x / placement.unit,
                  -placement.y / placement.unit,
                  (width - placement.x) / placement.unit,
                  (height - placement.y) / placement.unit,
                ]}
                keyLabel={keyFace}
                keyScale={look.scale}
              />
            </>
          )}
          {type === 'splitArc' && !converge && state.outcome && (
            <>
              <circle r={49 + 52 * eased} stroke={c} strokeWidth={3} opacity={1 - spread} />
              {state.outcome === 'perfect' && (
                <circle r={49 + 39 * eased} stroke={c} strokeWidth={2} opacity={(1 - spread) * 0.7} />
              )}
              <KeyGlyph label={keyFace} scale={1} color={c} alpha={look.alpha} flash={0} />
            </>
          )}
          {type === 'splitArc' && !converge && !state.outcome && (
            <>
              <circle r={49} stroke={green} strokeWidth={138 * q.successWindow} opacity={0.18} />
              {q.perfectWindow > 0 && (
                <circle r={49} stroke={gold} strokeWidth={138 * q.perfectWindow} opacity={0.35} />
              )}{' '}
              {Array.from({length: 8}, (_, i) => (
                <path
                  key={i}
                  d={arc(49, (i * tau) / 8 + 0.05, ((i + 1) * tau) / 8 - 0.05)}
                  stroke={green}
                  strokeWidth={3}
                />
              ))}
              <circle r={92 - 69 * p} stroke={c} strokeWidth={2} />
              <KeyGlyph label={keyFace} scale={1} color={c} alpha={1} flash={0} />
            </>
          )}
          {type === 'timingBar' && (
            <g opacity={fade}>
              <rect x={-120} y={-10} width={240} height={20} fill={dim} />
              <rect
                x={-120 + 240 * Math.max(0, t - q.successWindow)}
                y={-10}
                width={240 * (Math.min(1, t + q.successWindow) - Math.max(0, t - q.successWindow))}
                height={20}
                fill={green}
              />
              <rect
                x={-120 + 240 * (t - q.perfectWindow)}
                y={-10}
                width={480 * q.perfectWindow}
                height={20}
                fill={gold}
              />
              <path d={`M ${-120 + 240 * p} -18 v36`} stroke={c} strokeWidth={3} />
            </g>
          )}
          {(type === 'rotatingNeedle' || type === 'holdRelease') && (
            <g opacity={fade}>
              <circle r={66} stroke={dim} strokeWidth={3} />
              <path
                d={arc(
                  66,
                  Math.max(0, t - q.successWindow) * tau - tau / 4,
                  Math.min(1, t + q.successWindow) * tau - tau / 4
                )}
                stroke={green}
                strokeWidth={12}
              />
              {q.perfectWindow > 0 && (
                <path
                  d={arc(
                    66,
                    Math.max(0, t - q.perfectWindow) * tau - tau / 4,
                    Math.min(1, t + q.perfectWindow) * tau - tau / 4
                  )}
                  stroke={gold}
                  strokeWidth={12}
                />
              )}
              {type === 'holdRelease' ? (
                <path d={arc(54, -tau / 4, g * tau - tau / 4)} stroke={c} strokeWidth={5} />
              ) : (
                <path d={`M0 0 L${60 * Math.cos(angle)} ${60 * Math.sin(angle)}`} stroke={c} strokeWidth={3} />
              )}
            </g>
          )}
          {face === 'single' && (
            <KeyGlyph
              label={keyFace}
              scale={singleScale * look.scale}
              color={white}
              alpha={look.alpha}
              flash={look.flash}
            />
          )}
          {type === 'rapidPress' &&
            face !== 'single' &&
            Array.from({length: Math.min(20, q.pressCount ?? 10)}, (_, i) => {
              const count = Math.min(20, q.pressCount ?? 10),
                w = 240 / count;
              return (
                <rect
                  key={i}
                  x={-120 + i * w}
                  y={-10}
                  width={w - 3}
                  height={20}
                  fill={(i + 1) / count <= g ? c : dim}
                  opacity={fade}
                />
              );
            })}
          {type === 'keySequence' &&
            (q.sequence ?? []).map((k, i) => (
              <g key={i} opacity={fade}>
                <rect
                  x={-n * 22 + i * 44}
                  y={-20}
                  width={40}
                  height={40}
                  fill={i < state.completed ? green : dim}
                  opacity={0.3}
                />
                <text x={-n * 22 + i * 44 + 20} y={0} textAnchor="middle" fontSize={10} fill={white}>
                  {keyLabel(k.key, k.gamepad)}
                </text>
              </g>
            ))}
          {face === 'hint' && ['holdRelease', 'rapidPress', 'keySequence'].includes(type) ? (
            <g opacity={fade}>
              <path d="M-120 88 H120" stroke={dim} strokeWidth={2} />
              <path d={`M-120 88 H${-120 + 240 * (1 - p)}`} stroke={c} strokeWidth={2} />
            </g>
          ) : null}
          {face === 'hint' && type !== 'keySequence' && (
            <text y={116} textAnchor="middle" fill={white} fontSize={13}>
              {q.control ? gameControlLabel(q.control) + ' · ' + keyFace : keyLabel(q.key, q.gamepad)}
            </text>
          )}
          {face === 'hint' && (
            <text y={146} textAnchor="middle" fill={white} fontSize={13}>
              {status}
            </text>
          )}
        </g>
        {converge && convergeFlash(state.outcome, rt) > 0.002 && (
          <rect
            width={width}
            height={height}
            fill="#FFECCD"
            fillOpacity={convergeFlash(state.outcome, rt)}
            style={{mixBlendMode: 'plus-lighter'}}
          />
        )}
      </svg>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8}}>
        <select
          style={{width: 'auto', maxWidth: '100%', flex: '0 1 auto'}}
          aria-label={tr('미리보기 입력 표시')}
          value={padPreview ? 'pad' : 'key'}
          onChange={e => setPadPreview(e.target.value === 'pad')}
          title={tr(
            '컨트롤러를 연결하고 미리보기를 시작하면 실제 버튼으로 시험할 수 있습니다. 일반 공격 연동은 미리보기에서 RT, 게임에서는 사용자의 공격 버튼을 따릅니다.'
          )}
        >
          <option value="key">{tr('키보드·마우스')}</option>
          <option value="pad">{tr('컨트롤러')}</option>
        </select>
        <button
          onClick={() => {
            last.current = performance.now();
            session.current++;
            ref.current = previewInitial();
            setState(ref.current);
            setPlay(true);
          }}
        >
          {tr('미리보기')}
        </button>
        {type === 'holdRelease' ? (
          <button
            disabled={!play}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              input();
            }}
            onPointerUp={() => input(true)}
            onPointerCancel={() => {
              setPlay(false);
            }}
            onKeyDown={e => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                input();
              }
            }}
            onKeyUp={e => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                input(true);
              }
            }}
          >
            {tr('누른 뒤 놓기')}
          </button>
        ) : type === 'keySequence' ? (
          Array.from(new Set((q.sequence ?? []).map(k => k.key || 'Pad ' + k.gamepad))).map(key => (
            <button
              key={key}
              disabled={!play}
              onClick={() => {
                const expected = q.sequence?.[ref.current.completed];
                input(false, key === (expected?.key || 'Pad ' + expected?.gamepad));
              }}
            >
              {key}
            </button>
          ))
        ) : (
          <button disabled={!play} onClick={() => input()}>
            {face === 'single' ? tr('입력') : type === 'rapidPress' ? tr('연타') : tr('지금 입력')}
          </button>
        )}
        <span aria-live="polite">
          {state.outcome ? {success: tr('성공'), failure: tr('실패'), perfect: tr('완벽')}[state.outcome] : ''}
        </span>
        <button
          onClick={() => {
            if (expanded) dialog.current?.close();
            else setExpanded(true);
          }}
        >
          {expanded ? tr('닫기') : tr('확대 보기')}
        </button>
      </div>
      {play && padPreview && !padConnected && <span role="status">{tr('표준 컨트롤러 연결을 기다리는 중')}</span>}
      {placement.fitted && (
        <p role="status" style={{fontSize: 12}}>
          {tr('화면 안에 들어오도록 비율을 유지해 축소합니다.')}
        </p>
      )}
    </>
  );
  return (
    <div className="qte-preview" style={{border: '1px solid var(--ue-line2)', borderRadius: 8, padding: 8}}>
      {expanded ? <button onClick={() => dialog.current?.close()}>{tr('확대 미리보기 닫기')}</button> : content}
      {createPortal(
        <dialog
          ref={dialog}
          aria-label={tr('QTE 확대 미리보기')}
          onClose={() => setExpanded(false)}
          style={{
            width: 'min(94vw,1200px)',
            maxHeight: '92vh',
            overflow: 'auto',
            padding: 16,
            background: '#171717',
            color: '#eee',
            border: '1px solid #555',
            borderRadius: 10,
          }}
        >
          {expanded && content}
        </dialog>,
        document.body
      )}
    </div>
  );
}
