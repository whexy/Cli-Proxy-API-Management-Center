import { useCallback, useState } from 'react';

export const FORECAST_MODES = ['remaining', 'drain'] as const;
export type ForecastMode = (typeof FORECAST_MODES)[number];

export const BURN_LOOKBACK_HOURS = [1, 3, 6] as const;
export type BurnLookbackHours = (typeof BURN_LOOKBACK_HOURS)[number];
export const MAX_BURN_LOOKBACK_HOURS = Math.max(...BURN_LOOKBACK_HOURS);

export const FUTURE_USAGE = ['same', 'half', 'double', 'none'] as const;
export type FutureUsage = (typeof FUTURE_USAGE)[number];
export const FUTURE_USAGE_FACTOR: Record<FutureUsage, number> = {
  same: 1,
  half: 0.5,
  double: 2,
  none: 0,
};

export interface ForecastSettings {
  mode: ForecastMode;
  lookbackHours: BurnLookbackHours;
  futureUsage: FutureUsage;
  showAccounts: boolean;
}

export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  mode: 'remaining',
  lookbackHours: 3,
  futureUsage: 'same',
  showAccounts: false,
};

const FORECAST_SETTINGS_KEY = 'quotaPage.forecast';

const oneOf = <T>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Session-scoped, like the page's other UI preferences. */
export function readForecastSettings(): ForecastSettings {
  const defaults = DEFAULT_FORECAST_SETTINGS;
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(FORECAST_SETTINGS_KEY) ?? 'null'
    ) as Partial<Record<keyof ForecastSettings, unknown>> | null;
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      mode: oneOf(FORECAST_MODES, parsed.mode, defaults.mode),
      lookbackHours: oneOf(BURN_LOOKBACK_HOURS, parsed.lookbackHours, defaults.lookbackHours),
      futureUsage: oneOf(FUTURE_USAGE, parsed.futureUsage, defaults.futureUsage),
      showAccounts:
        typeof parsed.showAccounts === 'boolean' ? parsed.showAccounts : defaults.showAccounts,
    };
  } catch {
    return defaults;
  }
}

export function writeForecastSettings(settings: ForecastSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(FORECAST_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function useForecastSettings() {
  const [settings, setSettings] = useState(readForecastSettings);
  const update = useCallback((patch: Partial<ForecastSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      writeForecastSettings(next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}
