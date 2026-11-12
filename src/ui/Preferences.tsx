import {t} from '../i18n/index.ts';
import {tr} from '../i18n/korean.ts';

export function Preferences({onResetLayout}: {onResetLayout: () => void}) {
  return (
    <div className="prefs">
      <div className="cat">{t('prefs.layout')}</div>
      <div className="dr">
        <span className="k">{tr('창 배치')}</span>
        <button type="button" onClick={onResetLayout}>
          {t('menu.window.resetLayout')}
        </button>
      </div>
      {/* Said in full: nothing here to set, and a name alone read as a control gone missing (11-12 audit). */}
      <div className="cat">{t('prefs.autosave')}</div>
      <p className="prefs-note">{t('prefs.autosaveNote')}</p>
    </div>
  );
}
