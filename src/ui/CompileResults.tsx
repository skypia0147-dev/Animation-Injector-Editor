import {t, getLanguage} from '../i18n/index.ts';
import type {Issue} from '../model.ts';
import type {Notice} from './Toast.tsx';

export function CompileResults({
  issues,
  log,
  compiledAt,
  onSelect,
  where,
}: {
  issues: Issue[];
  log: Notice[];
  compiledAt: number | null;
  onSelect: (node: string) => void;
  where: (node: string) => string;
}) {
  const errors = issues.filter(i => i.level === 'error').length,
    warnings = issues.length - errors;
  return (
    <div className="results" data-testid="compile-results">
      <div className={'res ' + (compiledAt === null ? 'wn' : errors ? 'er' : 'ok')}>
        <span className="ic" />
        <span className="where">{t('panel.compileResults')}</span>
        <span>{compiledAt === null ? t('compile.stale') : t('compile.passed', {errors, warnings})}</span>
        <span />
      </div>
      {issues.map((i, n) => (
        <button
          type="button"
          key={n}
          className={'res ' + (i.level === 'error' ? 'er' : 'wn')}
          onClick={() => onSelect(i.node)}
        >
          <span className="ic" />
          <span className="where">{where(i.node)}</span>
          <span>{i.message}</span>
          <span className="go">[{t('compile.goTo')}]</span>
        </button>
      ))}
      {log
        .slice(-20)
        .reverse()
        .map(n => (
          <div
            key={n.id}
            className={
              'res ' + (n.level === 'error' ? 'er' : n.level === 'warn' ? 'wn' : n.level === 'ok' ? 'ok' : 'in')
            }
          >
            <span className="ic" />
            <span className="where">{new Date(n.time).toLocaleTimeString(getLanguage())}</span>
            <span>{n.text}</span>
            <span />
          </div>
        ))}
    </div>
  );
}
