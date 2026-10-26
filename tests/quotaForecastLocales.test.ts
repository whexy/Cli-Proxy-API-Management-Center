/**
 * The forecast registers its own strings instead of editing the shared locale
 * files, so the parity those files get from their own tests is checked here.
 */

import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import i18n from '@/i18n';
import '@/features/quota/forecast/i18n';
import { QUOTA_FORECAST_LOCALES } from '@/features/quota/forecast/locales';
import { SUPPORTED_LANGUAGES } from '@/utils/constants';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const tokens = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

/** A value for every interpolation token the forecast strings use. */
const TOKEN_VALUES = Object.fromEntries(
  Array.from(
    new Set(
      Object.values(QUOTA_FORECAST_LOCALES.en).flatMap((value) =>
        (value.match(/\{\{([^}]+)\}\}/g) ?? []).map((token) => token.slice(2, -2))
      )
    )
  ).map((name) => [name, '1'])
);

const baseKeys = (strings: Record<string, string>) =>
  Array.from(new Set(Object.keys(strings).map((key) => key.replace(PLURAL_SUFFIX, ''))));

describe('quota forecast locales', () => {
  test('cover every app language', () => {
    expect(Object.keys(QUOTA_FORECAST_LOCALES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  test('resolve every key in every language and plural form', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      resources: Object.fromEntries(
        Object.entries(QUOTA_FORECAST_LOCALES).map(([language, strings]) => [
          language,
          { translation: { quota_forecast: strings } },
        ])
      ),
      fallbackLng: false,
      interpolation: { escapeValue: false },
    });

    const english = QUOTA_FORECAST_LOCALES.en;
    const unresolved: string[] = [];
    for (const language of SUPPORTED_LANGUAGES) {
      for (const base of baseKeys(english)) {
        for (const count of [0, 1, 2, 5, 21, 1.5]) {
          const key = `quota_forecast.${base}`;
          const value = instance.t(key, { lng: language, ...TOKEN_VALUES, count });
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
      Object.entries(QUOTA_FORECAST_LOCALES.en).map(([key, value]) => [
        key.replace(PLURAL_SUFFIX, ''),
        tokens(value),
      ])
    );
    const mismatches = Object.entries(QUOTA_FORECAST_LOCALES).flatMap(([language, strings]) =>
      Object.entries(strings)
        .filter(
          ([key, value]) => englishTokens.get(key.replace(PLURAL_SUFFIX, '')) !== tokens(value)
        )
        .map(([key]) => `${language}:${key}`)
    );
    expect(mismatches).toEqual([]);
  });

  test('merge into the app instance without replacing existing keys', () => {
    expect(i18n.t('quota_forecast.mode_drain', { lng: 'en' })).toBe('Drain rate');
    expect(i18n.t('quota_forecast.accounts_count', { lng: 'en', count: 1 })).toBe('1 account');
    expect(i18n.t('quota_forecast.accounts_count', { lng: 'ru', count: 3 })).toBe('3 аккаунта');
    expect(i18n.t('quota_management.title', { lng: 'en' })).toBe('Quota Management');
  });
});
