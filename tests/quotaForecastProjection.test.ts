import { describe, expect, test } from 'bun:test';
import { projectPool, projectionAt } from '@/features/quota/forecast/projection';
import { HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = Date.UTC(2026, 9, 26, 12);
const STEP = 10 * MINUTE_MS;
const WEEK = 168 * HOUR_MS;
const hoursFromNow = (at: number) => (at - NOW) / HOUR_MS;

describe('projectPool', () => {
  test('splits the burn evenly and hands a dry account’s share to the rest', () => {
    const projection = projectPool(
      [
        { remaining: 50, resetAt: NOW + 30 * HOUR_MS, periodMs: WEEK },
        { remaining: 10, resetAt: NOW + 100 * HOUR_MS, periodMs: WEEK },
      ],
      4,
      NOW,
      NOW + 72 * HOUR_MS,
      STEP
    );

    // 2 points an hour each until the small one is dry at 5h, then 4 an hour on the other.
    expect(projection.empties.map((event) => [hoursFromNow(event.at), event.account])).toEqual([
      [5, 1],
      [15, 0],
      [55, 0],
    ]);
    expect(hoursFromNow(projection.poolEmptyAt as number)).toBe(15);
    expect(projection.resets).toEqual([{ at: NOW + 30 * HOUR_MS, account: 0, gain: 100 }]);
    expect(projectionAt(projection, NOW + 30 * HOUR_MS)).toEqual([100, 0]);
    expect(projectionAt(projection, NOW + 2.5 * HOUR_MS)?.[0]).toBeCloseTo(45, 6);
  });

  test('repeats resets each period and reports what each one restored', () => {
    const projection = projectPool(
      [{ remaining: 80, resetAt: NOW + HOUR_MS, periodMs: 5 * HOUR_MS }],
      2,
      NOW,
      NOW + 12 * HOUR_MS,
      STEP
    );
    expect(
      projection.resets.map((reset) => [hoursFromNow(reset.at), Math.round(reset.gain)])
    ).toEqual([
      [1, 22],
      [6, 10],
      [11, 10],
    ]);
    expect(projection.poolEmptyAt).toBeNull();
  });

  test('restores an account whose reading predates its reset', () => {
    const projection = projectPool(
      [{ remaining: 5, resetAt: NOW - HOUR_MS, periodMs: 5 * HOUR_MS }],
      0,
      NOW,
      NOW + 6 * HOUR_MS,
      STEP
    );
    expect(projection.pool[0]).toBe(100);
    expect(projection.resets.map((reset) => hoursFromNow(reset.at))).toEqual([4]);
  });

  test('starts a window at its first use when none is open', () => {
    const projection = projectPool(
      [{ remaining: 100, resetAt: null, periodMs: 24 * HOUR_MS }],
      10,
      NOW,
      NOW + 30 * HOUR_MS,
      STEP
    );
    expect(hoursFromNow(projection.empties[0].at)).toBe(10);
    expect(projection.resets.map((reset) => hoursFromNow(reset.at))).toEqual([24]);
  });

  test('reports a pool that is already dry as empty from the start', () => {
    const projection = projectPool(
      [{ remaining: 0, resetAt: NOW + HOUR_MS, periodMs: null }],
      3,
      NOW,
      NOW + 3 * HOUR_MS,
      STEP
    );
    expect(projection.poolEmptyAt).toBe(NOW);
    expect(projection.resets).toEqual([{ at: NOW + HOUR_MS, account: 0, gain: 100 }]);
    expect(projectionAt(projection, NOW + 3 * HOUR_MS)?.[0]).toBeCloseTo(94, 6);
  });

  test('without burn the pool only rises at resets', () => {
    const projection = projectPool(
      [{ remaining: 40, resetAt: NOW + 2 * HOUR_MS, periodMs: WEEK }],
      0,
      NOW,
      NOW + 4 * HOUR_MS,
      STEP
    );
    expect(projectionAt(projection, NOW + HOUR_MS)).toEqual([40]);
    expect(projectionAt(projection, NOW + 3 * HOUR_MS)).toEqual([100]);
  });
});
