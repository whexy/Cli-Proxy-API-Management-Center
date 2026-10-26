import { describe, expect, test } from 'bun:test';
import {
  FORECAST_HORIZON_MS,
  buildForecastSection,
  forecastSpan,
  forecastWindowId,
  type ForecastAccountInput,
} from '@/features/quota/forecast/forecastModel';
import type { QuotaSample } from '@/features/quota/forecast/history';
import type { LedgerQuota, LedgerWindow } from '@/features/quota/ledger/ledgerModel';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 26, 12).getTime();

const win = (
  id: string,
  remainingPercent: number | null,
  periodHours: number | null,
  resetAt: number | null = null
): LedgerWindow => ({ id, label: `label:${id}`, remainingPercent, resetAt, periodHours });

const ledger = (...windows: LedgerWindow[]): LedgerQuota => ({ windows, plan: null });

/** A reading every ten minutes over the hours before NOW, falling `perHour` an hour. */
const history = (hours: number, current: number, perHour: number, resetAt: number) =>
  Array.from({ length: hours * 6 + 1 }, (_, index): QuotaSample => {
    const at = NOW - hours * HOUR_MS + index * 10 * MINUTE_MS;
    return {
      scope: '',
      credential: 'x',
      at,
      windows: [
        {
          id: 'weekly',
          remaining: current + (perHour * (NOW - at)) / HOUR_MS,
          resetAt,
          periodHours: 168,
        },
      ],
    };
  });

const options = {
  nowMs: NOW,
  spanStartMs: NOW - 3 * DAY_MS,
  spanEndMs: NOW + 11 * DAY_MS,
  lookbackHours: 3,
  usageFactor: 1,
};

describe('forecastSpan', () => {
  test('opens three days before today for a fortnight and pages by weeks', () => {
    const span = forecastSpan(0, NOW);
    expect(new Date(span.startMs)).toEqual(new Date(2026, 9, 23));
    expect(new Date(span.endMs)).toEqual(new Date(2026, 10, 6));
    expect(new Date(forecastSpan(-1, NOW).startMs)).toEqual(new Date(2026, 9, 16));
  });
});

describe('forecastWindowId', () => {
  test('pools the tightest window of a day or longer, not the 5-hour one', () => {
    const ledgers = [
      ledger(win('five', 5, 5), win('weekly', 70, 168), win('opus', 40, 168)),
      ledger(win('five', 10, 5), win('weekly', 60, 168), win('opus', 70, 168)),
    ];
    expect(forecastWindowId(ledgers, NOW)).toBe('opus');
  });

  test('falls back to the tightest window when none is long', () => {
    expect(forecastWindowId([ledger(win('a', 80, 5), win('b', 20, null))], NOW)).toBe('b');
    expect(forecastWindowId([null, ledger()], NOW)).toBeNull();
  });
});

describe('buildForecastSection', () => {
  const resetAt = NOW + 50 * HOUR_MS;
  const accounts: ForecastAccountInput[] = [
    {
      name: 'a',
      ledger: ledger(win('five', 50, 5), win('weekly', 81, 168, resetAt)),
      samples: history(3, 81, 3, resetAt),
    },
    { name: 'b', ledger: ledger(win('weekly', 60, 168, resetAt)), samples: [] },
    { name: 'not loaded', ledger: null, samples: [] },
  ];

  test('pools the accounts reporting the window and measures burn from the recording', () => {
    const section = buildForecastSection(accounts, options);
    expect(section?.windowId).toBe('weekly');
    expect(section?.windowLabel).toBe('label:weekly');
    expect(section?.names).toEqual(['a', 'b']);
    expect(section?.capacity).toBe(200);
    expect(section?.poolNow).toBe(141);
    expect(section?.burn?.source).toBe('recorded');
    expect(section?.burn?.perHour).toBeCloseTo(3, 6);
    expect(section?.burn?.coveredMs).toBe(3 * HOUR_MS);
  });

  test('projects stats from the measured burn', () => {
    const section = buildForecastSection(accounts, options);
    // 1.5 points an hour each: b is dry at 40h, then a's remaining 21 lasts 7h more.
    expect(section?.firstEmpty).toEqual({ at: NOW + 40 * HOUR_MS, name: 'b' });
    expect((section?.poolEmptyAt ?? 0) - NOW).toBeCloseTo(47 * HOUR_MS, -3);
    expect(section?.nextReset).toEqual({ at: resetAt, gain: 200 });
  });

  test('scales the projection by future usage', () => {
    const idle = buildForecastSection(accounts, { ...options, usageFactor: 0 });
    expect(idle?.burn?.perHour).toBeCloseTo(3, 6);
    expect(idle?.projectedBurn).toBe(0);
    expect(idle?.poolEmptyAt).toBeNull();
    expect(idle?.firstEmpty).toBeNull();
    expect(idle?.nextReset).toEqual({ at: resetAt, gain: 100 - 81 + 100 - 60 });
  });

  test('falls back to the average since each window opened without enough recording', () => {
    const opened = resetAt - 168 * HOUR_MS;
    const section = buildForecastSection(
      accounts.map((account) => ({ ...account, samples: [] })),
      options
    );
    expect(section?.burn?.source).toBe('window');
    expect(section?.burn?.perHour).toBeCloseTo((19 + 40) / ((NOW - opened) / HOUR_MS), 6);
  });

  test('leaves the projection out when no burn can be measured', () => {
    const section = buildForecastSection(
      [{ name: 'a', ledger: ledger(win('weekly', 70, null, null)), samples: [] }],
      options
    );
    expect(section?.burn).toBeNull();
    expect(section?.projection).toBeNull();
    expect(section?.poolEmptyAt).toBeNull();
  });

  test('names an account that is already dry as the first empty', () => {
    const section = buildForecastSection(
      [
        { name: 'dry', ledger: ledger(win('weekly', 0, 168, resetAt)), samples: [] },
        { name: 'full', ledger: ledger(win('weekly', 100, 168, resetAt)), samples: [] },
      ],
      options
    );
    expect(section?.firstEmpty).toEqual({ at: NOW, name: 'dry' });
  });

  test('labels a recorded reset once, with what it restored', () => {
    const before = NOW - 2 * HOUR_MS;
    const samples: QuotaSample[] = [0, 10, 20, 30].map((minutes) => {
      const at = before + minutes * MINUTE_MS;
      const reset = minutes >= 20;
      return {
        scope: '',
        credential: 'x',
        at,
        windows: [
          {
            id: 'weekly',
            remaining: reset ? 100 : 12,
            resetAt: reset ? resetAt : before + 15 * MINUTE_MS,
            periodHours: 168,
          },
        ],
      };
    });
    const section = buildForecastSection(
      [{ name: 'a', ledger: ledger(win('weekly', 100, 168, resetAt)), samples }],
      { ...options, usageFactor: 0 }
    );
    const recorded = section?.jumps.filter((jump) => !jump.projected);
    expect(recorded).toEqual([
      { at: before + 20 * MINUTE_MS, gain: 88, top: 100, projected: false },
    ]);
  });

  test('keeps the recorded series to the span and ends it at now with the live figures', () => {
    const section = buildForecastSection(accounts, options);
    const times = section?.recorded.times ?? [];
    expect(times[0]).toBe(options.spanStartMs);
    expect(times[times.length - 1]).toBe(NOW);
    expect(section?.recorded.pool[times.length - 1]).toBe(141);
    expect(section?.recorded.pool[0]).toBeNull();
    expect(FORECAST_HORIZON_MS).toBe(14 * DAY_MS);
  });
});
