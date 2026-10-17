import { LANGUAGES, msg, useT } from './i18n';
import { IconButton } from './icons';
import type { Settings } from './settings';

const PANELS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'showLibrary', label: msg('Assetbibliothek'), hint: msg('Projekte und Assets links') },
  { key: 'showInspector', label: msg('Eigenschaften'), hint: msg('Vorschau, Palette, Ebenen und Kacheln rechts') },
  { key: 'showTimeline', label: msg('Animationsleiste'), hint: msg('Frames, Wiedergabe und Tags unter der Zeichenfläche') },
  { key: 'showGrid', label: msg('Pixelraster'), hint: msg('Ab 400 % Zoom') },
  { key: 'showTileGrid', label: msg('Kachelraster'), hint: msg('Grenzen der Kacheln in Tilesets') },
];

export function SettingsDialog({ settings, onChange, onResetLayout, onClose }: { settings: Settings; onChange: (settings: Settings) => void; onResetLayout: () => void; onClose: () => void }) {
  const t = useT();
  return <>
    <div className="shortcuts-heading"><h2 id="settings-title">{t('Einstellungen')}</h2><IconButton icon="close" label={t('Einstellungen schließen')} autoFocus onClick={onClose}/></div>
    <section className="settings-group" aria-labelledby="settings-language">
      <h3 id="settings-language">{t('Sprache')}</h3>
      <div className="segmented" role="radiogroup" aria-labelledby="settings-language">{LANGUAGES.map(language => <button key={language.id} role="radio" aria-checked={settings.language === language.id} className={settings.language === language.id ? 'selected' : ''} onClick={() => onChange({ ...settings, language: language.id })}>{language.label}</button>)}</div>
    </section>
    <section className="settings-group" aria-labelledby="settings-view">
      <h3 id="settings-view">{t('Ansicht')}</h3>
      {PANELS.map(panel => <label key={panel.key} className="settings-toggle"><span><strong>{t(panel.label)}</strong><small>{t(panel.hint)}</small></span><input type="checkbox" role="switch" checked={settings[panel.key] as boolean} onChange={event => onChange({ ...settings, [panel.key]: event.target.checked })}/></label>)}
      <button className="button small" onClick={onResetLayout}>{t('Fensteraufteilung zurücksetzen')}</button>
    </section>
    <p className="settings-note">{t('Einstellungen gelten für diesen Browser. Projekte und Assets bleiben unverändert.')}</p>
  </>;
}
