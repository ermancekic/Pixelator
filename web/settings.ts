import type { Language } from './i18n';

/** Interface preferences of this browser; documents never depend on them. */
export interface Settings { language: Language; showLibrary: boolean; showInspector: boolean; showTimeline: boolean; showGrid: boolean; showTileGrid: boolean }
export const DEFAULT_SETTINGS: Settings = { language: 'en', showLibrary: true, showInspector: true, showTimeline: true, showGrid: true, showTileGrid: true };
const KEY = 'pixelator.settings';

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const result = { ...DEFAULT_SETTINGS };
    if (stored.language === 'en' || stored.language === 'de') result.language = stored.language;
    for (const key of ['showLibrary', 'showInspector', 'showTimeline', 'showGrid', 'showTileGrid'] as const) if (typeof stored[key] === 'boolean') result[key] = stored[key];
    return result;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: Settings) {
  try { window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Preferences then last for this session. */ }
}

/** Forgets saved panel sizes so every panel returns to its default size. */
export function resetPanelSizes() {
  try { for (const key of Object.keys(window.localStorage)) if (key.startsWith('pixelator.panel.')) window.localStorage.removeItem(key); } catch { /* Nothing stored. */ }
}
