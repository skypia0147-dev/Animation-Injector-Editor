import {HelpNote} from './HelpTip.tsx';
import {t} from '../i18n/index.ts';

export function Preferences({onResetLayout}: {onResetLayout: () => void}) {
  return (
    <div className="prefs">
      <div className="cat">{t('prefs.layout')}</div>
      <div className="dr">
        <span className="k">{t('menu.window.resetLayout')}</span>
        <button type="button" onClick={onResetLayout}>
          {t('menu.window.resetLayout')}
        </button>
      </div>
      <HelpNote label={t('prefs.autosave')}>{t('prefs.autosaveNote')}</HelpNote>
    </div>
  );
}
