/**
 * Ledger view model: every provider's quota state as comparable percentage
 * windows, and per-provider totals built from them.
 *
 * Pure: `t` and `nowMs` are passed in, and nothing here reads the store.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  AntigravityQuotaSubscription,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';
import { PREMIUM_CODEX_PLAN_TYPES, normalizePlanType, parseIsoToMs } from '@/utils/quota';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from '../components/QuotaMeter';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
} from '../providers/antigravity/labels';
import type { QuotaProviderType } from '../providers/types';

export interface LedgerWindow {
  /** Stable across one provider's credentials, so columns and totals line up. */
  id: string;
  label: string;
  /** 0..100; null when the window is reported without a usable figure. */
  remainingPercent: number | null;
  /** Epoch ms of the next reset; null when none is reported. */
  resetAt: number | null;
  /** Window length; null when the provider does not state it. */
  periodHours: number | null;
}

export interface LedgerQuota {
  windows: LedgerWindow[];
  plan: string | null;
}

export type LedgerLevel = 'high' | 'medium' | 'low';

export const ledgerLevel = (percent: number): LedgerLevel =>
  percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
    ? 'high'
    : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
      ? 'medium'
      : 'low';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const positiveOrNull = (value: unknown): number | null => {
  const number = finiteOrNull(value);
  return number !== null && number > 0 ? number : null;
};

const remainingFromUsed = (used: unknown): number | null => {
  const value = finiteOrNull(used);
  return value === null ? null : clampPercent(100 - value);
};

const remainingFromFraction = (fraction: unknown): number | null => {
  const value = finiteOrNull(fraction);
  return value === null ? null : clampPercent(value * 100);
};

const joinLabel = (scope: string, label: string) =>
  scope && scope !== label ? `${scope} · ${label}` : label;

/* ---------- plan labels (same mapping as each provider's card body) ---------- */

const codexPlanLabel = (planType: string | null | undefined, t: TFunction): string | null => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') return t('codex_quota.plan_business_premium');
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};

const antigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return subscription.tierName || subscription.tierId || null;
};

const XAI_PLAN_KEYS = new Map<number, string>([
  [15_000, 'xai_quota.plan_supergrok'],
  [150_000, 'xai_quota.plan_supergrok_heavy'],
]);

/* ---------- per-provider normalization ---------- */

function claudeLedger(quota: ClaudeQuotaState, t: TFunction): LedgerQuota {
  return {
    windows: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey ? t(window.labelKey) : window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAt: finiteOrNull(window.resetAtMs),
      periodHours: positiveOrNull(window.periodHours),
    })),
    plan: quota.planType ? t(`claude_quota.${quota.planType}`) : null,
  };
}

function codexLedger(quota: CodexQuotaState, t: TFunction): LedgerQuota {
  return {
    windows: (quota.windows ?? []).map((window) => ({
      id: window.id,
      label: window.labelKey ? t(window.labelKey, window.labelParams ?? {}) : window.label,
      remainingPercent: remainingFromUsed(window.usedPercent),
      resetAt: finiteOrNull(window.resetAtMs),
      periodHours: positiveOrNull(window.periodHours),
    })),
    plan: codexPlanLabel(quota.planType, t),
  };
}

function devinLedger(quota: DevinQuotaState, t: TFunction): LedgerQuota {
  return {
    windows: (quota.windows ?? []).map((window) => {
      const remaining = finiteOrNull(window.remainingPercent);
      return {
        id: window.id,
        label: t(`devin_quota.${window.id}`),
        remainingPercent: remaining === null ? null : clampPercent(remaining),
        resetAt: finiteOrNull(window.resetAtMs),
        periodHours: positiveOrNull(window.periodHours),
      };
    }),
    plan: quota.plan || null,
  };
}

function kimiLedger(quota: KimiQuotaState, t: TFunction): LedgerQuota {
  return {
    windows: (quota.rows ?? []).map((row) => ({
      // Row ids are positional (`limit-0`); the label identifies the limit.
      id: row.labelKey
        ? `${row.labelKey}:${JSON.stringify(row.labelParams ?? {})}`
        : `label:${row.label ?? row.id}`,
      label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? ''),
      remainingPercent:
        row.limit > 0
          ? clampPercent(((row.limit - row.used) / row.limit) * 100)
          : row.used > 0
            ? 0
            : null,
      resetAt: finiteOrNull(row.resetAtMs),
      periodHours: positiveOrNull(row.periodHours),
    })),
    plan: null,
  };
}

function xaiLedger(quota: XaiQuotaState, t: TFunction): LedgerQuota {
  const billing = quota.billing;
  if (!billing) return { windows: [], plan: null };

  if (billing.mode === 'paid-health') {
    return { windows: [], plan: billing.planLabel ?? t('xai_quota.plan_paid') };
  }

  const planKey =
    billing.monthlyLimitCents === null ? undefined : XAI_PLAN_KEYS.get(billing.monthlyLimitCents);
  const windows: LedgerWindow[] = [];
  const hasWeekly =
    billing.periodType === 'weekly' &&
    (billing.usagePercent !== null ||
      Boolean(billing.periodEnd) ||
      billing.productUsage.length > 0);
  if (hasWeekly) {
    windows.push({
      id: 'weekly',
      label: t('xai_quota.weekly_limit'),
      remainingPercent: remainingFromUsed(billing.usagePercent),
      resetAt: finiteOrNull(billing.resetAtMs),
      periodHours: positiveOrNull(billing.periodHours),
    });
  }
  if ((billing.onDemandCapCents ?? 0) > 0) {
    windows.push({
      id: 'on-demand',
      label: t('xai_quota.pay_as_you_go_label'),
      remainingPercent: remainingFromUsed(billing.onDemandUsedPercent),
      resetAt: null,
      periodHours: null,
    });
  }
  const hasMonthly =
    (billing.monthlyLimitCents !== null ||
      billing.usedCents !== null ||
      Boolean(billing.billingPeriodEnd)) &&
    !(hasWeekly && billing.monthlyLimitCents === 0 && billing.usedCents === 0);
  if (hasMonthly) {
    windows.push({
      id: 'monthly',
      label: t('xai_quota.monthly_credits'),
      remainingPercent: remainingFromUsed(billing.usedPercent),
      resetAt: parseIsoToMs(billing.billingPeriodEnd),
      periodHours: null,
    });
  }

  return { windows, plan: billing.planLabel ?? (planKey ? t(planKey) : null) };
}

function antigravityLedger(quota: AntigravityQuotaState, t: TFunction): LedgerQuota {
  return {
    windows: (quota.groups ?? []).flatMap((group) => {
      const groupKey = resolveAntigravityGroupLabelKey(group.label);
      const groupLabel = groupKey ? t(`antigravity_quota.${groupKey}`) : group.label;
      return group.buckets.map((bucket) => {
        const bucketKey = resolveAntigravityBucketLabelKey(bucket.label, bucket.window);
        return {
          // Bucket ids can be per-account; the resolved labels are not.
          id: `${groupKey ?? group.label}/${bucketKey ?? bucket.label}`,
          label: joinLabel(
            groupLabel,
            bucketKey ? t(`antigravity_quota.${bucketKey}`) : bucket.label
          ),
          remainingPercent: remainingFromFraction(bucket.remainingFraction),
          resetAt: finiteOrNull(bucket.resetAtMs) ?? parseIsoToMs(bucket.resetTime),
          periodHours: positiveOrNull(bucket.periodHours),
        };
      });
    }),
    plan: antigravityPlanLabel(quota.subscription, t),
  };
}

function pluginLedger(quota: PluginQuotaState): LedgerQuota {
  const subscription = quota.subscription;
  return {
    windows: (quota.groups ?? []).flatMap((group) =>
      group.buckets.map((bucket) => ({
        id: `${group.id}/${bucket.id}`,
        label: joinLabel(group.label, bucket.label),
        remainingPercent: remainingFromFraction(bucket.remainingFraction),
        resetAt: finiteOrNull(bucket.resetAtMs) ?? parseIsoToMs(bucket.resetTime),
        periodHours: positiveOrNull(bucket.periodHours),
      }))
    ),
    plan: subscription?.tierName || subscription?.plan || subscription?.tierId || null,
  };
}

const META_WEEKLY_HOURS = 168;

function metaLedger(quota: MetaQuotaState, t: TFunction): LedgerQuota {
  const data = quota.data;
  if (!data) return { windows: [], plan: null };
  return {
    windows: data.windows.map((window) => {
      const minutes = window.durationMinutes;
      const label =
        window.id === 'window' && minutes
          ? minutes % 60 === 0
            ? t('meta_quota.window_duration_hours', { hours: minutes / 60 })
            : t('meta_quota.window_duration', { minutes })
          : t(`meta_quota.${window.id}`);
      const resetAt = finiteOrNull(window.resetAt);
      return {
        id: window.id,
        label,
        remainingPercent: remainingFromUsed(window.usedPercent),
        resetAt: resetAt === null ? null : resetAt * 1000,
        periodHours: window.id === 'weekly' ? META_WEEKLY_HOURS : minutes ? minutes / 60 : null,
      };
    }),
    plan: data.planName || null,
  };
}

/**
 * Percentage windows and plan for one credential's quota state.
 *
 * Returns null unless the state holds data. Claude is the one provider whose
 * store keeps the previous observation through a refresh or a failed read.
 */
export function normalizeLedgerQuota(
  provider: QuotaProviderType,
  quota: unknown,
  t: TFunction
): LedgerQuota | null {
  const state = quota as { status?: string } | undefined;
  if (!state) return null;
  const retained =
    provider === 'claude' &&
    (state.status === 'loading' || state.status === 'error') &&
    ((quota as ClaudeQuotaState).windows?.length ?? 0) > 0;
  if (state.status !== 'success' && !retained) return null;

  switch (provider) {
    case 'claude':
      return claudeLedger(quota as ClaudeQuotaState, t);
    case 'codex':
      return codexLedger(quota as CodexQuotaState, t);
    case 'devin':
      return devinLedger(quota as DevinQuotaState, t);
    case 'kimi':
      return kimiLedger(quota as KimiQuotaState, t);
    case 'xai':
      return xaiLedger(quota as XaiQuotaState, t);
    case 'antigravity':
      return antigravityLedger(quota as AntigravityQuotaState, t);
    case 'plugin':
      return pluginLedger(quota as PluginQuotaState);
    case 'meta':
      return metaLedger(quota as MetaQuotaState, t);
    default:
      return null;
  }
}

/* ---------- provider totals ---------- */

export interface LedgerWindowTotal {
  id: string;
  label: string;
  /** Sum of the displayed (rounded) figures; null when no credential reports one. */
  remainingSum: number | null;
  /** Credentials reporting a figure for this window. */
  reporting: number;
  /** Earliest reset still ahead of `nowMs` among the credentials. */
  nextResetAt: number | null;
  /** One entry per input credential: its rounded figure, or null. */
  segments: (number | null)[];
}

/**
 * Totals for each window across one provider's credentials, most constrained
 * first. `credentials` holds one entry per listed credential; null means not
 * loaded.
 *
 * The order is the summed remaining percentage, with a loaded credential that
 * does not report a window counted as unconstrained (100%) by it. Without
 * that, a window only some accounts have would always look the tightest.
 * Windows nobody reports a figure for cannot be compared and come last; ties
 * keep first-appearance order.
 */
export function summarizeLedgerWindows(
  credentials: readonly (LedgerQuota | null)[],
  nowMs: number
): LedgerWindowTotal[] {
  const loaded = credentials.filter((quota) => quota !== null).length;
  const totals = new Map<string, LedgerWindowTotal>();

  credentials.forEach((quota, index) => {
    quota?.windows.forEach((window) => {
      let total = totals.get(window.id);
      if (!total) {
        total = {
          id: window.id,
          label: window.label,
          remainingSum: null,
          reporting: 0,
          nextResetAt: null,
          segments: credentials.map(() => null),
        };
        totals.set(window.id, total);
      }
      if (window.remainingPercent !== null) {
        const rounded = Math.round(window.remainingPercent);
        total.remainingSum = (total.remainingSum ?? 0) + rounded;
        total.reporting += 1;
        total.segments[index] = rounded;
      }
      if (
        window.resetAt !== null &&
        window.resetAt > nowMs &&
        (total.nextResetAt === null || window.resetAt < total.nextResetAt)
      ) {
        total.nextResetAt = window.resetAt;
      }
    });
  });

  const constraint = (total: LedgerWindowTotal) =>
    total.remainingSum === null
      ? Number.POSITIVE_INFINITY
      : total.remainingSum + 100 * (loaded - total.reporting);

  return Array.from(totals.values())
    .map((total, order) => ({ total, order, key: constraint(total) }))
    .sort((a, b) => (a.key === b.key ? a.order - b.order : a.key < b.key ? -1 : 1))
    .map(({ total }) => total);
}

export interface LedgerColumn {
  id: string;
  label: string;
}

/**
 * Columns for a provider section: the binding window first so it leads every
 * row, then the rest in the order the provider reports them.
 */
export function ledgerColumns(
  credentials: readonly (LedgerQuota | null)[],
  primaryId: string | null
): LedgerColumn[] {
  const columns = new Map<string, LedgerColumn>();
  credentials.forEach((quota) =>
    quota?.windows.forEach((window) => {
      if (!columns.has(window.id)) columns.set(window.id, { id: window.id, label: window.label });
    })
  );
  const ordered = Array.from(columns.values());
  const primaryIndex = ordered.findIndex((column) => column.id === primaryId);
  if (primaryIndex > 0) ordered.unshift(...ordered.splice(primaryIndex, 1));
  return ordered;
}

const SUMMARY_MAX_COLUMNS = 4;

/**
 * Cards per summary row: at most four, spread evenly so six providers read as
 * two rows of three rather than five and a stray one.
 */
export function summaryColumns(count: number): number {
  if (count <= 0) return 1;
  return Math.ceil(count / Math.ceil(count / SUMMARY_MAX_COLUMNS));
}

/** Split `items` into consecutive batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += step) {
    batches.push(items.slice(start, start + step));
  }
  return batches;
}
