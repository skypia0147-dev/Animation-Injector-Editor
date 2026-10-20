import {MenuList} from './MenuList.tsx';
import {useEffect, useRef, useState} from 'react';
import {t} from '../i18n/index.ts';
import {Icon} from '../EditorChrome.tsx';
import {tr} from '../i18n/korean.ts';

// 'empty': a project without an action yet (nothing to check, nothing failed).
export type CompileState = 'ok' | 'stale' | 'error' | 'empty';

export function ToolBar({
  compile,
  errors,
  warnings,
  onCompile,
  onSave,
  dirty,
  pending,
  onFind,
  onExportXml,
  onExportMod,
  exportDisabled,
}: {
  compile: CompileState;
  errors: number;
  warnings: number;
  onCompile: () => void;
  onSave: () => void;
  dirty: boolean;
  pending: boolean;
  onFind: () => void;
  onExportXml: () => void;
  onExportMod: () => void;
  exportDisabled: boolean;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [exportOpen]);
  const title =
    compile === 'empty'
      ? tr('동작을 만들면 검사할 수 있습니다.')
      : compile === 'error'
        ? t('compile.passed', {errors, warnings})
        : compile === 'stale'
          ? t('compile.stale')
          : t('compile.passed', {errors, warnings});
  return (
    <div className="toolbar" role="toolbar">
      <button
        type="button"
        className="tb"
        disabled={pending}
        onClick={onSave}
        data-testid="save"
        title={tr('프로젝트 저장 · Ctrl+S')}
      >
        <Icon name="save" />
        {t('toolbar.save')}
        {dirty ? ' •' : ''}
      </button>
      <button type="button" className={'tb compile ' + compile} onClick={onCompile} title={title} data-testid="compile">
        <Icon name="check" />
        {t('toolbar.compile')}
        {compile === 'error' && <span className="compile-count">{errors}</span>}
      </button>
      <div className="tb-dropdown" ref={ref}>
        <button
          type="button"
          className="tb primary dd"
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen(v => !v)}
          data-testid="export"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setExportOpen(true);
            }
          }}
        >
          <Icon name="export" />
          {t('toolbar.export')}
        </button>
        {exportOpen && (
          <div className="menu-popup" role="menu">
            <MenuList
              close={() => {
                setExportOpen(false);
                ref.current?.querySelector('button')?.focus();
              }}
              items={[
                {label: t('menu.file.exportXml'), shortcut: 'Ctrl+E', disabled: exportDisabled, run: onExportXml},
                {label: t('menu.file.exportMod'), shortcut: 'Ctrl+Shift+E', disabled: exportDisabled, run: onExportMod},
              ]}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        className="tb icon-button"
        onClick={onFind}
        aria-label={t('toolbar.find')}
        title={t('toolbar.find')}
      >
        <Icon name="search" />
      </button>
    </div>
  );
}
