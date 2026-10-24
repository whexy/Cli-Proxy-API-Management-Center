/**
 * The ledger registers its own strings instead of editing the shared locale
 * files, so the parity those files get from their own tests is checked here.
 */

import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import i18n from '@/i18n';
import '@/features/quota/ledger/i18n';
import { QUOTA_LEDGER_LOCALES } from '@/features/quota/ledger/locales';
import { SUPPORTED_LANGUAGES } from '@/utils/constants';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const tokens = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

const baseKeys = (strings: Record<string, string>) =>
  Array.from(new Set(Object.keys(strings).map((key) => key.replace(PLURAL_SUFFIX, ''))));

describe('quota ledger locales', () => {
  test('cover every app language', () => {
    expect(Object.keys(QUOTA_LEDGER_LOCALES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  test('resolve every key in every language and plural form', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      resources: Object.fromEntries(
        Object.entries(QUOTA_LEDGER_LOCALES).map(([language, strings]) => [
          language,
          { translation: { quota_ledger: strings } },
        ])
      ),
      fallbackLng: false,
      interpolation: { escapeValue: false },
    });

    const english = QUOTA_LEDGER_LOCALES.en;
    const unresolved: string[] = [];
    for (const language of SUPPORTED_LANGUAGES) {
      for (const base of baseKeys(english)) {
        for (const count of [0, 1, 2, 5, 21, 1.5]) {
          const key = `quota_ledger.${base}`;
          const value = instance.t(key, { lng: language, count, percent: 500 });
          if (value === key || value.includes('{{')) {
            unresolved.push(`${language}:${base}:${count}`);
          }
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  test('use the same interpolation tokens as English', () => {
    const englishTokens = new Map(
      Object.entries(QUOTA_LEDGER_LOCALES.en).map(([key, value]) => [
        key.replace(PLURAL_SUFFIX, ''),
        tokens(value),
      ])
    );
    const mismatches = Object.entries(QUOTA_LEDGER_LOCALES).flatMap(([language, strings]) =>
      Object.entries(strings)
        .filter(
          ([key, value]) => englishTokens.get(key.replace(PLURAL_SUFFIX, '')) !== tokens(value)
        )
        .map(([key]) => `${language}:${key}`)
    );
    expect(mismatches).toEqual([]);
  });

  test('merge into the app instance without replacing existing keys', () => {
    expect(i18n.t('quota_ledger.view_ledger', { lng: 'en' })).toBe('Ledger');
    expect(i18n.t('quota_ledger.credentials', { lng: 'en', count: 1 })).toBe('1 credential');
    expect(i18n.t('quota_ledger.credentials', { lng: 'ru', count: 3 })).toBe('3 учётные записи');
    expect(i18n.t('quota_management.title', { lng: 'en' })).toBe('Quota Management');
  });
});
