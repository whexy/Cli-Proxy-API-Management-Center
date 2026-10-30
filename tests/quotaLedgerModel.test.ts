/**
 * Ledger normalization and per-provider totals.
 *
 * The totals drive the summary strip: which window is shown as the binding
 * constraint, the summed figure, and one bar segment per credential.
 */

import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from '@/features/quota/components/QuotaMeter';
import {
  chunk,
  ledgerColumns,
  ledgerLevel,
  normalizeLedgerQuota,
  summarizeLedgerWindows,
  summaryColumns,
  type LedgerQuota,
  type LedgerWindow,
} from '@/features/quota/ledger/ledgerModel';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  PluginQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const t = ((key: string, params?: Record<string, unknown>) =>
  params && Object.keys(params).length > 0 ? `${key}${JSON.stringify(params)}` : key) as TFunction;

const NOW = Date.UTC(2026, 8, 11, 12);

const claudeWindow = (id: string, labelKey: string, usedPercent: number | null, resetAtMs = 0) => ({
  id,
  label: labelKey,
  labelKey,
  usedPercent,
  resetLabel: '-',
  resetAtMs: resetAtMs || null,
  periodHours: 168,
});

describe('normalizeLedgerQuota', () => {
  test('has nothing to normalize until a read succeeds', () => {
    expect(normalizeLedgerQuota('codex', undefined, t)).toBeNull();
    expect(normalizeLedgerQuota('codex', { status: 'idle', windows: [] }, t)).toBeNull();
    expect(normalizeLedgerQuota('codex', { status: 'loading', windows: [] }, t)).toBeNull();
    expect(normalizeLedgerQuota('kimi', { status: 'error', rows: [], error: 'x' }, t)).toBeNull();
  });

  test('Claude converts percent used to remaining and keeps its plan', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      planType: 'plan_max',
      windows: [
        claudeWindow('five-hour', 'claude_quota.five_hour', 0),
        claudeWindow('seven-day-fable', 'claude_quota.seven_day_fable', 42, NOW + DAY_MS),
        claudeWindow('seven-day', 'claude_quota.seven_day', 130),
        claudeWindow('seven-day-opus', 'claude_quota.seven_day_opus', null),
      ],
    };

    expect(normalizeLedgerQuota('claude', quota, t)).toEqual({
      plan: 'claude_quota.plan_max',
      windows: [
        { id: 'five-hour', label: 'claude_quota.five_hour', remainingPercent: 100, resetAt: null },
        {
          id: 'seven-day-fable',
          label: 'claude_quota.seven_day_fable',
          remainingPercent: 58,
          resetAt: NOW + DAY_MS,
        },
        { id: 'seven-day', label: 'claude_quota.seven_day', remainingPercent: 0, resetAt: null },
        {
          id: 'seven-day-opus',
          label: 'claude_quota.seven_day_opus',
          remainingPercent: null,
          resetAt: null,
        },
      ],
    });
  });

  test('Claude keeps its retained observation through a refresh or a failed read', () => {
    const windows = [claudeWindow('five-hour', 'claude_quota.five_hour', 10)];
    for (const status of ['loading', 'error'] as const) {
      const ledger = normalizeLedgerQuota('claude', { status, windows, stale: true }, t);
      expect(ledger?.windows.map((window) => window.remainingPercent)).toEqual([90]);
    }
    expect(normalizeLedgerQuota('claude', { status: 'loading', windows: [] }, t)).toBeNull();
  });

  test('Codex passes label parameters and maps plan tiers like its card', () => {
    const quota = (planType: string): CodexQuotaState => ({
      status: 'success',
      planType,
      windows: [
        {
          id: 'additional-weekly',
          label: 'x',
          labelKey: 'codex_quota.additional_secondary_window',
          labelParams: { name: 'Spark' },
          usedPercent: 83,
          resetLabel: '-',
          resetAtMs: NOW + 2 * DAY_MS,
        },
      ],
    });

    const ledger = normalizeLedgerQuota('codex', quota('pro'), t);
    expect(ledger?.windows).toEqual([
      {
        id: 'additional-weekly',
        label: 'codex_quota.additional_secondary_window{"name":"Spark"}',
        remainingPercent: 17,
        resetAt: NOW + 2 * DAY_MS,
      },
    ]);
    expect(ledger?.plan).toBe('codex_quota.plan_pro');
    expect(normalizeLedgerQuota('codex', quota('promax'), t)?.plan).toBe('codex_quota.plan_promax');
    expect(normalizeLedgerQuota('codex', quota('prolite'), t)?.plan).toBe(
      'codex_quota.plan_prolite'
    );
    expect(normalizeLedgerQuota('codex', quota('self_serve_business_prolite'), t)?.plan).toBe(
      'codex_quota.plan_business_premium'
    );
    expect(normalizeLedgerQuota('codex', quota('plus'), t)?.plan).toBe('codex_quota.plan_plus');
  });

  test('Kimi identifies a limit by its label, not its position', () => {
    const quota = (rowId: string): KimiQuotaState => ({
      status: 'success',
      rows: [
        {
          id: rowId,
          labelKey: 'kimi_quota.limit_window',
          labelParams: { duration: '5h' },
          used: 25,
          limit: 100,
          resetAtMs: NOW + HOUR_MS,
        },
        { id: 'summary', labelKey: 'kimi_quota.weekly_limit', used: 3, limit: 0 },
      ],
    });

    const first = normalizeLedgerQuota('kimi', quota('limit-0'), t);
    const second = normalizeLedgerQuota('kimi', quota('limit-1'), t);
    expect(first?.windows[0].id).toBe(second?.windows[0].id as string);
    expect(first?.windows.map((window) => window.remainingPercent)).toEqual([75, 0]);
    expect(first?.windows[0].label).toBe('kimi_quota.limit_window{"duration":"5h"}');
  });

  const billing = (overrides: Partial<XaiBillingSummary>): XaiBillingSummary => ({
    mode: 'billing',
    periodType: 'weekly',
    usagePercent: null,
    periodEnd: new Date(NOW + 5 * DAY_MS).toISOString(),
    productUsage: [],
    monthlyLimitCents: null,
    usedCents: null,
    includedUsedCents: null,
    onDemandCapCents: null,
    onDemandUsedCents: null,
    onDemandUsedPercent: null,
    usedPercent: null,
    resetAtMs: NOW + 5 * DAY_MS,
    ...overrides,
  });

  test('xAI reports a weekly window without a figure when usage is unavailable', () => {
    const quota: XaiQuotaState = { status: 'success', billing: billing({}) };
    expect(normalizeLedgerQuota('xai', quota, t)).toEqual({
      plan: null,
      windows: [
        {
          id: 'weekly',
          label: 'xai_quota.weekly_limit',
          remainingPercent: null,
          resetAt: NOW + 5 * DAY_MS,
        },
      ],
    });
  });

  test('xAI adds monthly credits and pay-as-you-go when the account has them', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: billing({
        periodType: 'monthly',
        monthlyLimitCents: 15_000,
        usedCents: 3_000,
        usedPercent: 20,
        billingPeriodEnd: new Date(NOW + 10 * DAY_MS).toISOString(),
        onDemandCapCents: 1_000,
        onDemandUsedPercent: 40,
      }),
    };
    const ledger = normalizeLedgerQuota('xai', quota, t);
    expect(ledger?.plan).toBe('xai_quota.plan_supergrok');
    expect(ledger?.windows).toEqual([
      {
        id: 'on-demand',
        label: 'xai_quota.pay_as_you_go_label',
        remainingPercent: 60,
        resetAt: null,
      },
      {
        id: 'monthly',
        label: 'xai_quota.monthly_credits',
        remainingPercent: 80,
        resetAt: NOW + 10 * DAY_MS,
      },
    ]);
  });

  test('xAI paid-health accounts have a plan but no percentage windows', () => {
    const quota: XaiQuotaState = {
      status: 'success',
      billing: billing({ mode: 'paid-health', planLabel: 'SuperGrok Heavy' }),
    };
    expect(normalizeLedgerQuota('xai', quota, t)).toEqual({
      windows: [],
      plan: 'SuperGrok Heavy',
    });
  });

  test('Antigravity ids come from resolved labels, so per-account bucket ids still align', () => {
    const quota = (bucketId: string): AntigravityQuotaState => ({
      status: 'success',
      subscription: { plan: 'ultra', tierName: null, tierId: null },
      groups: [
        {
          id: 'gemini-models',
          label: 'Gemini Models',
          buckets: [
            {
              id: bucketId,
              label: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.35,
              resetAtMs: NOW + 6 * DAY_MS,
            },
          ],
        },
      ],
    });

    const first = normalizeLedgerQuota('antigravity', quota('bucket-a'), t);
    const second = normalizeLedgerQuota('antigravity', quota('bucket-b'), t);
    expect(first?.windows[0]).toEqual({
      id: 'group_gemini_models/weekly_limit',
      label: 'antigravity_quota.group_gemini_models · antigravity_quota.weekly_limit',
      remainingPercent: 35,
      resetAt: NOW + 6 * DAY_MS,
    });
    expect(second?.windows[0].id).toBe(first?.windows[0].id as string);
    expect(first?.plan).toBe('antigravity_subscription.plan_ultra');
  });

  test('plugin buckets read like Antigravity without repeating an identical group name', () => {
    const quota: PluginQuotaState = {
      status: 'success',
      summary: [],
      subscription: { plan: 'pro', tierName: 'Team Pro', tierId: null },
      groups: [
        {
          id: 'requests',
          label: 'Requests',
          buckets: [
            {
              id: 'daily',
              label: 'Requests',
              remainingFraction: 0.5,
              resetTime: new Date(NOW + HOUR_MS).toISOString(),
            },
          ],
        },
      ],
    };
    expect(normalizeLedgerQuota('plugin', quota, t)).toEqual({
      plan: 'Team Pro',
      windows: [
        { id: 'requests/daily', label: 'Requests', remainingPercent: 50, resetAt: NOW + HOUR_MS },
      ],
    });
  });

  test('Devin and Meta keep unknown figures unknown', () => {
    const devin: DevinQuotaState = {
      status: 'success',
      plan: 'Teams',
      observedAtMs: null,
      planStartMs: null,
      planEndMs: null,
      windows: [
        { id: 'daily', remainingPercent: 64, resetAtMs: NOW + HOUR_MS, periodHours: 24 },
        { id: 'weekly', remainingPercent: null, resetAtMs: null, periodHours: 168 },
      ],
    };
    expect(normalizeLedgerQuota('devin', devin, t)).toEqual({
      plan: 'Teams',
      windows: [
        { id: 'daily', label: 'devin_quota.daily', remainingPercent: 64, resetAt: NOW + HOUR_MS },
        { id: 'weekly', label: 'devin_quota.weekly', remainingPercent: null, resetAt: null },
      ],
    });

    const meta: MetaQuotaState = {
      status: 'success',
      data: {
        windows: [
          { id: 'window', usedPercent: 12.5, resetAt: NOW / 1000 + 600, durationMinutes: 300 },
          { id: 'weekly', usedPercent: null },
        ],
      },
    };
    expect(normalizeLedgerQuota('meta', meta, t)?.windows).toEqual([
      {
        id: 'window',
        label: 'meta_quota.window_duration_hours{"hours":5}',
        remainingPercent: 87.5,
        resetAt: NOW + 600_000,
      },
      { id: 'weekly', label: 'meta_quota.weekly', remainingPercent: null, resetAt: null },
    ]);
  });
});

const win = (
  id: string,
  remainingPercent: number | null,
  resetAt: number | null = null
): LedgerWindow => ({ id, label: id, remainingPercent, resetAt });

const quota = (...windows: LedgerWindow[]): LedgerQuota => ({ windows, plan: null });

describe('summarizeLedgerWindows', () => {
  test('puts the window with the lowest summed remaining first', () => {
    const remaining = {
      fable: [58, 100, 100, 51, 100],
      fiveHour: [100, 100, 100, 99, 100],
      sevenDay: [79, 100, 100, 75, 100],
    };
    const credentials = remaining.fable.map((_, index) =>
      quota(
        win('five-hour', remaining.fiveHour[index]),
        win('seven-day', remaining.sevenDay[index]),
        win('seven-day-fable', remaining.fable[index])
      )
    );

    const totals = summarizeLedgerWindows(credentials, NOW);
    expect(totals.map((total) => [total.id, total.remainingSum, total.reporting])).toEqual([
      ['seven-day-fable', 409, 5],
      ['seven-day', 454, 5],
      ['five-hour', 499, 5],
    ]);
    expect(totals[0].segments).toEqual(remaining.fable);
  });

  test('sums the rounded figures each row displays', () => {
    const totals = summarizeLedgerWindows([quota(win('w', 40.4)), quota(win('w', 40.4))], NOW);
    expect(totals[0].remainingSum).toBe(80);
    expect(totals[0].segments).toEqual([40, 40]);
  });

  test('gives unloaded credentials an empty segment and no share of the capacity', () => {
    const totals = summarizeLedgerWindows([quota(win('weekly', 17)), null, null], NOW);
    expect(totals[0]).toMatchObject({ remainingSum: 17, reporting: 1, segments: [17, null, null] });
    expect(summarizeLedgerWindows([null, null], NOW)).toEqual([]);
  });

  test('counts a window a loaded credential does not have as unconstrained', () => {
    // Opus exists on one account: 50 + 100 + 100 = 250 against the shared 240.
    const totals = summarizeLedgerWindows(
      [
        quota(win('weekly', 80), win('opus', 50)),
        quota(win('weekly', 80)),
        quota(win('weekly', 80)),
      ],
      NOW
    );
    expect(totals.map((total) => total.id)).toEqual(['weekly', 'opus']);
    expect(totals[1]).toMatchObject({ remainingSum: 50, reporting: 1 });

    const tighter = summarizeLedgerWindows(
      [quota(win('weekly', 90), win('opus', 10)), quota(win('weekly', 90))],
      NOW
    );
    expect(tighter[0].id).toBe('opus');
  });

  test('ranks windows without any figure last, but still reports them', () => {
    const only = summarizeLedgerWindows([quota(win('weekly', null, NOW + 5 * DAY_MS))], NOW);
    expect(only).toEqual([
      {
        id: 'weekly',
        label: 'weekly',
        remainingSum: null,
        reporting: 0,
        nextResetAt: NOW + 5 * DAY_MS,
        segments: [null],
      },
    ]);

    const mixed = summarizeLedgerWindows([quota(win('unknown', null), win('known', 100))], NOW);
    expect(mixed.map((total) => total.id)).toEqual(['known', 'unknown']);
  });

  test('keeps first-appearance order on ties', () => {
    const totals = summarizeLedgerWindows([quota(win('b', 50), win('a', 50))], NOW);
    expect(totals.map((total) => total.id)).toEqual(['b', 'a']);
  });

  test('reports the earliest reset still ahead of now', () => {
    const totals = summarizeLedgerWindows(
      [
        quota(win('weekly', 10, NOW - HOUR_MS)),
        quota(win('weekly', 10, NOW + 3 * DAY_MS)),
        quota(win('weekly', 10, NOW + DAY_MS)),
      ],
      NOW
    );
    expect(totals[0].nextResetAt).toBe(NOW + DAY_MS);
    expect(summarizeLedgerWindows([quota(win('w', 1, NOW - 1))], NOW)[0].nextResetAt).toBeNull();
  });
});

describe('ledgerColumns', () => {
  test('leads with the primary window, then the order providers report', () => {
    const columns = ledgerColumns(
      [
        quota(win('five-hour', 1), win('seven-day', 1)),
        null,
        quota(win('five-hour', 1), win('seven-day', 1), win('seven-day-fable', 1)),
      ],
      'seven-day-fable'
    );
    expect(columns.map((column) => column.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(ledgerColumns([quota(win('a', 1))], null).map((column) => column.id)).toEqual(['a']);
  });
});

describe('ledger helpers', () => {
  test('levels follow the quota meter thresholds', () => {
    expect(ledgerLevel(100)).toBe('high');
    expect(ledgerLevel(QUOTA_PROGRESS_HIGH_THRESHOLD)).toBe('high');
    expect(ledgerLevel(QUOTA_PROGRESS_HIGH_THRESHOLD - 1)).toBe('medium');
    expect(ledgerLevel(QUOTA_PROGRESS_MEDIUM_THRESHOLD)).toBe('medium');
    expect(ledgerLevel(QUOTA_PROGRESS_MEDIUM_THRESHOLD - 1)).toBe('low');
    expect(ledgerLevel(0)).toBe('low');
  });

  test('summary rows hold at most four cards, balanced', () => {
    expect([1, 3, 4, 5, 6, 7, 8, 9].map(summaryColumns)).toEqual([1, 3, 4, 3, 3, 4, 4, 3]);
    expect(summaryColumns(0)).toBe(1);
  });

  test('chunk splits into page-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 20)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});
