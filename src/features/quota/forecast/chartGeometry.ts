/**
 * Pixel geometry of a forecast chart: paths, ticks, labels and the readout
 * under the pointer. Pure; text is formatted by the component.
 */

import { FORECAST_STEP_MS, type ForecastSection } from './forecastModel';
import { projectionAt } from './projection';
import type { ForecastMode } from './settings';

export const CHART_HEIGHT = 300;
export const CHART_MARGIN = { top: 30, right: 14, bottom: 30, left: 56 } as const;

/** Day labels closer than this would run into each other. */
const MIN_DAY_LABEL_WIDTH = 60;
const JUMP_LABEL_CHAR_WIDTH = 6.4;
const JUMP_LABEL_HEIGHT = 14;
const JUMP_LABEL_GAP = 4;
const EPSILON = 1e-6;

type Point = [number, number];

const fixed = (value: number) => Math.round(value * 10) / 10;

export function linePath(segments: readonly Point[][]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${fixed(x)} ${fixed(y)}`).join('')
    )
    .join('');
}

export function areaPath(segments: readonly Point[][], baseline: number): string {
  return segments
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      return `${linePath([segment])}L${fixed(last[0])} ${fixed(baseline)}L${fixed(first[0])} ${fixed(baseline)}Z`;
    })
    .join('');
}

/** Split a series at nulls into drawable runs. */
function runs(times: readonly number[], values: readonly (number | null)[]) {
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  times.forEach((at, index) => {
    const value = values[index];
    if (value === null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current.push([at, value]);
  });
  if (current.length > 0) out.push(current);
  return out;
}

/** Points of `times` inside [from, to], with one neighbour either side so lines reach the edges. */
function visibleRange(times: readonly number[], fromMs: number, toMs: number) {
  let first = times.findIndex((at) => at >= fromMs);
  if (first === -1) return null;
  first = Math.max(0, first - 1);
  let last = first;
  while (last + 1 < times.length && times[last] <= toMs) last += 1;
  return [first, last] as const;
}

/** Smallest of 1, 2, 2.5 or 5 times a power of ten at or above `value`. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Projected drain as steps: the projected burn while any account has quota, else nothing. */
function projectedDrain(section: ForecastSection): { times: number[]; values: number[] } {
  const { projection, projectedBurn } = section;
  if (!projection || projectedBurn === null) return { times: [], values: [] };
  const times: number[] = [];
  const values: number[] = [];
  projection.times.forEach((at, index) => {
    const rate = projection.pool[index] > EPSILON ? projectedBurn : 0;
    if (values.length > 0 && values[values.length - 1] !== rate) {
      times.push(at);
      values.push(values[values.length - 1]);
    }
    times.push(at);
    values.push(rate);
  });
  return { times, values };
}

export interface ChartInput {
  section: ForecastSection;
  mode: ForecastMode;
  spanStartMs: number;
  spanEndMs: number;
  nowMs: number;
  width: number;
  showAccounts: boolean;
}

export interface ChartGeometry {
  plot: { left: number; right: number; top: number; bottom: number };
  yMax: number;
  yTicks: { value: number; y: number }[];
  days: { lineX: number | null; labelX: number; at: number; labelled: boolean }[];
  recordedLine: string;
  recordedArea: string;
  projectedLine: string;
  projectedArea: string;
  accountLines: { recorded: string; projected: string }[];
  now: { x: number; y: number | null } | null;
  jumps: { x: number; y: number; gain: number }[];
  empty: { x: number; y: number; at: number } | null;
}

export function buildChartGeometry(input: ChartInput): ChartGeometry {
  const { section, mode, spanStartMs, spanEndMs, nowMs, width, showAccounts } = input;
  const plot = {
    left: CHART_MARGIN.left,
    right: Math.max(CHART_MARGIN.left + 1, width - CHART_MARGIN.right),
    top: CHART_MARGIN.top,
    bottom: CHART_HEIGHT - CHART_MARGIN.bottom,
  };
  const spanMs = spanEndMs - spanStartMs;
  const x = (at: number) => plot.left + ((at - spanStartMs) / spanMs) * (plot.right - plot.left);

  const drainProjected = projectedDrain(section);
  const recordedDrainMax = Math.max(
    0,
    ...section.drain.values.filter((value): value is number => value !== null)
  );
  const yMax =
    mode === 'remaining'
      ? section.capacity
      : niceCeiling(Math.max(recordedDrainMax, section.projectedBurn ?? 0) * 1.15);
  const y = (value: number) =>
    plot.bottom - (Math.min(Math.max(value, 0), yMax) / yMax) * (plot.bottom - plot.top);
  const toPoints = (series: [number, number][]) =>
    series.map(([at, value]): Point => [x(at), y(value)]);

  /* ---------- series ---------- */

  const recordedRuns =
    mode === 'remaining'
      ? runs(section.recorded.times, section.recorded.pool)
      : runs(section.drain.times, section.drain.values);
  const recordedSegments = recordedRuns.map(toPoints);

  let projectedSegments: Point[][] = [];
  const projection = section.projection;
  if (projection && nowMs <= spanEndMs) {
    const source =
      mode === 'remaining' ? { times: projection.times, values: projection.pool } : drainProjected;
    const range = visibleRange(source.times, spanStartMs, spanEndMs);
    if (range) {
      const series: [number, number][] = [];
      for (let index = range[0]; index <= range[1]; index += 1) {
        series.push([source.times[index], source.values[index]]);
      }
      projectedSegments = [toPoints(series)];
    }
  }

  const accountLines: ChartGeometry['accountLines'] = [];
  if (mode === 'remaining' && showAccounts && section.names.length > 1) {
    const projectedRange =
      projection && nowMs <= spanEndMs
        ? visibleRange(projection.times, spanStartMs, spanEndMs)
        : null;
    for (let boundary = 0; boundary < section.names.length - 1; boundary += 1) {
      const cumulative = (values: readonly (number | null)[]) =>
        values.slice(0, boundary + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0);
      const recorded = runs(
        section.recorded.times,
        section.recorded.accounts.map((values, index) =>
          section.recorded.pool[index] === null ? null : cumulative(values)
        )
      ).map(toPoints);
      const projected: [number, number][] = [];
      if (projection && projectedRange) {
        for (let index = projectedRange[0]; index <= projectedRange[1]; index += 1) {
          projected.push([projection.times[index], cumulative(projection.values[index])]);
        }
      }
      accountLines.push({
        recorded: linePath(recorded),
        projected: linePath([toPoints(projected)]),
      });
    }
  }

  /* ---------- axes ---------- */

  const yTicks = [0, yMax / 2, yMax].map((value) => ({ value, y: y(value) }));

  const days: ChartGeometry['days'] = [];
  const cursor = new Date(spanStartMs);
  while (cursor.getTime() < spanEndMs) {
    const at = cursor.getTime();
    cursor.setDate(cursor.getDate() + 1);
    const next = Math.min(cursor.getTime(), spanEndMs);
    days.push({
      lineX: at === spanStartMs ? null : x(at),
      labelX: x((at + next) / 2),
      at,
      labelled: true,
    });
  }
  const dayWidth = (plot.right - plot.left) / Math.max(1, days.length);
  const every = Math.ceil(MIN_DAY_LABEL_WIDTH / Math.max(1, dayWidth));
  days.forEach((day, index) => {
    day.labelled = index % every === 0;
  });

  /* ---------- marks ---------- */

  const nowVisible = nowMs >= spanStartMs && nowMs <= spanEndMs;
  const nowValue = mode === 'remaining' ? section.poolNow : (section.burn?.perHour ?? null);
  const now = nowVisible ? { x: x(nowMs), y: nowValue === null ? null : y(nowValue) } : null;

  const jumps: ChartGeometry['jumps'] = [];
  if (mode === 'remaining') {
    const placed: { x: number; y: number; width: number }[] = [];
    [...section.jumps]
      .sort((a, b) => a.at - b.at)
      .forEach((jump) => {
        const gain = Math.round(jump.gain);
        const labelWidth = (String(gain).length + 2) * JUMP_LABEL_CHAR_WIDTH;
        const position = { x: x(jump.at), y: Math.max(12, y(jump.top) - 8), width: labelWidth };
        if (position.x < plot.left || position.x > plot.right) return;
        const collides = placed.some(
          (other) =>
            Math.abs(other.x - position.x) < (other.width + position.width) / 2 + JUMP_LABEL_GAP &&
            Math.abs(other.y - position.y) < JUMP_LABEL_HEIGHT
        );
        if (collides) return;
        placed.push(position);
        jumps.push({ x: position.x, y: position.y, gain });
      });
  }

  const emptyAt = section.poolEmptyAt;
  const empty =
    mode === 'remaining' && emptyAt !== null && emptyAt >= spanStartMs && emptyAt <= spanEndMs
      ? { x: x(emptyAt), y: y(0), at: emptyAt }
      : null;

  return {
    plot,
    yMax,
    yTicks,
    days,
    recordedLine: linePath(recordedSegments),
    recordedArea: areaPath(recordedSegments, plot.bottom),
    projectedLine: linePath(projectedSegments),
    projectedArea: areaPath(projectedSegments, plot.bottom),
    accountLines,
    now,
    jumps,
    empty,
  };
}

/** The chart's x position as an instant, snapped to the recorded grid or to now. */
export function instantAtX(
  px: number,
  plot: ChartGeometry['plot'],
  spanStartMs: number,
  spanEndMs: number,
  nowMs: number
): number {
  const ratio = Math.min(1, Math.max(0, (px - plot.left) / (plot.right - plot.left)));
  const raw = spanStartMs + ratio * (spanEndMs - spanStartMs);
  if (Math.abs(raw - nowMs) < FORECAST_STEP_MS / 2) return nowMs;
  const snapped =
    spanStartMs + Math.round((raw - spanStartMs) / FORECAST_STEP_MS) * FORECAST_STEP_MS;
  return Math.min(spanEndMs, Math.max(spanStartMs, snapped));
}

export interface Readout {
  kind: 'recorded' | 'projected';
  /** Pool remaining, or burn in drain mode; null when nothing is known. */
  value: number | null;
  /** Each account's remaining; null when unknown. */
  accounts: (number | null)[];
}

function lastAtOrBefore(times: readonly number[], atMs: number): number {
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

export function readoutAt(
  section: ForecastSection,
  mode: ForecastMode,
  atMs: number,
  nowMs: number
): Readout {
  const unknown = section.names.map(() => null);
  if (atMs <= nowMs) {
    const index = lastAtOrBefore(section.recorded.times, atMs);
    const accounts = index === -1 ? unknown : section.recorded.accounts[index];
    if (mode === 'drain') {
      const drainIndex = lastAtOrBefore(section.drain.times, atMs);
      const value =
        atMs === nowMs
          ? (section.burn?.perHour ?? null)
          : drainIndex === -1
            ? null
            : section.drain.values[drainIndex];
      return { kind: 'recorded', value, accounts };
    }
    return {
      kind: 'recorded',
      value: index === -1 ? null : section.recorded.pool[index],
      accounts,
    };
  }

  const values = section.projection ? projectionAt(section.projection, atMs) : null;
  if (!values) return { kind: 'projected', value: null, accounts: unknown };
  const pool = values.reduce((sum, value) => sum + value, 0);
  const value =
    mode === 'remaining'
      ? pool
      : section.projectedBurn === null
        ? null
        : pool > EPSILON
          ? section.projectedBurn
          : 0;
  return { kind: 'projected', value, accounts: values };
}
