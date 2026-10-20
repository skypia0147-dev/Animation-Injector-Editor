import {useEffect, useRef, useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWebview} from '@tauri-apps/api/webview';

/** What landed on the window. Desktop gives paths; the browser fallback can only read text documents. */
export type DropPayload = {
  paths: string[];
  files: {name: string; contents: string}[];
  /** CSS pixels relative to the viewport */
  x: number;
  y: number;
};

const TEXT_TYPES = ['.aitemplate', '.xml'];

export function useFileDrop(onDrop: (payload: DropPayload) => void): boolean {
  const [over, setOver] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;
  useEffect(() => {
    if (isTauri()) {
      let off: (() => void) | undefined,
        disposed = false;
      void getCurrentWebview()
        .onDragDropEvent(e => {
          const p = e.payload;
          if (p.type === 'enter' || p.type === 'over') setOver(true);
          else if (p.type === 'leave') setOver(false);
          else if (p.type === 'drop') {
            setOver(false);
            const scale = globalThis.devicePixelRatio || 1;
            handler.current({paths: p.paths, files: [], x: p.position.x / scale, y: p.position.y / scale});
          }
        })
        .then(fn => {
          if (disposed) fn();
          else off = fn;
        })
        .catch(() => {
          /* Drag & drop is optional; the file menu still works. */
        });
      return () => {
        disposed = true;
        off?.();
      };
    }
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setOver(true);
      }
    };
    const leave = () => setOver(false);
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setOver(false);
      const files: DropPayload['files'] = [];
      const paths: string[] = [];
      for (const f of Array.from(e.dataTransfer.files)) {
        if (TEXT_TYPES.some(t => f.name.toLowerCase().endsWith(t)) && f.size <= 4 * 1024 * 1024)
          files.push({name: f.name, contents: await f.text()});
        else paths.push(f.name);
      }
      handler.current({paths, files, x: e.clientX, y: e.clientY});
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}
