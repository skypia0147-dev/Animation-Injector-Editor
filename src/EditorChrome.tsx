import type {ReactNode} from 'react';
import {useReactFlow, useViewport} from '@xyflow/react';
import {tr} from './i18n/korean.ts';

const paths: Record<string, ReactNode> = {
  export: (
    <>
      <path d="M12 16V3m-4 4 4-4 4 4M5 11H3v10h18V11h-2" />
    </>
  ),
  branch: (
    <>
      <path d="M5 3v18m0-9h9a4 4 0 0 0 4-4V3M14 12a4 4 0 0 1 4 4v5" />
      <circle cx="5" cy="4" r="2" />
    </>
  ),
  event: <path d="m14 2-9 12h6l-1 8 9-12h-6z" />,
  blend: (
    <>
      <circle cx="9" cy="12" r="7" />
      <circle cx="15" cy="12" r="7" />
    </>
  ),
  output: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  camera: (
    <>
      <path d="M3 7h5l2-3h4l2 3h5v14H3z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  rotate: (
    <>
      <path d="M4 10a8 8 0 1 1 1 8M4 3v7h7" />
    </>
  ),
  shield: <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z" />,
  entry: <path d="M3 12h18m-7-7 7 7-7 7" />,
  pause: (
    <>
      <path d="M8 4v16M16 4v16" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  graph: (
    <>
      <rect x="9" y="2" width="6" height="5" />
      <rect x="2" y="17" width="6" height="5" />
      <rect x="16" y="17" width="6" height="5" />
      <path d="M12 7v5M5 17v-5h14v5" />
    </>
  ),
  timeline: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 3" />
    </>
  ),
  xml: (
    <>
      <path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m16 16 6 6" />
    </>
  ),
  tools: (
    <>
      <path d="m14 5 5-3-1 6-5 3-8 10-3-3 9-9-1-5z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="#1b1d20" />
      <circle cx="15" cy="12" r="2" fill="#1b1d20" />
      <circle cx="9" cy="18" r="2" fill="#1b1d20" />
    </>
  ),
  save: (
    <>
      <path d="M4 2h13l4 4v16H3V2zM7 2v7h10V2M7 22v-8h10v8" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7 12 3 3 7-7" />
    </>
  ),
  folder: <path d="M2 6h8l2 3h10l-2 12H2V6zm0 0V3h7l3 3h8v3" />,
  file: (
    <>
      <path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  menu: <path d="M4 5h16M4 12h16M4 19h16" />,
  undo: <path d="m8 4-6 6 6 6M2 10h12a7 7 0 0 1 7 7v3" />,
  redo: <path d="m16 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7v3" />,
  fit: <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6" />,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15" />,
  pair: <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />,
  asset: (
    <>
      <path d="m12 2 10 5v10l-10 5-10-5V7zm0 10v10M2 7l10 5 10-5M7 4l10 5v5" />
    </>
  ),
  play: <path d="m6 3 15 9-15 9z" />,
  back: <path d="m10 5-7 7 7 7M3 12h18" />,
  pin: <path d="m8 2 10 4-3 4v5l-4-1-7 8 4-10-3-2 5-4z" />,
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10" />
    </>
  ),
};
export function Icon({name, size = 18}: {name: string; size?: number}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function CanvasControls() {
  const {zoomIn, zoomOut, fitView} = useReactFlow();
  const {zoom} = useViewport();
  return (
    <div className="canvas-controls">
      <button
        title={tr('전체 보기')}
        aria-label={tr('그래프 전체 보기')}
        onClick={() => fitView({padding: 0.12, maxZoom: 1, duration: 200})}
      >
        <Icon name="fit" />
      </button>
      <span className="control-divider" />
      <button aria-label={tr('축소')} onClick={() => zoomOut({duration: 150})}>
        −
      </button>
      <span className="zoom-value">{Math.round(zoom * 100)}%</span>
      <button aria-label={tr('확대')} onClick={() => zoomIn({duration: 150})}>
        ＋
      </button>
    </div>
  );
}
