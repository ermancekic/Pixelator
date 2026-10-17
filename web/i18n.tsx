import { createContext, useCallback, useContext } from 'react';
import { EN, SERVER_DE } from './translations';

export type Language = 'en' | 'de';
export type Translate = (text: string, params?: Record<string, string | number>) => string;
export const LANGUAGES: { id: Language; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'de', label: 'Deutsch' }];
export type Params = Record<string, string | number>;

// The interface is written in German; German text is the key and English the translation, like gettext's source strings.
let active: Language = 'en';
export const setActiveLanguage = (language: Language) => { active = language; };
const format = (text: string, params?: Params) => params ? text.replace(/\{(\w+)\}/g, (match, key: string) => key in params ? String(params[key]) : match) : text;
export const translate = (language: Language, text: string, params?: Params) => format(language === 'en' ? EN[text] ?? text : text, params);
/** Translation outside React, e.g. in request helpers; follows the language the editor last rendered with. */
export const t = (text: string, params?: Params) => translate(active, text, params);
/** Marks text for translation where it is defined; it is translated where it is shown. */
export const msg = (text: string) => text;
// Dynamic server messages match their entry with each {name} standing for any text.
const serverPatterns = Object.entries(SERVER_DE).filter(([key]) => key.includes('{')).map(([key, value]) => {
  const names: string[] = [];
  const source = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, name: string) => { names.push(name); return '(.+?)'; });
  return { pattern: new RegExp(`^${source}$`), names, value };
});
/** Server messages are English; the German interface shows a translation when one exists. */
export function serverMessage(message: string) {
  if (active !== 'de') return message;
  if (SERVER_DE[message]) return SERVER_DE[message];
  for (const { pattern, names, value } of serverPatterns) {
    const match = pattern.exec(message);
    if (match) return format(value, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return message;
}
export const localeOf = (language: Language) => language === 'en' ? 'en-US' : 'de-DE';

export const I18nContext = createContext<Language>('en');
export function useT() {
  const language = useContext(I18nContext);
  return useCallback((text: string, params?: Params) => translate(language, text, params), [language]);
}
export const useLanguage = () => useContext(I18nContext);
