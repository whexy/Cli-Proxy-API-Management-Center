/**
 * One provider's forecast: which window is pooled, what was recorded, how fast
 * the pool burns, and the projection from now.
 *
 * Pure: the clock, the span and the samples are passed in.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import { startOfDay } from '../quotaTimelineModel';
import { summarizeLedgerWindows, type LedgerQuota } from '../ledger/ledgerModel';
import {
  poolRate,
  trackValueAt,
  usageBuckets,
  windowTrack,
  type QuotaSample,
  type TrackPoint,
} from './history';
import { projectPool, type Projection } from './projection';

/** Spacing of the recorded grid and of projected points between events. */
export const FORECAST_STEP_MS = 10 * MINUTE_MS;
export const FORECAST_SPAN_DAYS = 14;
/** Days of the default span before today. */
export const FORECAST_PAST_DAYS = 3;
/** Stats look this far ahead whatever range the chart shows. */
export const FORECAST_HORIZON_MS = 14 * DAY_MS;

/** A window shorter than this resets too often to read on a fortnight. */
const LONG_WINDOW_HOURS = 24;
/** A window open for less than this has too little use behind it for an average. */
const MIN_WINDOW_AVERAGE_MS = HOUR_MS;
/** Rises below this are rounding, not a reset. */
const MIN_JUMP = 1;

/** The chart's range: `offsetWeeks` weeks on from the default fortnight. */
export function forecastSpan(offsetWeeks: number, nowMs: number) {
  const start = new Date(startOfDay(nowMs));
  start.setDate(start.getDate() - FORECAST_PAST_DAYS + offsetWeeks * 7);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + FORECAST_SPAN_DAYS);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * The window a provider's pool is drawn from: the most constrained one among
 * windows of a day or longer, since a fortnight of 5-hour windows is a
 * sawtooth. Without any, the most constrained window overall.
 */
export function forecastWindowId(
  ledgers: readonly (LedgerQuota | null)[],
  nowMs: number
): string | null {
  const periods = new Map<string, number>();
  ledgers.forEach((ledger) =>
    ledger?.windows.forEach((window) => {
      if (window.periodHours !== null) {
        periods.set(window.id, Math.max(periods.get(window.id) ?? 0, window.periodHours));
      }
    })
  );
  const totals = summarizeLedgerWindows(ledgers, nowMs).filter((total) => total.reporting > 0);
  const long = totals.find((total) => (periods.get(total.id) ?? 0) >= LONG_WINDOW_HOURS);
  return (long ?? totals[0])?.id ?? null;
}

export interface ForecastAccountInput {
  name: string;
  /** Current quota; null when not loaded. */
  ledger: LedgerQuota | null;
  /** This credential's recorded samples, in any order. */
  samples: readonly QuotaSample[];
}

export interface ForecastOptions {
  nowMs: number;
  spanStartMs: number;
  spanEndMs: number;
  lookbackHours: number;
  /** Multiplier on the measured burn for the projection. */
  usageFactor: number;
}

export interface ForecastBurn {
  perHour: number;
  /** `recorded` over the lookback, or `window`: the average since each window opened. */
  source: 'recorded' | 'window';
  /** How much of the lookback the recording covers. */
  coveredMs: number;
}

export interface ForecastJump {
  at: number;
  gain: number;
  /** Pool after the jump. */
  top: number;
  projected: boolean;
}

export interface ForecastSection {
  windowId: string;
  windowLabel: string;
  /** The pooled accounts, in stacking order. */
  names: string[];
  capacity: number;
  poolNow: number;
  recorded: {
    times: number[];
    /** `accounts[k][i]`; null when account `i` was not watched at `times[k]`. */
    accounts: (number | null)[][];
    /** Null when no account was watched. */
    pool: (number | null)[];
  };
  /** Recorded burn over the lookback ending at each time, in points per hour. */
  drain: { times: number[]; values: (number | null)[] };
  burn: ForecastBurn | null;
  /** The burn the projection uses: `burn` times the usage factor. */
  projectedBurn: number | null;
  projection: Projection | null;
  jumps: ForecastJump[];
  poolEmptyAt: number | null;
  firstEmpty: { at: number; name: string } | null;
  nextReset: { at: number; gain: number } | null;
}

interface Member {
  name: string;
  remaining: number;
  resetAt: number | null;
  periodHours: number | null;
  track: TrackPoint[];
}

function windowAverage(members: readonly Member[], nowMs: number): number | null {
  let perHour = 0;
  let measured = false;
  members.forEach((member) => {
    if (member.resetAt === null || member.periodHours === null || member.resetAt <= nowMs) return;
    const elapsed = nowMs - (member.resetAt - member.periodHours * HOUR_MS);
    if (elapsed < MIN_WINDOW_AVERAGE_MS) return;
    measured = true;
    perHour += (100 - member.remaining) / (elapsed / HOUR_MS);
  });
  return measured ? perHour : null;
}

/** Group events at one instant, keeping those that restore at least a point. */
function groupGains(events: { at: number; gain: number }[]) {
  const byTime = new Map<number, number>();
  events.forEach((event) => byTime.set(event.at, (byTime.get(event.at) ?? 0) + event.gain));
  return Array.from(byTime, ([at, gain]) => ({ at, gain })).filter(({ gain }) => gain >= MIN_JUMP);
}

export function buildForecastSection(
  accounts: readonly ForecastAccountInput[],
  options: ForecastOptions
): ForecastSection | null {
  const { nowMs, spanStartMs, spanEndMs, lookbackHours, usageFactor } = options;
  const windowId = forecastWindowId(
    accounts.map((account) => account.ledger),
    nowMs
  );
  if (windowId === null) return null;

  let windowLabel = '';
  const members: Member[] = accounts.flatMap((account) => {
    const window = account.ledger?.windows.find((candidate) => candidate.id === windowId);
    if (!window || window.remainingPercent === null) return [];
    if (!windowLabel) windowLabel = window.label;
    return [
      {
        name: account.name,
        remaining: window.remainingPercent,
        resetAt: window.resetAt,
        periodHours: window.periodHours,
        track: windowTrack(account.samples, windowId),
      },
    ];
  });
  if (members.length === 0) return null;

  const capacity = members.length * 100;
  const poolNow = members.reduce((sum, member) => sum + member.remaining, 0);

  /* ---------- recorded ---------- */

  const recordedEnd = Math.min(nowMs, spanEndMs);
  const times: number[] = [];
  for (let at = spanStartMs; at <= recordedEnd; at += FORECAST_STEP_MS) {
    if (at !== nowMs) times.push(at);
  }
  const recordedAccounts = times.map((at) =>
    members.map((member) => trackValueAt(member.track, at))
  );
  if (nowMs >= spanStartMs && nowMs <= spanEndMs) {
    times.push(nowMs);
    recordedAccounts.push(members.map((member) => member.remaining));
  }
  const recordedPool = recordedAccounts.map((values) =>
    values.some((value) => value !== null)
      ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null
  );

  const recordedGains: { at: number; gain: number; top: number }[] = [];
  for (let k = 1; k < times.length; k += 1) {
    let gain = 0;
    recordedAccounts[k].forEach((value, index) => {
      const before = recordedAccounts[k - 1][index];
      if (value !== null && before !== null && value > before) gain += value - before;
    });
    if (gain < MIN_JUMP) continue;
    const previous = recordedGains[recordedGains.length - 1];
    // A reset spread over neighbouring steps reads as one jump.
    if (previous && times[k - 1] === previous.at) {
      previous.at = times[k];
      previous.gain += gain;
      previous.top = recordedPool[k] ?? previous.top;
    } else {
      recordedGains.push({ at: times[k], gain, top: recordedPool[k] ?? 0 });
    }
  }

  /* ---------- burn ---------- */

  const lookbackMs = lookbackHours * HOUR_MS;
  const recent = poolRate(
    members.map((member) => usageBuckets(member.track, nowMs - lookbackMs, lookbackMs, 1)),
    0,
    0
  );
  const average = recent ? null : windowAverage(members, nowMs);
  const burn: ForecastBurn | null = recent
    ? { perHour: recent.perHour, source: 'recorded', coveredMs: recent.coveredMs }
    : average !== null
      ? { perHour: average, source: 'window', coveredMs: 0 }
      : null;

  const lookbackBuckets = Math.max(1, Math.round(lookbackMs / FORECAST_STEP_MS));
  const drainBuckets = Math.max(0, Math.ceil((recordedEnd - spanStartMs) / FORECAST_STEP_MS));
  const drainUsages = members.map((member) =>
    usageBuckets(
      member.track,
      spanStartMs - lookbackBuckets * FORECAST_STEP_MS,
      FORECAST_STEP_MS,
      lookbackBuckets + drainBuckets
    )
  );
  const drainTimes: number[] = [];
  const drainValues: (number | null)[] = [];
  for (let k = 0; k < drainBuckets; k += 1) {
    drainTimes.push(Math.min(recordedEnd, spanStartMs + (k + 1) * FORECAST_STEP_MS));
    drainValues.push(poolRate(drainUsages, k + 1, k + lookbackBuckets)?.perHour ?? null);
  }

  /* ---------- projection ---------- */

  const projectedBurn = burn === null ? null : burn.perHour * usageFactor;
  const horizonEnd = nowMs + FORECAST_HORIZON_MS;
  const projection =
    projectedBurn === null
      ? null
      : projectPool(
          members.map((member) => ({
            remaining: member.remaining,
            resetAt: member.resetAt,
            periodMs: member.periodHours === null ? null : member.periodHours * HOUR_MS,
          })),
          projectedBurn,
          nowMs,
          Math.max(spanEndMs, horizonEnd),
          FORECAST_STEP_MS
        );

  const projectedGains = projection
    ? groupGains(projection.resets).map(({ at, gain }) => {
        const index = projection.times.lastIndexOf(at);
        return { at, gain, top: projection.pool[index] ?? 0 };
      })
    : [];

  const jumps: ForecastJump[] = [
    ...recordedGains.map((jump) => ({ ...jump, projected: false })),
    ...projectedGains.map((jump) => ({ ...jump, projected: true })),
  ].filter((jump) => jump.at >= spanStartMs && jump.at <= spanEndMs);

  /* ---------- stats ---------- */

  const projectedEmptyAt = projection?.poolEmptyAt ?? null;
  const poolEmptyAt =
    projectedEmptyAt !== null && projectedEmptyAt <= horizonEnd ? projectedEmptyAt : null;

  const dryNow = members.findIndex((member) => member.remaining <= 0);
  const firstDry =
    dryNow !== -1
      ? { at: nowMs, account: dryNow }
      : (projection?.empties.find((event) => event.at <= horizonEnd) ?? null);
  const firstEmpty = firstDry ? { at: firstDry.at, name: members[firstDry.account].name } : null;

  const nextReset = projection
    ? (groupGains(projection.resets).find((reset) => reset.at > nowMs) ?? null)
    : (groupGains(
        members.flatMap((member) =>
          member.resetAt !== null && member.resetAt > nowMs
            ? [{ at: member.resetAt, gain: 100 - member.remaining }]
            : []
        )
      ).sort((a, b) => a.at - b.at)[0] ?? null);

  return {
    windowId,
    windowLabel,
    names: members.map((member) => member.name),
    capacity,
    poolNow,
    recorded: { times, accounts: recordedAccounts, pool: recordedPool },
    drain: { times: drainTimes, values: drainValues },
    burn,
    projectedBurn,
    projection,
    jumps,
    poolEmptyAt,
    firstEmpty,
    nextReset,
  };
}
