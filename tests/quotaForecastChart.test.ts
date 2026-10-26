import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import '@/features/quota/forecast/i18n';
import { ForecastPanel } from '@/features/quota/forecast/ForecastPanel';
import {
  CHART_MARGIN,
  buildChartGeometry,
  instantAtX,
  niceCeiling,
  readoutAt,
} from '@/features/quota/forecast/chartGeometry';
import {
  FORECAST_STEP_MS,
  buildForecastSection,
  type ForecastSection,
} from '@/features/quota/forecast/forecastModel';
import { DEFAULT_FORECAST_SETTINGS } from '@/features/quota/forecast/settings';
import type { LedgerWindow } from '@/features/quota/ledger/ledgerModel';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 26, 12).getTime();
const SPAN = {
  spanStartMs: new Date(2026, 9, 23).getTime(),
  spanEndMs: new Date(2026, 10, 6).getTime(),
};

const weekly = (remainingPercent: number, resetAt: number): LedgerWindow => ({
  id: 'weekly',
  label: 'Weekly',
  remainingPercent,
  resetAt,
  periodHours: 168,
});

/** Two accounts with no recording, so the burn is the window average. */
const section = buildForecastSection(
  [
    {
      name: 'first@example.com',
      ledger: { plan: null, windows: [weekly(20, NOW + 4 * DAY_MS)] },
      samples: [],
    },
    {
      name: 'second@example.com',
      ledger: { plan: null, windows: [weekly(30, NOW + 6 * DAY_MS)] },
      samples: [],
    },
  ],
  { nowMs: NOW, ...SPAN, lookbackHours: 3, usageFactor: 1 }
) as ForecastSection;

const geometry = (overrides: Partial<Parameters<typeof buildChartGeometry>[0]> = {}) =>
  buildChartGeometry({
    section,
    mode: 'remaining',
    ...SPAN,
    nowMs: NOW,
    width: 1456,
    showAccounts: false,
    ...overrides,
  });

describe('buildChartGeometry', () => {
  test('places now, the empty pool and the reset jumps on the span', () => {
    const chart = geometry();
    const plotWidth = chart.plot.right - chart.plot.left;
    const xOf = (at: number) =>
      chart.plot.left + ((at - SPAN.spanStartMs) / (SPAN.spanEndMs - SPAN.spanStartMs)) * plotWidth;

    expect(chart.yMax).toBe(200);
    expect(chart.yTicks.map((tick) => tick.value)).toEqual([0, 100, 200]);
    expect(chart.now?.x).toBeCloseTo(xOf(NOW), 6);
    expect(chart.empty?.at).toBe(section.poolEmptyAt as number);
    expect(chart.empty?.y).toBe(chart.plot.bottom);
    expect(chart.jumps.map((jump) => jump.gain)).toEqual([100, 100]);
    expect(chart.projectedLine.startsWith(`M${Math.round(xOf(NOW) * 10) / 10}`)).toBe(true);
    expect(chart.accountLines).toEqual([]);
  });

  test('labels every day when there is room and every other one when there is not', () => {
    expect(geometry().days.every((day) => day.labelled)).toBe(true);
    const narrow = geometry({ width: 600 }).days;
    expect(narrow.length).toBe(14);
    expect(narrow.filter((day) => day.labelled).length).toBe(7);
  });

  test('draws one boundary between each pair of stacked accounts', () => {
    expect(geometry({ showAccounts: true }).accountLines).toHaveLength(1);
    expect(geometry({ showAccounts: true, mode: 'drain' }).accountLines).toEqual([]);
  });

  test('scales drain mode to the burn', () => {
    const chart = geometry({ mode: 'drain' });
    expect(chart.yMax).toBe(niceCeiling((section.projectedBurn as number) * 1.15));
    expect(chart.jumps).toEqual([]);
    expect(chart.empty).toBeNull();
  });

  test('leaves the projection off a span that ended before now', () => {
    const chart = geometry({
      spanStartMs: SPAN.spanStartMs - 14 * DAY_MS,
      spanEndMs: SPAN.spanStartMs,
    });
    expect(chart.projectedLine).toBe('');
    expect(chart.now).toBeNull();
  });
});

describe('niceCeiling', () => {
  test('rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect([0, 0.7, 1.3, 2.2, 3.9, 7, 12].map(niceCeiling)).toEqual([1, 1, 2, 2.5, 5, 10, 20]);
  });
});

describe('instantAtX and readoutAt', () => {
  const plot = { left: CHART_MARGIN.left, right: CHART_MARGIN.left + 1400, top: 30, bottom: 270 };

  test('snaps to the recorded grid, or to now when close', () => {
    const at = instantAtX(plot.left + 700, plot, SPAN.spanStartMs, SPAN.spanEndMs, NOW);
    expect((at - SPAN.spanStartMs) % FORECAST_STEP_MS).toBe(0);
    const nowX =
      plot.left + ((NOW - SPAN.spanStartMs) / (SPAN.spanEndMs - SPAN.spanStartMs)) * 1400;
    expect(instantAtX(nowX + 0.2, plot, SPAN.spanStartMs, SPAN.spanEndMs, NOW)).toBe(NOW);
    expect(instantAtX(-50, plot, SPAN.spanStartMs, SPAN.spanEndMs, NOW)).toBe(SPAN.spanStartMs);
  });

  test('reads recorded values up to now and the projection after it', () => {
    expect(readoutAt(section, 'remaining', NOW, NOW)).toEqual({
      kind: 'recorded',
      value: 50,
      accounts: [20, 30],
    });
    expect(readoutAt(section, 'remaining', NOW - DAY_MS, NOW).value).toBeNull();

    const later = readoutAt(section, 'remaining', NOW + HOUR_MS, NOW);
    expect(later.kind).toBe('projected');
    expect(later.value).toBeCloseTo(50 - (section.projectedBurn as number), 6);
    expect(readoutAt(section, 'drain', NOW + HOUR_MS, NOW).value).toBe(section.projectedBurn);
  });
});

describe('ForecastPanel rendering', () => {
  test('shows the pool, its stats and the legend', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(ForecastPanel, {
        type: 'claude',
        section,
        settings: DEFAULT_FORECAST_SETTINGS,
        ...SPAN,
        nowMs: NOW,
        color: '#c05621',
        resolvedTheme: 'light',
        locale: 'en',
      })
    );
    expect(markup).toContain('50%');
    expect(markup).toContain('of 200%');
    expect(markup).toContain('2 accounts');
    expect(markup).toContain('Weekly');
    expect(markup).toContain('Pool empty');
    expect(markup).toContain('Burn, window average');
    expect(markup).toContain('first@example.com in ');
    expect(markup).toContain('Projected');
    expect(markup).toContain('aria-label="Claude: 50% of 200% left"');
  });
});
