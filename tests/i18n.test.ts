import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { serverMessage, setActiveLanguage, t, translate } from '../web/i18n.js';
import { EN, SERVER_DE, STORED_LABELS } from '../web/translations.js';
import { DEFAULT_SETTINGS, loadSettings } from '../web/settings.js';
import { fitScale } from '../web/view-helpers.js';
import { translationKeys } from './i18n-keys.js';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const keys = translationKeys(new URL('../web', import.meta.url).pathname);

describe('interface translations', () => {
  afterEach(() => setActiveLanguage('en'));

  it('has an English text for every German source text in the editor', () => {
    const missing = [...keys].filter(([key]) => !(key in EN)).map(([key, files]) => `${key} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('keeps no English text that the editor no longer uses', () => {
    expect(Object.keys(EN).filter(key => !keys.has(key) && !STORED_LABELS.includes(key))).toEqual([]);
  });

  it('keeps every placeholder in the translation', () => {
    expect(Object.entries(EN).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join()).map(([key]) => key)).toEqual([]);
  });

  it('defaults to English, fills placeholders and shows the German source text in German', () => {
    expect(t('Exportieren')).toBe('Export');
    expect(t('{count} Farben', { count: 3 })).toBe('3 colors');
    expect(translate('de', '{count} Farben', { count: 3 })).toBe('3 Farben');
    expect(t('Text ohne Übersetzung')).toBe('Text ohne Übersetzung');
  });

  it('translates static and dynamic server messages for the German interface only', () => {
    expect(serverMessage('This asset has no tile grid.')).toBe('This asset has no tile grid.');
    setActiveLanguage('de');
    expect(serverMessage('This asset has no tile grid.')).toBe('Dieses Asset hat kein Kachelraster.');
    expect(serverMessage('Frame f3 does not exist.')).toBe('Frame f3 existiert nicht.');
    expect(serverMessage('The sheet yields 70 frames; 1 to 64 are allowed.')).toBe('Das Sheet ergibt 70 Frames; erlaubt sind 1 bis 64.');
    expect(serverMessage('An engine message without translation.')).toBe('An engine message without translation.');
  });

  it('has a German text only for messages the server actually sends', () => {
    const server = readdirSync(new URL('../src', import.meta.url)).filter(name => name.endsWith('.ts')).map(name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).join('\n');
    const unused = Object.keys(SERVER_DE).filter(key => !key.split(/\{\w+\}/).every(part => server.includes(part)));
    expect(unused).toEqual([]);
    expect(Object.entries(SERVER_DE).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())).toEqual([]);
  });
});

describe('interface settings', () => {
  const withStorage = (value: string | null, run: () => void) => {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => value } };
    try { run(); } finally { (globalThis as { window?: unknown }).window = previous; }
  };

  it('starts in English with every panel shown', () => {
    withStorage(null, () => expect(loadSettings()).toEqual(DEFAULT_SETTINGS));
    expect(DEFAULT_SETTINGS.language).toBe('en');
  });

  it('keeps valid stored choices and drops invalid or broken ones', () => {
    withStorage(JSON.stringify({ language: 'de', showTimeline: false, showGrid: 'no', extra: 1 }), () => expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, language: 'de', showTimeline: false }));
    withStorage(JSON.stringify({ language: 'fr' }), () => expect(loadSettings().language).toBe('en'));
    withStorage('{broken', () => expect(loadSettings()).toEqual(DEFAULT_SETTINGS));
  });
});

describe('fit zoom', () => {
  it('grows by whole factors and shrinks large images to fit', () => {
    expect(fitScale(16, 16, 100, 70)).toBe(4);
    expect(fitScale(512, 256, 128, 128)).toBe(0.25);
    expect(fitScale(32, 32, 32, 32)).toBe(1);
    expect(fitScale(32, 32, 0, 0)).toBe(1);
  });
});
