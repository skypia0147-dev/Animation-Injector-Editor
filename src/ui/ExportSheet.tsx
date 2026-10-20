import {HelpNote} from './HelpTip.tsx';
import {t} from '../i18n/index.ts';
import type {Workspace} from '../workspace.ts';
import {PackagePanel} from '../PackagePanel.tsx';

export function ExportSheet({
  mode,
  setMode,
  w,
  xml,
  edit,
  status,
  busy,
  setBusy,
  saveXml,
  message,
}: {
  mode: 'xml' | 'mod';
  setMode: (mode: 'xml' | 'mod') => void;
  w: Workspace;
  xml: string;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (text: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  saveXml: () => void;
  message: string;
}) {
  return (
    <div className="export-sheet" data-testid="export-sheet">
      <div className="export-modes" role="tablist" aria-label={t('export.title')}>
        {(['xml', 'mod'] as const).map(m => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            aria-controls={'export-' + m}
            id={'export-tab-' + m}
            disabled={busy}
            onClick={() => setMode(m)}
          >
            {t('export.' + m)}
          </button>
        ))}
      </div>
      {mode === 'mod' ? (
        <div role="tabpanel" id="export-mod" aria-labelledby="export-tab-mod" className="export-mod-body">
          <PackagePanel w={w} edit={edit} status={status} busy={busy} setBusy={setBusy} />
        </div>
      ) : (
        <div role="tabpanel" id="export-xml" aria-labelledby="export-tab-xml" className="export-xml-body">
          <HelpNote label={t('export.xml')}>{t('export.xmlHint')}</HelpNote>
          <pre aria-label={t('export.preview')}>{xml}</pre>
          {message && (
            <p role="status" className="package-message">
              {message}
            </p>
          )}
          <footer>
            <button className="primary" disabled={busy} onClick={saveXml}>
              {t('export.xmlSave')}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
