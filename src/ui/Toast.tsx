import {useEffect, useState} from 'react';
import {t} from '../i18n/index.ts';

export type NoticeLevel = 'info' | 'ok' | 'warn' | 'error';
export type Notice = {id: number; level: NoticeLevel; text: string; time: number};

let seq = 0;
export const makeNotice = (level: NoticeLevel, text: string): Notice => ({id: ++seq, level, text, time: Date.now()});

/** Top-right toasts. Errors stay until closed; everything else fades after 5 s. */
export function Toasts({notices, dismiss}: {notices: Notice[]; dismiss: (id: number) => void}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!notices.some(n => n.level !== 'error')) return;
    const timer = setInterval(() => {
      tick(t => t + 1);
      const now = Date.now();
      for (const n of notices) if (n.level !== 'error' && now - n.time > 3500) dismiss(n.id);
    }, 500);
    return () => clearInterval(timer);
  }, [notices, dismiss]);
  if (!notices.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {notices.slice(-3).map(n => (
        <div key={n.id} className={'toast ' + n.level} role="status">
          <span>{n.text}</span>
          <button type="button" aria-label={t('shell.close')} onClick={() => dismiss(n.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
