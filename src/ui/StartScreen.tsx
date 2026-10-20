import {t} from '../i18n/index.ts';
import type {RecentFile} from '../recent.ts';

export function StartScreen({
  recent,
  onNew,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onSample,
  onRecover,
}: {
  recent: RecentFile[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (r: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  onSample: () => void;
  onRecover?: () => void;
}) {
  return (
    <div className="start" data-testid="start-screen">
      <div className="start-card">
        <h1>Animation Injector Editor</h1>
        <p className="start-sub">{t('start.subtitle')}</p>
        <div className="start-columns">
          <section>
            <h2>{t('start.begin')}</h2>
            <button type="button" className="start-primary" onClick={onNew}>
              {t('menu.file.new')}
            </button>
            <button type="button" onClick={onOpen}>
              {t('menu.file.open')}
            </button>
            <button type="button" onClick={onSample}>
              {t('start.sample')}
            </button>
            {onRecover && (
              <button type="button" onClick={onRecover}>
                {t('start.recover')}
              </button>
            )}
          </section>
          <section>
            <h2>{t('menu.file.recent')}</h2>
            {recent.length === 0 && <p className="start-empty">{t('start.noRecent')}</p>}
            <ul className="start-recent">
              {recent.map(r => (
                <li key={r.path}>
                  <button type="button" onClick={() => onOpenRecent(r)} title={r.path}>
                    <b>{r.name}</b>
                    <small>{r.path}</small>
                  </button>
                  <button
                    type="button"
                    className="start-remove"
                    aria-label={t('start.removeRecent')}
                    onClick={() => onRemoveRecent(r.path)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="start-hint">{t('start.dropHint')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
