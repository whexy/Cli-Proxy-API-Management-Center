/**
 * Where a provider's pool goes from here.
 *
 * The pool drains at one rate, split evenly over the accounts that still have
 * quota, as CPA's default round-robin routing spreads requests. An account
 * that runs dry hands its share to the rest; a reset puts it back at 100%.
 *
 * Pure: the start instant is passed in.
 */

import { HOUR_MS } from '@/utils/time/durations';

export interface ProjectionAccount {
  /** 0..100 now. */
  remaining: number;
  resetAt: number | null;
  /** Window length; resets repeat at this interval. Null resets once, if at all. */
  periodMs: number | null;
}

export interface ProjectionEvent {
  at: number;
  account: number;
}

export interface ProjectionReset extends ProjectionEvent {
  /** Percentage points the reset restored. */
  gain: number;
}

export interface Projection {
  /** Ascending. A reset repeats its instant: the value before it, then after. */
  times: number[];
  /** `values[k][i]`: account `i` at `times[k]`. */
  values: number[][];
  pool: number[];
  resets: ProjectionReset[];
  /** Each time an account runs dry. */
  empties: ProjectionEvent[];
  /** First instant no account has quota left; the start when that is already so. */
  poolEmptyAt: number | null;
}

const EPSILON = 1e-6;

/** The first reset after `afterMs`, moving a passed one on by whole periods. */
function upcomingReset(resetAt: number, periodMs: number | null, afterMs: number) {
  if (resetAt > afterMs) return resetAt;
  if (!periodMs) return null;
  return resetAt + Math.ceil((afterMs - resetAt + 1) / periodMs) * periodMs;
}

/**
 * @param burnPerHour pool drain in percentage points per hour
 * @param stepMs spacing of the returned points between events
 */
export function projectPool(
  accounts: readonly ProjectionAccount[],
  burnPerHour: number,
  fromMs: number,
  untilMs: number,
  stepMs: number
): Projection {
  const remaining = accounts.map((account) => Math.min(100, Math.max(0, account.remaining)));
  const nextReset = accounts.map((account, index) => {
    if (account.resetAt === null) return null;
    if (account.resetAt > fromMs) return account.resetAt;
    // The reading predates its reset, which has since restored the account.
    remaining[index] = 100;
    return upcomingReset(account.resetAt, account.periodMs, fromMs);
  });

  const times: number[] = [];
  const values: number[][] = [];
  const pool: number[] = [];
  const resets: ProjectionReset[] = [];
  const empties: ProjectionEvent[] = [];
  let poolEmptyAt: number | null = null;

  const push = (at: number) => {
    times.push(at);
    values.push(remaining.slice());
    pool.push(remaining.reduce((sum, value) => sum + value, 0));
  };
  const markPoolEmpty = (at: number) => {
    if (poolEmptyAt === null && accounts.length > 0) poolEmptyAt = at;
  };

  const ratePerMs = Math.max(0, burnPerHour) / HOUR_MS;

  const drain = (startMs: number, endMs: number) => {
    let amount = ratePerMs * (endMs - startMs);
    let cursor = startMs;
    while (amount > EPSILON) {
      const active = remaining.flatMap((value, index) => (value > EPSILON ? [index] : []));
      if (active.length === 0) {
        markPoolEmpty(cursor);
        return;
      }
      // A window that has not started yet starts with its first use.
      active.forEach((index) => {
        const periodMs = accounts[index].periodMs;
        if (nextReset[index] === null && accounts[index].resetAt === null && periodMs) {
          nextReset[index] = cursor + periodMs;
        }
      });
      const share = amount / active.length;
      const smallest = Math.min(...active.map((index) => remaining[index]));
      const step = Math.min(share, smallest);
      cursor = share <= smallest ? endMs : cursor + (smallest * active.length) / ratePerMs;
      amount -= step * active.length;
      let emptied = false;
      active.forEach((index) => {
        remaining[index] -= step;
        if (remaining[index] <= EPSILON) {
          remaining[index] = 0;
          empties.push({ at: cursor, account: index });
          emptied = true;
        }
      });
      if (!emptied) return;
      push(cursor);
      if (remaining.every((value) => value <= EPSILON)) markPoolEmpty(cursor);
    }
  };

  if (accounts.length > 0 && remaining.every((value) => value <= EPSILON)) {
    markPoolEmpty(fromMs);
  }
  push(fromMs);

  let cursor = fromMs;
  while (cursor < untilMs) {
    const due = nextReset.reduce<number>(
      (soonest, at) => (at !== null && at > cursor && at < soonest ? at : soonest),
      Number.POSITIVE_INFINITY
    );
    const next = Math.min(cursor + stepMs, untilMs, due);
    drain(cursor, next);
    cursor = next;

    const resetting = nextReset.flatMap((at, index) =>
      at !== null && at <= cursor ? [index] : []
    );
    if (resetting.length > 0) {
      push(cursor);
      resetting.forEach((index) => {
        resets.push({ at: cursor, account: index, gain: 100 - remaining[index] });
        remaining[index] = 100;
        nextReset[index] = upcomingReset(
          nextReset[index] as number,
          accounts[index].periodMs,
          cursor
        );
      });
    }
    if (times[times.length - 1] !== cursor || resetting.length > 0) push(cursor);
  }

  return { times, values, pool, resets, empties, poolEmptyAt };
}

/** Index of the last point at or before `atMs`; -1 when `atMs` precedes them all. */
function pointBefore(times: readonly number[], atMs: number): number {
  let low = 0;
  let high = times.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= atMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Each account's projected figure at `atMs`, linear between points; null outside the run. */
export function projectionAt(projection: Projection, atMs: number): number[] | null {
  const { times, values } = projection;
  const index = pointBefore(times, atMs);
  if (index === -1) return null;
  if (index === times.length - 1) return atMs === times[index] ? values[index] : null;
  const span = times[index + 1] - times[index];
  if (span <= 0) return values[index + 1];
  const ratio = (atMs - times[index]) / span;
  return values[index].map(
    (value, account) => value + (values[index + 1][account] - value) * ratio
  );
}
