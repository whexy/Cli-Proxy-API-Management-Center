import { describe, expect, test } from 'bun:test';
import {
  MIN_RATE_COVERAGE_MS,
  SAMPLE_HEARTBEAT_MS,
  SAMPLE_MAX_GAP_MS,
  poolRate,
  shouldRecordSample,
  trackValueAt,
  usageBuckets,
  windowTrack,
  type QuotaSample,
} from '@/features/quota/forecast/history';
import { HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

const NOW = Date.UTC(2026, 9, 26, 12);

const sample = (
  at: number,
  remaining: number | null,
  resetAt: number | null = NOW + 48 * HOUR_MS
): QuotaSample => ({
  scope: 'https://cpa.example',
  credential: 'claude:a.json',
  at,
  windows: [{ id: 'weekly', remaining, resetAt, periodHours: 168 }],
});

/** One reading every `stepMs` from `fromMs`, falling `perHour` points an hour. */
const steady = (fromMs: number, count: number, stepMs: number, start: number, perHour: number) =>
  Array.from({ length: count }, (_, index) =>
    sample(fromMs + index * stepMs, start - (perHour * index * stepMs) / HOUR_MS)
  );

describe('shouldRecordSample', () => {
  test('writes the first reading, changes, and an unchanged reading once a heartbeat', () => {
    const first = sample(NOW, 80);
    expect(shouldRecordSample(undefined, first)).toBe(true);
    expect(shouldRecordSample(first, sample(NOW + MINUTE_MS, 80))).toBe(false);
    expect(shouldRecordSample(first, sample(NOW + MINUTE_MS, 79))).toBe(true);
    expect(shouldRecordSample(first, sample(NOW + SAMPLE_HEARTBEAT_MS, 80))).toBe(true);
  });

  test('treats a reset instant that only jitters by seconds as unchanged', () => {
    const first = sample(NOW, 80, NOW + HOUR_MS);
    expect(shouldRecordSample(first, sample(NOW + MINUTE_MS, 80, NOW + HOUR_MS + 2_000))).toBe(
      false
    );
    expect(shouldRecordSample(first, sample(NOW + MINUTE_MS, 80, NOW + 2 * HOUR_MS))).toBe(true);
  });
});

describe('windowTrack', () => {
  test('joins readings up to the gap limit and leaves a gap past it', () => {
    const track = windowTrack(
      [sample(NOW + 20 * MINUTE_MS, 70), sample(NOW, 80), sample(NOW + 2 * HOUR_MS, 60)],
      'weekly'
    );
    expect(track.map((point) => point.at)).toEqual([NOW, NOW + 20 * MINUTE_MS, NOW + 2 * HOUR_MS]);
    expect(track[0].until).toBe(NOW + 20 * MINUTE_MS);
    // Nothing came within the gap limit, so the reading stands for one heartbeat.
    expect(track[1].until).toBe(NOW + 20 * MINUTE_MS + SAMPLE_HEARTBEAT_MS);

    expect(trackValueAt(track, NOW - 1)).toBeNull();
    expect(trackValueAt(track, NOW + 10 * MINUTE_MS)).toBe(80);
    expect(trackValueAt(track, NOW + 25 * MINUTE_MS)).toBe(70);
    expect(trackValueAt(track, NOW + HOUR_MS)).toBeNull();
    expect(trackValueAt(track, NOW + 2 * HOUR_MS)).toBe(60);
    expect(SAMPLE_MAX_GAP_MS).toBeLessThan(2 * HOUR_MS - 20 * MINUTE_MS);
  });

  test('skips samples that lack the window or a figure for it', () => {
    const track = windowTrack([sample(NOW, null), sample(NOW + MINUTE_MS, 50)], 'weekly');
    expect(track.map((point) => point.remaining)).toEqual([50]);
    expect(windowTrack([sample(NOW, 50)], 'five-hour')).toEqual([]);
  });
});

describe('usageBuckets and poolRate', () => {
  test('a steady decline reads as its rate in every fully watched bucket', () => {
    const track = windowTrack(steady(NOW, 13, 5 * MINUTE_MS, 90, 6), 'weekly');
    const { used, covered } = usageBuckets(track, NOW, 10 * MINUTE_MS, 6);
    used.forEach((value) => expect(value).toBeCloseTo(1, 6));
    covered.forEach((value) => expect(value).toBe(10 * MINUTE_MS));
    expect(poolRate([{ used, covered }], 0, 5)?.perHour).toBeCloseTo(6, 6);
  });

  test('counts only the use after a reset, and nothing across a gap', () => {
    const track = windowTrack(
      [
        sample(NOW, 10, NOW + 5 * MINUTE_MS),
        sample(NOW + 10 * MINUTE_MS, 96, NOW + 168 * HOUR_MS),
        sample(NOW + 3 * HOUR_MS, 50, NOW + 168 * HOUR_MS),
      ],
      'weekly'
    );
    const { used, covered } = usageBuckets(track, NOW, HOUR_MS, 4);
    expect(used[0]).toBeCloseTo(4, 6);
    expect(covered[0]).toBe(10 * MINUTE_MS);
    expect(used.slice(1)).toEqual([0, 0, 0]);
  });

  test('sums each account’s own rate and ignores accounts watched too briefly', () => {
    const watched = usageBuckets(
      windowTrack(steady(NOW, 7, 10 * MINUTE_MS, 80, 3), 'weekly'),
      NOW,
      HOUR_MS,
      1
    );
    const other = usageBuckets(
      windowTrack(steady(NOW, 4, 10 * MINUTE_MS, 60, 9), 'weekly'),
      NOW,
      HOUR_MS,
      1
    );
    const brief = usageBuckets(
      windowTrack(steady(NOW, 2, 10 * MINUTE_MS, 60, 30), 'weekly'),
      NOW,
      HOUR_MS,
      1
    );
    expect(brief.covered[0]).toBeLessThan(MIN_RATE_COVERAGE_MS);

    const rate = poolRate([watched, other, brief], 0, 0);
    expect(rate?.perHour).toBeCloseTo(12, 6);
    expect(rate?.coveredMs).toBe(HOUR_MS);
    expect(poolRate([brief], 0, 0)).toBeNull();
  });
});
