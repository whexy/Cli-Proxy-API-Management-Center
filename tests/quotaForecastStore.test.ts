import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { QuotaSample } from '@/features/quota/forecast/history';
import {
  getSessionQuotaSamples,
  mergeQuotaSamples,
  readQuotaSamples,
  recordQuotaSamples,
} from '@/features/quota/forecast/historyStore';
import {
  DEFAULT_FORECAST_SETTINGS,
  readForecastSettings,
  writeForecastSettings,
} from '@/features/quota/forecast/settings';
import { MINUTE_MS } from '@/utils/time/durations';

const NOW = Date.now();

const sample = (scope: string, at: number, remaining: number): QuotaSample => ({
  scope,
  credential: 'codex:a.json',
  at,
  windows: [{ id: 'weekly', remaining, resetAt: null, periodHours: 168 }],
});

describe('quota history store', () => {
  test('keeps a sample only when it adds to the credential’s history', () => {
    const scope = 'https://dedupe.example';
    recordQuotaSamples([sample(scope, NOW, 80), sample(scope, NOW + MINUTE_MS, 80)]);
    recordQuotaSamples([sample(scope, NOW + 2 * MINUTE_MS, 79)]);
    recordQuotaSamples([sample('https://other.example', NOW + 2 * MINUTE_MS, 79)]);

    const kept = getSessionQuotaSamples().filter((entry) => entry.scope === scope);
    expect(kept.map((entry) => entry.at)).toEqual([NOW, NOW + 2 * MINUTE_MS]);
  });

  test('reads nothing back without IndexedDB, and merges each sample once', async () => {
    expect(await readQuotaSamples('https://dedupe.example', 0)).toEqual([]);
    const stored = [sample('s', NOW, 80)];
    const merged = mergeQuotaSamples(stored, [sample('s', NOW, 80), sample('s', NOW + 1, 79)]);
    expect(merged.map((entry) => entry.at)).toEqual([NOW, NOW + 1]);
  });
});

describe('forecast settings', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as unknown as { window: unknown }).window = {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    };
  });

  afterAll(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  test('round-trip, and fall back per field on values they do not know', () => {
    expect(readForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS);
    const chosen = {
      mode: 'drain',
      lookbackHours: 6,
      futureUsage: 'double',
      showAccounts: true,
    } as const;
    writeForecastSettings(chosen);
    expect(readForecastSettings()).toEqual(chosen);

    store.set(
      'quotaPage.forecast',
      JSON.stringify({ mode: 'pie', lookbackHours: 4, futureUsage: 'half', showAccounts: 'yes' })
    );
    expect(readForecastSettings()).toEqual({ ...DEFAULT_FORECAST_SETTINGS, futureUsage: 'half' });
  });
});
