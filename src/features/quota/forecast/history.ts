/**
 * Recorded quota history: samples of every credential's windows, and the
 * readings and usage a chart derives from them.
 *
 * CPA keeps no quota history, so the page records its own while it refreshes
 * quotas. A sample says what one credential reported at one instant; a stretch
 * without samples is time nobody watched, and stays a gap.
 *
 * Pure: nothing here reads the clock or storage.
 */

import { HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { LedgerQuota } from '../ledger/ledgerModel';

export interface QuotaSampleWindow {
  id: string;
  /** 0..100, rounded to a tenth; null when the window reports no figure. */
  remaining: number | null;
  resetAt: number | null;
  periodHours: number | null;
}

export interface QuotaSample {
  /** The backend the sample was read through; histories of two backends never mix. */
  scope: string;
  /** Provider and quota cache key; see `historyCredentialKey`. */
  credential: string;
  at: number;
  windows: QuotaSampleWindow[];
}

/** An unchanged reading is still written this often, so steady stretches are not gaps. */
export const SAMPLE_HEARTBEAT_MS = 10 * MINUTE_MS;

/**
 * Samples further apart than this are not joined: the page was closed or the
 * credential failed in between. Above the heartbeat with room for one missed
 * minute refresh.
 */
export const SAMPLE_MAX_GAP_MS = 25 * MINUTE_MS;

/** Readings below this much coverage are too short to call a rate. */
export const MIN_RATE_COVERAGE_MS = 15 * MINUTE_MS;

const RESET_TOLERANCE_MS = MINUTE_MS;
const REMAINING_TOLERANCE = 0.05;
/** A rise this large without a passed reset still restored quota (a reset grant). */
const RISE_THRESHOLD = 0.5;

export const historyCredentialKey = (provider: string, cacheKey: string) =>
  `${provider}:${cacheKey}`;

export function sampleWindows(ledger: LedgerQuota): QuotaSampleWindow[] {
  return ledger.windows.map((window) => ({
    id: window.id,
    remaining:
      window.remainingPercent === null ? null : Math.round(window.remainingPercent * 10) / 10,
    resetAt: window.resetAt,
    periodHours: window.periodHours,
  }));
}

const sameNumber = (a: number | null, b: number | null, tolerance: number) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= tolerance;

function sameWindows(a: readonly QuotaSampleWindow[], b: readonly QuotaSampleWindow[]) {
  return (
    a.length === b.length &&
    a.every(
      (window, index) =>
        window.id === b[index].id &&
        sameNumber(window.remaining, b[index].remaining, REMAINING_TOLERANCE) &&
        sameNumber(window.resetAt, b[index].resetAt, RESET_TOLERANCE_MS)
    )
  );
}

/** Whether `next` adds anything to a history whose last written sample is `previous`. */
export function shouldRecordSample(previous: QuotaSample | undefined, next: QuotaSample): boolean {
  if (!previous) return true;
  if (next.at - previous.at >= SAMPLE_HEARTBEAT_MS) return true;
  return !sameWindows(previous.windows, next.windows);
}

/** One credential's reading of one window. */
export interface TrackPoint {
  at: number;
  remaining: number;
  resetAt: number | null;
  /** The reading stands until here: the next reading, or one heartbeat when none follows soon. */
  until: number;
}

/**
 * A window's readings from one credential's samples, oldest first. Samples
 * without the window or without a figure for it are skipped.
 */
export function windowTrack(samples: readonly QuotaSample[], windowId: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  [...samples]
    .sort((a, b) => a.at - b.at)
    .forEach((sample) => {
      const window = sample.windows.find((candidate) => candidate.id === windowId);
      if (!window || window.remaining === null) return;
      const previous = points[points.length - 1];
      if (previous && sample.at === previous.at) {
        points.pop();
      }
      points.push({
        at: sample.at,
        remaining: window.remaining,
        resetAt: window.resetAt,
        until: sample.at + SAMPLE_HEARTBEAT_MS,
      });
    });
  for (let index = 0; index + 1 < points.length; index += 1) {
    const gap = points[index + 1].at - points[index].at;
    if (gap <= SAMPLE_MAX_GAP_MS) points[index].until = points[index + 1].at;
  }
  return points;
}

/** The reading standing at `atMs`, or null when nobody was watching then. */
export function trackValueAt(track: readonly TrackPoint[], atMs: number): number | null {
  let low = 0;
  let high = track.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (track[middle].at <= atMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found === -1) return null;
  const point = track[found];
  return atMs < point.until || atMs === point.at ? point.remaining : null;
}

/**
 * Whether quota came back between two readings: the earlier reading's reset
 * passed, or the figure rose (a manual reset grant does that without one).
 */
function restoredBetween(from: TrackPoint, to: TrackPoint): boolean {
  if (to.remaining > from.remaining + RISE_THRESHOLD) return true;
  return from.resetAt !== null && from.resetAt > from.at && from.resetAt <= to.at;
}

export interface UsageBuckets {
  /** Percentage points used within each bucket. */
  used: number[];
  /** Milliseconds of each bucket the readings cover. */
  covered: number[];
}

/**
 * Usage and coverage per bucket of `stepMs` from `fromMs`.
 *
 * Use between two joined readings is their drop, spread evenly over the time
 * between them. Across a restore only the drop after it is known: 100 minus
 * the later figure.
 */
export function usageBuckets(
  track: readonly TrackPoint[],
  fromMs: number,
  stepMs: number,
  count: number
): UsageBuckets {
  const used = new Array<number>(count).fill(0);
  const covered = new Array<number>(count).fill(0);
  const endMs = fromMs + stepMs * count;

  for (let index = 0; index + 1 < track.length; index += 1) {
    const start = track[index];
    const end = track[index + 1];
    if (start.until !== end.at || end.at <= start.at) continue;
    if (end.at <= fromMs || start.at >= endMs) continue;

    const drop = restoredBetween(start, end)
      ? Math.max(0, 100 - end.remaining)
      : Math.max(0, start.remaining - end.remaining);
    const span = end.at - start.at;
    const first = Math.max(0, Math.floor((Math.max(start.at, fromMs) - fromMs) / stepMs));
    const last = Math.min(count - 1, Math.floor((Math.min(end.at, endMs) - fromMs - 1) / stepMs));
    for (let bucket = first; bucket <= last; bucket += 1) {
      const bucketStart = fromMs + bucket * stepMs;
      const overlap = Math.min(end.at, bucketStart + stepMs) - Math.max(start.at, bucketStart);
      if (overlap <= 0) continue;
      used[bucket] += (drop * overlap) / span;
      covered[bucket] += overlap;
    }
  }
  return { used, covered };
}

export interface PoolRate {
  /** Percentage points per hour across the accounts that were watched long enough. */
  perHour: number;
  /** The longest stretch any account was watched within the range. */
  coveredMs: number;
}

/**
 * Pool burn over buckets `[first, last]` of each account's usage: every
 * account's own rate over the time it was watched, summed.
 */
export function poolRate(
  usages: readonly UsageBuckets[],
  first: number,
  last: number
): PoolRate | null {
  let perHour = 0;
  let coveredMs = 0;
  let measured = false;
  usages.forEach(({ used, covered }) => {
    let accountUsed = 0;
    let accountCovered = 0;
    for (let bucket = Math.max(0, first); bucket <= last && bucket < used.length; bucket += 1) {
      accountUsed += used[bucket];
      accountCovered += covered[bucket];
    }
    coveredMs = Math.max(coveredMs, accountCovered);
    if (accountCovered < MIN_RATE_COVERAGE_MS) return;
    measured = true;
    perHour += accountUsed / (accountCovered / HOUR_MS);
  });
  return measured ? { perHour, coveredMs } : null;
}
